#!/usr/bin/env python3
"""Build data/demo-bootstrap.json — the first-paint payload for the Deme demo.

The app paints its demo from a small bootstrap (the pinned demo items, the
hero vote item, their recorded-vote rows, their ward-impact chips, and the
headline counts) while data/items.json and data/itemVotes.json load in the
background. Regenerate this file on every data snapshot, after data/items.json
and data/itemVotes.json are written:

    python3 tools/build-demo-bootstrap.py

The script fails loudly (exit 1) if a pinned demo ref or the hero vote item
cannot be found in the snapshot, so a snapshot editor catches drift instead of
shipping a demo that cannot render.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

def load(name):
    with open(DATA / name, encoding="utf-8") as fh:
        return json.load(fh)

def main():
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")

    # Pinned demo items, parsed from the app's own DEMO_REFS declaration so the
    # bootstrap can never drift from what the app renders.
    m = re.search(r"DEMO_REFS\s*=\s*\[(.*?)\];", index_html, re.S)
    if not m:
        sys.exit("Could not find DEMO_REFS in index.html")
    demo_refs = re.findall(r"ref:\s*'([^']+)'", m.group(1))
    if not demo_refs:
        sys.exit("DEMO_REFS parsed empty from index.html")

    # Hero vote item: same extraction the app uses (.hero-vote-subtitle text),
    # with the app's own fallback.
    hero_ref = "2026.MPB38.1"
    sub = re.search(r'class="hero-vote-subtitle">(.*?)</p>', index_html, re.S)
    if sub:
        found = re.search(r"20\d\d\.[A-Z]{2,4}\d+\.\d+", sub.group(1))
        if found:
            hero_ref = found.group(0)

    items = load("items.json")
    item_votes = load("itemVotes.json")
    ward_impact = load("wardImpact.json")

    # Snapshot invariant (close-out item 6): every vote ref must resolve to an
    # agenda item, or the client-side member-vote derivation goes lossy.
    item_refs = {i["ref"] for i in items}
    missing = sorted(r for r in item_votes if r not in item_refs)
    if missing:
        sys.exit(f"Snapshot invariant violated: {len(missing)} itemVotes ref(s) "
                 f"have no matching item in items.json, e.g. {missing[:5]}")

    refs = list(demo_refs)
    if hero_ref not in refs:
        refs.append(hero_ref)

    by_ref = {i["ref"]: i for i in items}
    for ref in refs:
        if ref not in by_ref:
            sys.exit(f"Pinned ref {ref} missing from items.json")
        if ref not in item_votes:
            sys.exit(f"Pinned ref {ref} has no recorded votes in itemVotes.json")

    boot = {
        "counts": {"items": len(items), "itemVotes": len(item_votes)},
        "items": [by_ref[r] for r in refs],
        "votes": {r: item_votes[r] for r in refs},
        "wardImpact": {r: ward_impact[r] for r in refs if r in ward_impact},
    }
    out = DATA / "demo-bootstrap.json"
    out.write_text(json.dumps(boot, separators=(",", ":"), ensure_ascii=False),
                   encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size:,} bytes) "
          f"for {len(refs)} pinned refs; counts items={boot['counts']['items']} "
          f"itemVotes={boot['counts']['itemVotes']}")

if __name__ == "__main__":
    main()
