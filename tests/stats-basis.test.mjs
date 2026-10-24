/* Stats-basis guard (Phase 2 audit P0-5, Wave 1) — build-path test.
 *
 * The 743,677 headline in record-data/stats.json is aggregate-inclusive:
 * 157,292 stored name-by-name vote rows (2018+) plus 586,385 aggregate-
 * only rows from the pre-2018 layer. The bare fields (voteRows,
 * votesFrom) may only ship alongside their machine-readable basis
 * annotation; if a future refresh drops or desyncs the annotation, this
 * test fails and the build must not ship. The same run asserts the
 * P0-5 field rename holds in the data: no member record may carry the
 * old `attendance` key again.
 *
 * Run: node tests/stats-basis.test.mjs   (exit 0 = pass)
 */
import { readFile } from "node:fs/promises";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : " — " + detail}`);
  if (!ok) failures += 1;
};

const stats = JSON.parse(
  await readFile(new URL("../record-data/stats.json", import.meta.url), "utf8"));
const people = JSON.parse(
  await readFile(new URL("../record-data/councillors.json", import.meta.url), "utf8"));

/* The bare headline fields, if present, must carry their basis. */
check("basis annotation present (voteRowsBasis)",
  stats.voteRowsBasis === "aggregates-plus-stored",
  `voteRowsBasis=${JSON.stringify(stats.voteRowsBasis)}`);
check("stored-row count present (voteRowsStored = 157292)",
  stats.voteRowsStored === 157292,
  `voteRowsStored=${JSON.stringify(stats.voteRowsStored)}`);
check("stored rows bounded to 2018+ (voteRowsStoredFrom)",
  stats.voteRowsStoredFrom === "2018",
  `voteRowsStoredFrom=${JSON.stringify(stats.voteRowsStoredFrom)}`);
check("aggregate-only remainder present (voteRowsAggregateOnly = 586385)",
  stats.voteRowsAggregateOnly === 586385,
  `voteRowsAggregateOnly=${JSON.stringify(stats.voteRowsAggregateOnly)}`);
check("basis reconciles: stored + aggregate-only = headline voteRows",
  stats.voteRowsStored + stats.voteRowsAggregateOnly === stats.voteRows,
  `${stats.voteRowsStored} + ${stats.voteRowsAggregateOnly} !== ${stats.voteRows}`);
check("basis documented in prose (documentation.voteRowsBasis)",
  typeof (stats.documentation && stats.documentation.voteRowsBasis) === "string"
    && stats.documentation.voteRowsBasis.length > 0,
  "documentation.voteRowsBasis missing or empty");
check("votesFrom carries its aggregate-inclusive basis note",
  typeof stats.votesFromBasis === "string" && stats.votesFromBasis.length > 0,
  `votesFromBasis=${JSON.stringify(stats.votesFromBasis)}`);

/* The rename guard: the old field name cannot return in the data. */
const withAttendance = people.filter((p) => "attendance" in p);
check("no member record carries the old 'attendance' key",
  withAttendance.length === 0,
  `${withAttendance.length} record(s) carry it`);
const withParticipation = people.filter((p) => "participation" in p);
check("every member record carries the 'participation' key",
  withParticipation.length === people.length,
  `${withParticipation.length}/${people.length} carry it`);

console.log(failures === 0 ? "\nALL CHECKS PASS" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
