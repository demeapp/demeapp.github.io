/* Node tests for the Council status resolver.
   Run from the repo root:  node tests/council-status.test.mjs
   Fixtures use only the verified 2026 facts in
   data/council-status.json (plus injected variants where a case
   says so). Not shipped in data/. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const status = require("../assets/js/council-status.js");

assert.equal(typeof status.resolve, "function",
  "resolver is exported for Node");

const base = {
  scheduleCheckedOn: "2026-10-22",
  electionDate: "2026-10-26",
  newTermStart: "2026-11-15",
  oldTermLastMeetingDate: "2026-07-29",
  meetingDates: ["2026-02-04", "2026-02-10", "2026-03-25",
    "2026-04-22", "2026-05-20", "2026-06-24", "2026-07-29"],
  firstNewTermMeetingDate: null,
};

/* (i) Meeting day: only that day's City Council items come back;
   a same-day Toronto Parking Authority item is housekeeping and
   is excluded, as is a Council item from another day. */
{
  const items = [
    { ref: "2026.MM1.1", date: "2026-07-29", body: "City Council",
      title: "Council item on the day" },
    { ref: "2026.PA1.1", date: "2026-07-29",
      body: "Toronto Parking Authority", title: "Housekeeping" },
    { ref: "2026.MM2.1", date: "2026-06-24", body: "City Council",
      title: "Council item on another day" },
  ];
  const r = status.resolve(base, items, "2026-07-29");
  assert.equal(r.state, "MEETING_DAY");
  assert.equal(r.nextMeetingDate, "2026-07-29");
  assert.equal(r.daysUntil, 0);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].ref, "2026.MM1.1");
  assert.ok(r.body.includes("meets today"));
  console.log("ok (i) MEETING_DAY filters to today's Council items");
}

/* (ii) The day before a meeting: between meetings, 1 day out. */
{
  const r = status.resolve(base, [], "2026-07-28");
  assert.equal(r.state, "BETWEEN_MEETINGS");
  assert.equal(r.nextMeetingDate, "2026-07-29");
  assert.equal(r.daysUntil, 1);
  assert.ok(r.body.includes("1 day"));
  assert.equal(r.body,
    "Council next meets on Wednesday, July 29, 2026 — 1 day.");
  console.log("ok (ii) BETWEEN_MEETINGS with singular 1 day");
}

/* (iii) Election recess on Oct 22, 2026: the exact body sentence. */
{
  const r = status.resolve(base, [], "2026-10-22");
  assert.equal(r.state, "ELECTION_RECESS");
  assert.equal(r.headline, "Election recess");
  assert.equal(r.body,
    "City Council is in election recess. Toronto votes Monday, October 26, 2026. The new Council takes office November 15, 2026.");
  console.log("ok (iii) ELECTION_RECESS exact Oct 22 body");
}

/* (iv) Election day itself: Toronto votes today. */
{
  const r = status.resolve(base, [], "2026-10-26");
  assert.equal(r.state, "ELECTION_RECESS");
  assert.ok(r.body.includes(
    "Toronto votes today, Monday, October 26, 2026."));
  console.log("ok (iv) ELECTION_RECESS votes today on Oct 26");
}

/* (iv-b) After election day, still in recess: Toronto voted. */
{
  const r = status.resolve(base, [], "2026-11-01");
  assert.equal(r.state, "ELECTION_RECESS");
  assert.ok(r.body.includes(
    "Toronto voted Monday, October 26, 2026."));
  console.log("ok (iv-b) ELECTION_RECESS voted after Oct 26");
}

/* (v) New term, no first meeting date published yet. */
{
  const r = status.resolve(base, [], "2026-11-15");
  assert.equal(r.state, "NEW_TERM");
  assert.equal(r.nextMeetingDate, null);
  assert.equal(r.daysUntil, null);
  assert.ok(r.body.includes("has taken office"));
  assert.ok(r.body.includes(
    "first meeting date will appear here when the City publishes it"));
  console.log("ok (v) NEW_TERM unpublished wording");
}

/* (vi) New term with a published first meeting date injected:
   named, with a plain 24-day countdown from Nov 15 to Dec 9. */
{
  const variant = { ...base, firstNewTermMeetingDate: "2026-12-09" };
  const r = status.resolve(variant, [], "2026-11-15");
  assert.equal(r.state, "NEW_TERM");
  assert.equal(r.nextMeetingDate, "2026-12-09");
  assert.equal(r.daysUntil, 24);
  assert.ok(r.body.includes("Wednesday, December 9, 2026"));
  assert.ok(r.body.includes("24 days"));
  console.log("ok (vi) NEW_TERM names Dec 9 with 24-day countdown");
}

/* (vii) Fallback: no meeting dates at all and no other state
   applies — no date is invented; the checked-on date is stated. */
{
  const empty = { ...base, meetingDates: [] };
  const r = status.resolve(empty, [], "2026-01-15");
  assert.equal(r.state, "FALLBACK");
  assert.equal(r.nextMeetingDate, null);
  assert.ok(r.body.includes("last checked on October 22, 2026"));
  assert.ok(!/\blive\b/i.test(r.body));
  console.log("ok (vii) FALLBACK states the checked-on date");
}

console.log("All council-status tests passed.");
