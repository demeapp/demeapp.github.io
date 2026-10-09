#!/usr/bin/env python3
"""QA sweep for data/simpleBriefs.json.

    python3 tools/qa-simple-briefs.py          # report only
    python3 tools/qa-simple-briefs.py --fix    # replace failures with the standard brief

A simple brief FAILS QA when it is garbled rather than simplified:
  - a doubled word ("asked to to be introduced")
  - a raw URL pasted into the text
  - a dangling end (text stops on a word that cannot end a sentence)
  - a mid-sentence truncation of the standard brief (cut mid-phrase/mid-word)
  - longer than the standard brief by >150 chars (a wrong-content splice)
  - a tiny stall ("Staff recommend: 1a.", "Dr. Rhonda L.")

--fix replaces each failing entry with the items.json brief for that ref —
the same text the static item pages already prefer — so simple mode falls
back to the canonical summary instead of showing garble. Entries that merely
excerpt the standard brief's first complete sentence pass QA.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

DOUBLE = re.compile(r"\b(\w+)\s+\1\b", re.I)
DANGLING = {"the", "a", "an", "and", "or", "nor", "but", "is", "are", "was",
            "were", "has", "have", "had", "be", "been", "will", "would",
            "shall", "should", "can", "could", "might", "must", "its",
            "their", "our", "your", "his", "her"}

def last_word(s):
    parts = s.strip().rstrip(".!?…").split()
    return parts[-1].strip('",;)(').lower() if parts else ""

def classify(s, standard):
    why = []
    if DOUBLE.search(s):
        why.append("doubled-word")
    if re.search(r"https?://|www\.", s):
        why.append("raw-url")
    if last_word(s) in DANGLING:
        why.append("dangling-end")
    body = s.strip().rstrip(".!?…").strip()
    if standard.startswith(body) and len(body) >= 25 and len(body) < len(standard) - 2:
        rest = standard[len(body):].lstrip()
        if rest and ((standard[len(body)].isalnum() and body[-1].isalnum())
                     or rest[0].islower() or rest[0] in ",;:)"):
            why.append("mid-sentence-cut")
    if len(s) > len(standard) + 150:
        why.append("longer-than-standard")
    if len(s) < 40 and (s.rstrip().endswith(":")
                        or re.search(r":\s*\d+[a-z]?\.$", s.strip())
                        or (standard.startswith(body) and len(standard) > len(s) + 25)):
        why.append("tiny-stall")
    return why

def main():
    fix = "--fix" in sys.argv
    with open(DATA / "items.json", encoding="utf-8") as fh:
        by_ref = {i["ref"]: i for i in json.load(fh)}
    path = DATA / "simpleBriefs.json"
    with open(path, encoding="utf-8") as fh:
        briefs = json.load(fh)

    fails = {}
    canonical = 0
    for ref, s in briefs.items():
        standard = by_ref.get(ref, {}).get("brief", "")
        w = classify(s, standard)
        if w:
            if s == standard:
                canonical += 1  # the flag lives in the standard brief itself
            else:
                fails[ref] = w

    from collections import Counter
    counts = Counter(x for w in fails.values() for x in w)
    print(f"{len(briefs):,} simple briefs; {len(fails):,} fail QA "
          f"({', '.join(f'{k}={v}' for k, v in sorted(counts.items())) or 'none'}); "
          f"{canonical} further flags sit in the standard brief itself and are left "
          f"as the canonical text the static pages show")

    if fix and fails:
        for ref in fails:
            standard = by_ref[ref].get("brief", "")
            if standard:
                briefs[ref] = standard
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(briefs, fh, separators=(",", ":"), ensure_ascii=False)
        residual = sum(1 for r in fails if briefs[r] != by_ref[r].get("brief", ""))
        print(f"Fixed: {len(fails) - residual:,} entries replaced with the items.json brief; "
              f"{residual} left (no standard brief available).")

if __name__ == "__main__":
    main()
