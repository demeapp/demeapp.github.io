/* Alignment bucket fixtures — Phase 2 audit P0-2 / A-2 (Wave 1, Oct 24, 2026).
   Runs the ALIGNMENT CORE section of assets/js/record.js in Node, the same
   extraction the spec's §10 fixture runner uses, and drives tallyAlignment
   end-to-end (picks + people + detailByRef) for each bucket case:
   named vote, absent, interest, no-Council-vote, tally-only (B5),
   pre-office (B6), no-row in-office (B4), and the A-2 multi-motion cases.
   The invariant under test: missing data is NEVER rendered as agreement
   or disagreement, and a service-date reason is given only when the
   member's term buckets genuinely exclude the item's year.
   Run: node tests/alignment-buckets.test.mjs  (exit 1 on any failure) */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "..", "assets", "js", "record.js"), "utf8");
const start = src.indexOf("function comparableVote");
const end = src.indexOf("/* === END ALIGNMENT CORE === */");
if (start < 0 || end < 0 || end < start) {
  console.error("FAIL: ALIGNMENT CORE markers not found in record.js");
  process.exit(1);
}
let simple = false;
globalThis.simpleOn = () => simple;
const core = new Function(`${src.slice(start, end)}; return { comparableVote, tallyAlignment, alignmentCopy };`)();
const { tallyAlignment, alignmentCopy } = core;

const MEMBER = "Test Member";
const people = [{ name: MEMBER, slug: "test-member", current: true, ward: 1,
  terms: ["2022-2026"] }];
const cc = (votes, extra = {}) => ({ stage: "City Council", when: "2024-03-20 9:30 AM",
  desc: "Adopt Item", result: "Carried", votes, ...extra });
const run = (detail, choice = "support") => tallyAlignment(
  { "2099.TE1.1": { choice } }, 1, people, { "2099.TE1.1": { detail } });
const copy = (t) => alignmentCopy(t, MEMBER, 1).explainer.join("\n");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures += 1;
};

/* 1 — named vote: comparable, and matched when the pick aligns. */
let t = run({ motions: [cc([[MEMBER, "Yes"], ["Other", "No"]], { yes: 1, no: 1 })] });
check("named vote counts comparable+matched", t.comparable === 1 && t.matched === 1 && t.decided === 1, JSON.stringify(t));
t = run({ motions: [cc([[MEMBER, "Yes"]], { yes: 1, no: 0 })] }, "oppose");
check("named vote against the pick: comparable, not matched", t.comparable === 1 && t.matched === 0, JSON.stringify(t));

/* 2 — absent → B1. */
t = run({ motions: [cc([[MEMBER, "Absent"], ["Other", "Yes"]], { yes: 1, no: 0 })] });
check("absent lands in B1", t.B1 === 1 && t.comparable === 0, JSON.stringify(t));

/* 3 — interest → B2. */
t = run({ motions: [cc([[MEMBER, "Absent(Interest Declared)"], ["Other", "Yes"]], { yes: 1, no: 0 })] });
check("interest lands in B2", t.B2 === 1 && t.comparable === 0, JSON.stringify(t));

/* 4 — no Council-stage motion at all → B3. */
t = run({ motions: [{ stage: "Toronto and East York Community Council", when: "2024-03-01", votes: [[MEMBER, "Yes"]] }] });
check("committee-only item lands in B3", t.B3 === 1, JSON.stringify(t));

/* 5 — TALLY-ONLY (P0-2): a Council motion carrying the data's tallyOnly
   flag (real shape: votes [], yes/no null, tally in the result string —
   e.g. record-data/d/2018.EP10.10.json) must land in B5, and its
   explainer must blame the tally — never the member's service dates. */
t = run({ motions: [cc([], { yes: null, no: null, tallyOnly: true, result: "Carried, 18-3" })] });
check("tally-only motion lands in B5 (not B4)", t.B5 === 1 && t.B4 === 0 && t.B6 === 0 && t.comparable === 0, JSON.stringify(t));
check("B5 explainer names the tally-only reason", /tally only/.test(copy(t)), copy(t));
check("B5 explainer gives NO service-date reason", !/took office/.test(copy(t)), copy(t));
simple = true;
check("B5 simpler text names the tally too", /only the tally/.test(copy(t)) && !/took office/.test(copy(t)), copy(t));
simple = false;

/* 6 — PRE-OFFICE (B6): named Council votes exist, the member is in none,
   and the item's year (2015) is outside the member's terms (2022–2026):
   only here may the explainer use the service-date reason. */
t = run({ motions: [cc([["Other", "Yes"], ["Another", "No"]], { yes: 1, no: 1, when: "2015-06-10 9:30 AM" })] });
check("pre-office item lands in B6", t.B6 === 1 && t.B4 === 0 && t.B5 === 0, JSON.stringify(t));
check("B6 explainer may use the service-date reason", /before they took office/.test(copy(t)), copy(t));

/* 7 — NO-ROW IN OFFICE (B4): same shape as 6 but the item is from 2024,
   inside the member's terms — the service-date reason must NOT appear. */
t = run({ motions: [cc([["Other", "Yes"], ["Another", "No"]], { yes: 1, no: 1 })] });
check("in-office no-row lands in B4", t.B4 === 1 && t.B6 === 0 && t.B5 === 0, JSON.stringify(t));
check("B4 explainer says the vote does not list the member", /does not list/.test(copy(t)), copy(t));
check("B4 explainer gives NO service-date reason", !/took office/.test(copy(t)), copy(t));

/* 8 — A-2 MASKING: first Council motion is tally-only, a later Council
   motion on the same item carries the member's named vote. The vote must
   be found — the tally-only first motion must not mask it. */
t = run({ motions: [cc([], { yes: null, no: null, tallyOnly: true, result: "Carried, 20-1" }), cc([[MEMBER, "No"], ["Other", "Yes"]], { yes: 1, no: 1 })] }, "oppose");
check("A-2: later named vote is found past a tally-only first motion", t.comparable === 1 && t.matched === 1 && t.B5 === 0, JSON.stringify(t));

/* 9 — A-2 MASKING (named-first variant): first Council motion has named
   rows but not the member's; a later one has the member's row. */
t = run({ motions: [cc([["Other", "Yes"]], { yes: 1, no: 0 }), cc([[MEMBER, "Yes"], ["Other", "No"]], { yes: 1, no: 1 })] });
check("A-2: later named vote is found past a member-less first motion", t.comparable === 1 && t.matched === 1, JSON.stringify(t));

/* 10 — Council motion with an empty vote list and NO tallyOnly flag:
   no record at all → B3 (decided without a recorded vote), never B5/B4. */
t = run({ motions: [cc([], {})] });
check("empty motion with no tally lands in B3", t.B3 === 1 && t.B5 === 0 && t.B4 === 0, JSON.stringify(t));

/* 11 — preservation: nothing above ever counted missing data as a vote. */
t = run({ motions: [cc([], { yes: null, no: null, tallyOnly: true, result: "Carried, 18-3" })] }, "support");
check("tally-only never renders as agreement or disagreement", t.matched === 0 && t.comparable === 0 && t.decided === 1, JSON.stringify(t));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL FIXTURES PASS");
process.exit(failures ? 1 : 0);
