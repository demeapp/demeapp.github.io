# Site data tools

Two scripts keep the published snapshot honest. Run them from the repo root
whenever `data/*.json` is regenerated.

## `build-demo-bootstrap.py`

    python3 tools/build-demo-bootstrap.py

Writes `data/demo-bootstrap.json`: the demo's pinned items (parsed from the
`DEMO_REFS` declaration in `index.html`), the hero vote item, their recorded
vote rows, their ward-impact chips, and the headline counts. The app paints
from this file (~85 KB with `councillors.json`) and loads `items.json` /
`itemVotes.json` in the background. The script fails loudly if a pinned ref
disappears from the snapshot, or if any `itemVotes` ref has no matching item
in `items.json`.

## `check-data-snapshot.py`

    python3 tools/check-data-snapshot.py

Read-only assertions over the whole snapshot: vote refs resolve to items,
`termVotes.json` matches the totals derivable from the record, career
interest-declared counts match the record, simple briefs pass QA, and the demo
bootstrap is fresh. Exits non-zero and lists every violation.

## `qa-simple-briefs.py`

    python3 tools/qa-simple-briefs.py          # report only
    python3 tools/qa-simple-briefs.py --fix    # replace failures with the standard brief

Flags simple briefs that are truncated mid-sentence, end dangling, repeat a
word, leak a raw URL, or are longer than the standard brief they simplify.
`--fix` rewrites each failing entry in `data/simpleBriefs.json` with the
`items.json` brief for that ref (the same text the static item pages prefer),
matching the one-off cleanup of October 9, 2026.

## Regeneration order for a new snapshot

1. Write `items.json`, `itemVotes.json`, and the other `data/*.json` files.
2. `python3 tools/qa-simple-briefs.py --fix` (cleans simple briefs).
3. Derive `termVotes.json` from `itemVotes.json` (items dated on/after
   2022-11-15): votes, absences, interest-declared absences, and the absent
   percentage. The app also derives this at runtime, so the file mainly feeds
   static-page generation.
4. `python3 tools/build-demo-bootstrap.py`.
5. `python3 tools/check-data-snapshot.py` — must pass before committing.
