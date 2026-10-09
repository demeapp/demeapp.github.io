#!/usr/bin/env python3
"""Split the two monolith data files into lazily-loaded shards.

Run from the repo root after regenerating any data/*.json:

    python3 tools/build-shards.py

The app no longer downloads data/items.json (~26 MB) and data/itemVotes.json
(~22.6 MB) up front. It paints from data/demo-bootstrap.json, then fetches
only what the current view needs:

  data/search-index.json   every agenda item's ref/date/body/title (in
                           items.json order), the decision-body list, the
                           member manifest, and per-ward decided/carried
                           aggregates for profile "Ward record" bars.
  data/topics-index.json   each item's topics string, verbatim from
                           items.json. The app feeds it to its own
                           splitTopics, so topic counts, topic chips and
                           promise matching see byte-identical input.
  data/items-YYYY.json     full agenda items for one year.
  data/votes-YYYY.json     recorded vote rows for items of one year
                           (shard year = the item's date year).
  data/briefs-YYYY.json    plain-language "simple" briefs for one year,
                           split from data/simpleBriefs.json.
  data/member-<slug>.json  one member's recorded vote rows (item date, ref,
                           vote, motion name/time/description/result, and the
                           motion's first-appearance order within its item),
                           plus the Yes/No overlap counts the profile's
                           alignment summary needs.

The monoliths stay in the repo as pipeline sources; the app does not fetch
them. This script fails loudly (exit 1, listing every violation) if shard
totals do not sum exactly to the monoliths, if any itemVotes ref has no
matching item, or if member-file derivations disagree with the monoliths.
"""
import collections
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TERM_START = "2022-11-15"  # first day of the 2022-2026 council term
problems = []


def fail(msg):
    problems.append(msg)


def load(name):
    p = DATA / name
    if not p.exists():
        fail(f"missing data file: {name}")
        return None
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def write(name, obj):
    with open(DATA / name, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def round_half_up_1dp(numerator, denominator):
    if not denominator:
        return 0
    return math.floor(100 * numerator / denominator * 10 + 0.5) / 10


items = load("items.json") or []
item_votes = load("itemVotes.json") or {}
simple_briefs = load("simpleBriefs.json") or {}
ward_impact = load("wardImpact.json") or {}
by_ref = {i["ref"]: i for i in items}


def year_of(item):
    return item["date"][:4]


# --- invariant: every itemVotes ref resolves to an items.json entry --------
missing_refs = sorted(r for r in item_votes if r not in by_ref)
if missing_refs:
    fail(f"{len(missing_refs)} itemVotes ref(s) missing from items.json, e.g. {missing_refs[:5]}")
if set(simple_briefs) != set(by_ref):
    fail("simpleBriefs.json keys differ from items.json refs")

# --- topics: verbatim strings (the app normalizes them itself) -------------
topics = {item["ref"]: item.get("topics") or "" for item in items}
if set(topics) != set(by_ref):
    fail("topics coverage differs from items.json refs")

# --- year shards: items / votes / briefs -----------------------------------
years = sorted({year_of(i) for i in items})
items_by_year = {y: [] for y in years}
for item in items:
    items_by_year[year_of(item)].append(item)
votes_by_year = {y: {} for y in years}
for ref, rows in item_votes.items():
    if ref in by_ref:
        votes_by_year[year_of(by_ref[ref])][ref] = rows
briefs_by_year = {y: {} for y in years}
for ref, text in simple_briefs.items():
    if ref in by_ref:
        briefs_by_year[year_of(by_ref[ref])][ref] = text

for y in years:
    write(f"items-{y}.json", items_by_year[y])
    write(f"votes-{y}.json", votes_by_year[y])
    write(f"briefs-{y}.json", briefs_by_year[y])

# --- member files ----------------------------------------------------------
def motion_key(row):
    return "\u0001".join([
        row.get("mo") or "Recorded vote",
        row.get("t") or "",
        row.get("d") or "",
        row.get("r") or "",
    ])


member_rows = collections.defaultdict(list)
own_yes_no = collections.defaultdict(set)
for ref, rows in item_votes.items():
    item = by_ref.get(ref)
    if not item:
        continue
    group_order = {}
    for row in rows:
        key = motion_key(row)
        if key not in group_order:
            group_order[key] = len(group_order)
    for row in rows:
        member_rows[row["m"]].append([
            item["date"], ref, row["v"],
            row.get("mo"), row.get("t"), row.get("d"), row.get("r"),
            group_order[motion_key(row)],
        ])
        if row["v"] in ("Yes", "No"):
            own_yes_no[row["m"]].add(ref)

shared = {}
for a in member_rows:
    shared[a] = {}
    for b in member_rows:
        if a != b:
            n = len(own_yes_no[a] & own_yes_no[b])
            if n:
                shared[a][b] = n


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


slugs = [slug(n) for n in member_rows]
if len(set(slugs)) != len(slugs):
    fail("member slug collision in generated file names")

manifest = []
for name, rows in member_rows.items():
    fname = f"member-{slug(name)}.json"
    write(fname, {"name": name, "shared": shared[name], "rows": rows})
    manifest.append({
        "n": name,
        "f": fname,
        "y": sorted({r[0][:4] for r in rows}),
        "r": len(rows),
    })

# --- per-ward decided/carried (the profile "Ward record" aggregates) -------
def impact_for(ref):
    return ward_impact.get(ref) or ward_impact.get(re.sub(r"^\d{4}\.", "", ref))


ward_records = {}
for ward in range(1, 26):
    decided = carried = 0
    for ref, rows in item_votes.items():
        impact = impact_for(ref)
        if not impact or impact.get("city_wide") or not isinstance(impact.get("wards"), list):
            continue
        if ward not in [int(w) for w in impact["wards"]]:
            continue
        groups = {}
        for row in rows:
            g = groups.setdefault(motion_key(row), {"Yes": 0, "No": 0})
            if row["v"] in ("Yes", "No"):
                g[row["v"]] += 1
        for g in groups.values():
            if not g["Yes"] and not g["No"]:
                continue
            decided += 1
            if g["Yes"] > g["No"]:
                carried += 1
    ward_records[str(ward)] = {"decided": decided, "carried": carried}

# --- global search index ----------------------------------------------------
bodies = sorted({i["body"] for i in items if i.get("body")})
body_index = {b: n for n, b in enumerate(bodies)}
index_items = [
    [i["ref"], i["date"], body_index.get(i.get("body"), -1), i["title"]]
    for i in items
]
write("search-index.json", {
    "bodies": bodies,
    "wardRecords": ward_records,
    "members": manifest,
    "items": index_items,
})
write("topics-index.json", {
    "topics": {i["ref"]: topics[i["ref"]] for i in items},
})

# --- loud assertions: shards must sum exactly to the monoliths -------------
if sum(len(v) for v in items_by_year.values()) != len(items):
    fail("items shards do not sum to items.json")
if sum(len(v) for v in votes_by_year.values()) != len(item_votes):
    fail("votes shards do not cover every itemVotes ref")
total_vote_rows = sum(len(r) for r in item_votes.values())
if sum(len(rows) for y in votes_by_year.values() for rows in y.values()) != total_vote_rows:
    fail("votes shards do not sum to the itemVotes row total")
if sum(len(v) for v in briefs_by_year.values()) != len(simple_briefs):
    fail("briefs shards do not sum to simpleBriefs.json")
if sum(len(rows) for rows in member_rows.values()) != total_vote_rows:
    fail("member files do not sum to the itemVotes row total")
if len(index_items) != len(items):
    fail("search index does not list every item")

# member-file term totals must equal the monolith derivation
def term_totals(row_source):
    out = {}
    for name, rows in row_source.items():
        t = {"votes": 0, "absent": 0, "conflict": 0}
        for d, _ref, v, *_rest in rows:
            if d < TERM_START:
                continue
            t["votes"] += 1
            if v == "Absent":
                t["absent"] += 1
            elif v == "Absent(Interest Declared)":
                t["conflict"] += 1
        t["absent_pct"] = round_half_up_1dp(t["absent"] + t["conflict"], t["votes"])
        out[name] = t
    return out


monolith_rows = collections.defaultdict(list)
for ref, rows in item_votes.items():
    if ref in by_ref:
        for row in rows:
            monolith_rows[row["m"]].append([by_ref[ref]["date"], ref, row["v"]])
member_term = term_totals({n: [r[:3] for r in rows] for n, rows in member_rows.items()})
monolith_term = term_totals(monolith_rows)
if member_term != monolith_term:
    differ = [n for n in monolith_term if monolith_term[n] != member_term.get(n)]
    fail(f"member-file term totals disagree with the monoliths for {differ[:5]}")

for a, others in shared.items():
    for b, n in others.items():
        if shared.get(b, {}).get(a) != n:
            fail(f"shared-vote counts are not symmetric for {a} / {b}")

if problems:
    print("SHARD BUILD FAILED")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print(
    f"Shards OK: {len(items):,} items in {len(years)} year shards, "
    f"{len(item_votes):,} voted items ({total_vote_rows:,} vote rows), "
    f"{len(manifest)} member files, member term totals match the monoliths."
)
