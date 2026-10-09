#!/usr/bin/env python3
"""Assert the invariants a Deme data snapshot must hold before publishing.

Run from the repo root after regenerating any data/*.json:

    python3 tools/check-data-snapshot.py

Checks (exit 1 listing every violation):
  1. Every itemVotes ref exists in items.json — otherwise the app's
     client-side member-vote derivation silently drops rows and member
     totals drift from the record (close-out item 6).
  2. data/termVotes.json equals the term totals derived from itemVotes
     (items dated on/after 2022-11-15, the 2022-2026 term) — the app now
     derives these at runtime; this file is kept consistent for static-page
     generation (close-out item 4).
  3. councillors.json has 94 members and its career absent_conflict counts
     equal the 'Absent(Interest Declared)' rows in itemVotes.
  4. data/simpleBriefs.json covers every item, and no entry is truncated
     mid-sentence, dangling, doubled-word, or leaking a raw URL — entries
     failing QA should carry the items.json brief instead (item 2).
  5. data/demo-bootstrap.json matches the current snapshot (regenerate it
     with tools/build-demo-bootstrap.py if this fails).
  6. The lazy-load shards (tools/build-shards.py) sum exactly to the
     monoliths: year shards partition the items, vote rows, and simple
     briefs; member files carry every vote row and derive the same term
     totals as itemVotes; the search index lists every item; index.html
     never fetches the monoliths.
"""
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TERM_START = "2022-11-15"  # first day of the 2022-2026 council term
problems = []

def load(name, required=True):
    p = DATA / name
    if not p.exists():
        if required:
            problems.append(f"missing data file: {name}")
        return None
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)

def round_half_up_1dp(numerator, denominator):
    if not denominator:
        return 0
    return math.floor(100 * numerator / denominator * 10 + 0.5) / 10

items = load("items.json") or []
item_votes = load("itemVotes.json") or {}
councillors = load("councillors.json") or []
term_votes = load("termVotes.json") or {}
simple_briefs = load("simpleBriefs.json") or {}
bootstrap = load("demo-bootstrap.json")

by_ref = {i["ref"]: i for i in items}

# 1. itemVotes refs resolve to items
missing_refs = sorted(r for r in item_votes if r not in by_ref)
if missing_refs:
    problems.append(f"invariant 1: {len(missing_refs)} itemVotes ref(s) missing from items.json, e.g. {missing_refs[:5]}")

# 2. termVotes.json equals derived term totals
derived = {}
for ref, rows in item_votes.items():
    item = by_ref.get(ref)
    if not item or item["date"] < TERM_START:
        continue
    for row in rows:
        t = derived.setdefault(row["m"], {"votes": 0, "absent": 0, "conflict": 0})
        t["votes"] += 1
        if row["v"] == "Absent":
            t["absent"] += 1
        elif row["v"] == "Absent(Interest Declared)":
            t["conflict"] += 1
for t in derived.values():
    t["absent_pct"] = round_half_up_1dp(t["absent"] + t["conflict"], t["votes"])
if set(derived) != set(term_votes):
    problems.append(f"invariant 2: termVotes.json members {sorted(set(term_votes) ^ set(derived))[:5]} differ from derivation")
else:
    for name, want in derived.items():
        got = term_votes[name]
        for key in ("votes", "absent", "conflict", "absent_pct"):
            if got.get(key) != want[key]:
                problems.append(f"invariant 2: termVotes.json[{name}].{key}={got.get(key)} but derived={want[key]}")

# 3. councillors: 94 members; absent_conflict matches the record
if len(councillors) != 94:
    problems.append(f"invariant 3: councillors.json has {len(councillors)} members, expected 94")
career_conflict = {}
for rows in item_votes.values():
    for row in rows:
        if row["v"] == "Absent(Interest Declared)":
            career_conflict[row["m"]] = career_conflict.get(row["m"], 0) + 1
for c in councillors:
    if c.get("absent_conflict") is not None and c["absent_conflict"] != career_conflict.get(c["name"], 0):
        problems.append(f"invariant 3: councillors.json[{c['name']}].absent_conflict={c['absent_conflict']} but record has {career_conflict.get(c['name'], 0)}")

# 4. simpleBriefs QA
DOUBLE = re.compile(r"\b(\w+)\s+\1\b", re.I)
DANGLING = {"the", "a", "an", "and", "or", "nor", "but", "is", "are", "was",
            "were", "has", "have", "had", "be", "been", "will", "would",
            "shall", "should", "can", "could", "might", "must", "its",
            "their", "our", "your", "his", "her"}

def last_word(s):
    parts = s.strip().rstrip(".!?…").split()
    return parts[-1].strip('",;)(').lower() if parts else ""

def qa_fail(s, standard):
    if DOUBLE.search(s):
        return "doubled word"
    if re.search(r"https?://|www\.", s):
        return "raw URL"
    if last_word(s) in DANGLING:
        return "dangling end"
    body = s.strip().rstrip(".!?…").strip()
    if standard.startswith(body) and 25 <= len(body) < len(standard) - 2:
        rest = standard[len(body):].lstrip()
        if rest and ((standard[len(body)].isalnum() and body[-1].isalnum())
                     or rest[0].islower() or rest[0] in ",;:)"):
            return "truncated mid-sentence"
    if len(s) > len(standard) + 150:
        return "longer than the standard brief (wrong-content splice?)"
    return None

qa_bad = []
for ref, s in simple_briefs.items():
    standard = by_ref.get(ref, {}).get("brief", "")
    if s == standard:
        continue  # canonical text (also what the static pages show)
    why = qa_fail(s, standard)
    if why:
        qa_bad.append((ref, why))
if qa_bad:
    problems.append(f"invariant 4: {len(qa_bad)} simpleBriefs entries fail QA, e.g. {qa_bad[:5]} — replace each with its items.json brief")
no_simple = [i["ref"] for i in items if i["ref"] not in simple_briefs]
if no_simple:
    problems.append(f"invariant 4: {len(no_simple)} items have no simpleBriefs entry, e.g. {no_simple[:5]}")

# 5. bootstrap freshness
if bootstrap is not None:
    if bootstrap.get("counts") != {"items": len(items), "itemVotes": len(item_votes)}:
        problems.append("invariant 5: demo-bootstrap.json counts are stale — rerun tools/build-demo-bootstrap.py")

# 6. shard consistency (tools/build-shards.py output must match the monoliths)
search_index = load("search-index.json")
topics_index = load("topics-index.json")
if search_index is not None:
    years = sorted({i["date"][:4] for i in items})
    shard_item_refs, shard_vote_rows, shard_vote_refs, shard_brief_refs = [], 0, set(), set()
    for y in years:
        for i in load(f"items-{y}.json") or []:
            shard_item_refs.append(i["ref"])
        for ref, rows in (load(f"votes-{y}.json") or {}).items():
            shard_vote_refs.add(ref)
            shard_vote_rows += len(rows)
        shard_brief_refs |= set((load(f"briefs-{y}.json") or {}).keys())
    if sorted(shard_item_refs) != sorted(by_ref):
        problems.append("invariant 6: items-YYYY shards do not partition items.json — rerun tools/build-shards.py")
    if shard_vote_refs != set(item_votes) or shard_vote_rows != sum(len(r) for r in item_votes.values()):
        problems.append("invariant 6: votes-YYYY shards do not sum to itemVotes.json — rerun tools/build-shards.py")
    if shard_brief_refs != set(by_ref):
        problems.append("invariant 6: briefs-YYYY shards do not cover every item — rerun tools/build-shards.py")

    idx_entries = search_index.get("items") or []
    if len(idx_entries) != len(items) or {e[0] for e in idx_entries} != set(by_ref):
        problems.append("invariant 6: search-index.json does not list every item — rerun tools/build-shards.py")
    if search_index.get("bodies") != sorted({i["body"] for i in items if i.get("body")}):
        problems.append("invariant 6: search-index.json body list is stale — rerun tools/build-shards.py")

    member_rows_total = 0
    member_term = {}
    for entry in search_index.get("members") or []:
        payload = load(entry["f"])
        if payload is None:
            continue
        member_rows_total += len(payload["rows"])
        t = {"votes": 0, "absent": 0, "conflict": 0}
        for r in payload["rows"]:
            if r[0] < TERM_START:
                continue
            t["votes"] += 1
            if r[2] == "Absent":
                t["absent"] += 1
            elif r[2] == "Absent(Interest Declared)":
                t["conflict"] += 1
        t["absent_pct"] = round_half_up_1dp(t["absent"] + t["conflict"], t["votes"])
        member_term[payload["name"]] = t
    if member_rows_total != sum(len(r) for r in item_votes.values()):
        problems.append("invariant 6: member files do not carry every itemVotes row — rerun tools/build-shards.py")
    for name, want in member_term.items():
        if want["votes"] and derived.get(name) != want:
            problems.append(f"invariant 6: member file for {name} derives {want}, expected {derived.get(name)}")
if topics_index is not None and set((topics_index.get("topics") or {}).keys()) != set(by_ref):
    problems.append("invariant 6: topics-index.json does not cover every item — rerun tools/build-shards.py")

app_html = (ROOT / "index.html").read_text(encoding="utf-8")
for monolith in ("data/items.json", "data/itemVotes.json", "data/simpleBriefs.json"):
    if monolith in app_html:
        problems.append(f"invariant 6: index.html references {monolith} — the app must load shards, not monoliths")

if problems:
    print("SNAPSHOT CHECK FAILED")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print(f"Snapshot OK: {len(items):,} items, {len(item_votes):,} items with votes, "
      f"{len(councillors)} councillors, {len(term_votes)} term members, "
      f"{len(simple_briefs):,} simple briefs (QA clean outside canonical text).")
