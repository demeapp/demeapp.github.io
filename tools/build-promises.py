#!/usr/bin/env python3
"""Build the campaign-promise data pack for the site from the QA-passed
evidence-first curation in the data pool (and only from it — the old
runtime keyword matcher is gone).

    python3 tools/build-promises.py [--curated PATH]

Writes:
  - data/promises.json  (lazy-loaded by the app on profile views only —
                         never part of first paint)

Source of truth: the pool's promises/promises-curated.json (94 atomic
claims across 29 members; 34 linked to 73 agenda items; 60 carried as
no_direct_record with a plain-English reason each; Led proven only from
item titles). The editorial rules live in that file's AUDIT.md; this
script only projects it into the site's pack shape and re-checks the
invariants the curation claimed. It also verifies, against the site's
own data/profiles.json, that every claim's promise_idx still points at
the promise it was curated from (same source URL) — if profiles.json is
regenerated with a different promise order, this build fails loudly
instead of quietly mis-attributing claims.

Fails loudly (exit 1) if the curated export drifts from the pinned
counts, if any claim's counts do not re-derive from its entries, if any
evidence ref is unusable, or if the profiles cross-check fails.
"""
import json, os, sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURATED_DEFAULT = ("~/workspace/goals/ourvote-civic-engagement-app/"
                   "data-pool/promises/promises-curated.json")

# Pinned shape of the 2026-10-09 curation (drift guards).
PIN = {
    "members": 29,
    "claims_total": 94,
    "claims_linked": 34,
    "claims_no_direct_record": 60,
    "evidence_entries": 73,
    "evidence_led": 7,
}
MEMBERS_ZERO_CLAIMS = {"Frances Nunziata", "Shelley Carroll"}


def fail(msg):
    print("BUILD-PROMISES FAILED: " + msg, file=sys.stderr)
    sys.exit(1)


def item_page_slug(ref):
    """Static item pages live at items/<slug>/ for council items only;
    returns the slug when the page exists, else None (the app then links
    the in-app item view instead)."""
    slug = ref.lower().replace(".", "-")
    if os.path.isdir(os.path.join(SITE, "items", slug)):
        return slug
    return None


def main():
    curated_path = os.path.expanduser(
        sys.argv[sys.argv.index("--curated") + 1]
        if "--curated" in sys.argv else CURATED_DEFAULT)
    if not os.path.exists(curated_path):
        fail(f"missing curated source: {curated_path}")
    curated = json.load(open(curated_path, encoding="utf-8"))
    profiles = json.load(open(os.path.join(SITE, "data", "profiles.json"),
                              encoding="utf-8"))

    members_in = curated.get("members")
    if not isinstance(members_in, list):
        fail("curated file has no members list")

    # ---- profiles cross-check: promise_idx must still line up ----
    problems = []
    for mem in members_in:
        name = mem["member"]
        dossier = profiles.get(name)
        if dossier is None:
            problems.append(f"{name}: no dossier in data/profiles.json")
            continue
        plist = dossier.get("promises") or []
        for claim in mem["claims"]:
            pi = claim["promise_idx"]
            if not (0 <= pi < len(plist)):
                problems.append(
                    f"{name}/{claim['id']}: promise_idx {pi} out of range "
                    f"(dossier has {len(plist)} promises)")
            elif (plist[pi].get("source") or None) != (claim["source_url"] or None):
                problems.append(
                    f"{name}/{claim['id']}: source drift — curated "
                    f"{claim['source_url']!r} vs profiles "
                    f"{plist[pi].get('source')!r}")
    if problems:
        for p in problems:
            print("  " + p, file=sys.stderr)
        fail(f"{len(problems)} profiles cross-check problem(s) — "
             "profiles.json promise order has drifted from the curation")

    # ---- project + re-derive every count ----
    members_out = {}
    n_claims = n_linked = n_norecord = n_ev = n_led = 0
    seen_members = set()
    for mem in members_in:
        name = mem["member"]
        if name in seen_members:
            fail(f"duplicate member in curated file: {name}")
        seen_members.add(name)
        rows = []
        for claim in mem["claims"]:
            ev = []
            led = sup = opp = 0
            for e in claim["evidence"]:
                role = e["role"]
                if role == "Led":
                    led += 1
                elif role == "Supported":
                    sup += 1
                elif role == "Opposed":
                    opp += 1
                else:
                    fail(f"{name}/{claim['id']}: unknown role {role!r}")
                if e["vote"] not in ("Yes", "No"):
                    fail(f"{name}/{claim['id']}/{e['ref']}: vote "
                         f"{e['vote']!r} is not Yes/No")
                if role == "Opposed" and e["vote"] != "No":
                    fail(f"{name}/{claim['id']}/{e['ref']}: Opposed with "
                         f"vote {e['vote']!r}")
                if role in ("Led", "Supported") and e["vote"] != "Yes":
                    fail(f"{name}/{claim['id']}/{e['ref']}: {role} with "
                         f"vote {e['vote']!r}")
                ev.append({
                    "ref": e["ref"],
                    "date": e["date"],
                    "title": e["title"],
                    "result": e["result"],
                    "vote": e["vote"],
                    "role": role,
                    "why": e["why"],
                    "body": e["decision_body"],
                    "ds": e["date_source"],
                    "page": item_page_slug(e["ref"]),
                })
            counts = claim["counts"]
            if (counts["led"], counts["supported"], counts["opposed"]) != (led, sup, opp):
                fail(f"{name}/{claim['id']}: counts drift — curated "
                     f"{counts} vs re-derived led={led} sup={sup} opp={opp}")
            if led + sup + opp != len(claim["evidence"]):
                fail(f"{name}/{claim['id']}: counts do not cover entries")
            status = claim["status"]
            if status == "linked" and not ev:
                fail(f"{name}/{claim['id']}: status linked with no evidence")
            if status == "no_direct_record":
                if ev:
                    fail(f"{name}/{claim['id']}: no_direct_record with evidence")
                if not (claim.get("note") or "").strip():
                    fail(f"{name}/{claim['id']}: no_direct_record without "
                         "a plain-English reason note")
                n_norecord += 1
            elif status == "linked":
                n_linked += 1
            else:
                fail(f"{name}/{claim['id']}: unknown status {status!r}")
            if len(claim["short_title"].split()) > 7:
                fail(f"{name}/{claim['id']}: short_title over 7 words: "
                     f"{claim['short_title']!r}")
            n_claims += 1
            n_ev += len(ev)
            n_led += led
            rows.append({
                "id": claim["id"],
                "t": claim["short_title"],
                "c": claim["claim_text"],
                "s": claim["source_url"],
                "pi": claim["promise_idx"],
                "st": status,
                "note": claim.get("note"),
                "led": led,
                "sup": sup,
                "opp": opp,
                "ev": ev,
            })
        members_out[name] = rows

    # ---- pinned drift guards ----
    got = {
        "members": len(members_in),
        "claims_total": n_claims,
        "claims_linked": n_linked,
        "claims_no_direct_record": n_norecord,
        "evidence_entries": n_ev,
        "evidence_led": n_led,
    }
    for key, want in PIN.items():
        if got[key] != want:
            fail(f"pinned {key} drifted: expected {want}, got {got[key]} — "
                 "if the curation was rebuilt on purpose, update PIN and "
                 "AUDIT.md together")
    zero = {m["member"] for m in members_in if not m["claims"]}
    if zero != MEMBERS_ZERO_CLAIMS:
        fail(f"zero-claims member set drifted: {sorted(zero)}")
    # Named spot-checks (the only Opposed on the site; a title-proven Led).
    myers = {c["id"]: c for c in members_out["Jamaal Myers"]}
    if myers["myers-rooming-houses"]["opp"] != 1:
        fail("Jamaal Myers rooming-houses Opposed count drifted from 1")
    matlow = {c["id"]: c for c in members_out["Josh Matlow"]}
    if matlow["matlow-eglinton-inquiry"]["led"] != 1:
        fail("Josh Matlow Eglinton-inquiry Led count drifted from 1")

    payload = {
        "meta": {
            "source": "Campaign promises from members' own campaign "
                      "material, curated item-by-item against the "
                      "recorded vote (data pool, 2026-10-09).",
            "members": got["members"],
            "claims": n_claims,
            "claimsWithRecord": n_linked,
            "evidenceItems": n_ev,
        },
        "m": members_out,
    }
    out = os.path.join(SITE, "data", "promises.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"data/promises.json: {os.path.getsize(out):,} bytes, "
          f"{got['members']} members, {n_claims} claims "
          f"({n_linked} with a record, {n_norecord} no direct record), "
          f"{n_ev} evidence items ({n_led} Led)")


if __name__ == "__main__":
    main()
