# Site data tools

Scripts that keep the published snapshot honest. Run them from the repo root
whenever `data/*.json` is regenerated.

## How the app loads data (shard layout)

`index.html` paints from `data/demo-bootstrap.json` (~85 KB with
`councillors.json`), then lazy-loads only what the open view needs:

- `data/search-index.json` — every item's ref/date/decision-body/title, the
  member manifest, and per-ward decided/carried aggregates.
- `data/topics-index.json` — each item's topics string, verbatim; the app
  normalizes it with its own `splitTopics`.
- `data/items-YYYY.json` / `data/votes-YYYY.json` / `data/briefs-YYYY.json`
  — full items, recorded vote rows, and plain-language briefs for one year
  (shard year = the item's date year).
- `data/member-<slug>.json` — one member's vote rows plus precomputed
  Yes/No overlap counts; profiles and compare derive attendance, term
  totals, and agreement from these alone.
- Small packs on demand: `wardImpact.json`, `profiles.json`,
  `votingBlocs.json`, `financialImpacts.json`, `costEstimates.json`,
  `declarations.json`.

`data/items.json`, `data/itemVotes.json`, and `data/simpleBriefs.json` stay
in the repo as pipeline sources but are **never fetched by the app**;
`data/memberVotes.json` is likewise kept only as a source (member votes are
derived from the member shards). Full-text search is the one view that
pulls every year shard; everything else stays per-year or per-member.

## `build-demo-bootstrap.py`

    python3 tools/build-demo-bootstrap.py

Writes `data/demo-bootstrap.json`: the demo's pinned items (parsed from the
`DEMO_REFS` declaration in `index.html`), the hero vote item, their recorded
vote rows, their ward-impact chips, and the headline counts. The app paints
from this file before any shard is requested. The script fails loudly if a
pinned ref disappears from the snapshot, or if any `itemVotes` ref has no
matching item in `items.json`.

## `build-shards.py`

    python3 tools/build-shards.py

Generates the search/topics indexes, the year shards, and the member files
from `items.json` + `itemVotes.json` + `simpleBriefs.json` +
`wardImpact.json`. Fails loudly (exit 1, listing every violation) if shard
totals do not sum exactly to the monoliths, if any `itemVotes` ref has no
matching item, or if member-file term totals disagree with the monoliths.

## `check-data-snapshot.py`

    python3 tools/check-data-snapshot.py

Read-only assertions over the whole snapshot: vote refs resolve to items,
`termVotes.json` matches the totals derivable from the record, career
interest-declared counts match the record, simple briefs pass QA, the demo
bootstrap is fresh, and the shards sum exactly to the monoliths (invariant
6, including that `index.html` never references the monoliths). Exits
non-zero and lists every violation.

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
5. `python3 tools/build-shards.py` (year shards, member files, indexes).
6. `python3 tools/check-data-snapshot.py` — must pass before committing.
