/* Briefing v2 — pure helpers for the Ontario / federal sections
   (Backend Three, item 3, Oct 29, 2026).

   Everything here is a pure function of its arguments: no DOM, no
   fetches, no storage. briefing-v2.js does the loading and rendering;
   these helpers do the matching and the arithmetic, so the logic can
   be tested off-page (tests/test_briefing_v2.js runs them in node
   against the real layer files).

   Honesty rules carried from v1 and the layer pages:
   - a riding resolves only to a CURRENT member whose stored riding
     name matches (dash/case-insensitively); zero or multiple matches
     resolve to null — never a guess. Zero matches on a real riding
     means the seat is vacant or the riding is not in the layer, and
     the caller says which with its own line.
   - a member's vote is shown verbatim from the stored ballot rows;
     divisions outside the window or missing from the layer file are
     simply not shown — nothing is backfilled or inferred.
   - recorded-vote participation is not computed here and is never
     called "attendance" anywhere in the briefing. */
(function (global) {
  "use strict";

  function normRiding(s) {
    return String(s == null ? "" : s)
      .replace(/[\u2014\u2013]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function memberForRiding(directoryRows, riding) {
    const want = normRiding(riding);
    if (!want) return null;
    const hits = (directoryRows || []).filter(
      (r) => r && r.current && normRiding(r.riding) === want);
    return hits.length === 1 ? hits[0] : null;
  }

  const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11,
    december: 12,
  };

  /* Ontario's divisions.json stores dates as "June 2, 2026". */
  function ontarioDateToISO(s) {
    const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s || "").trim());
    if (!m) return null;
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    const dd = String(Number(m[2])).padStart(2, "0");
    const mm = String(mo).padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }

  /* rows: the member file's combined [divisionIndex, vote] pairs.
     getDivision(index): the layer's division row for that index, or
     undefined. Returns the in-window votes, newest first. */
  function windowVotes(rows, getDivision, startISO, endISO, layer) {
    const out = [];
    for (const pair of rows || []) {
      if (!Array.isArray(pair)) continue;
      const idx = pair[0];
      const d = getDivision(idx);
      if (!d) continue;
      const iso = layer === "ontario" ? ontarioDateToISO(d.date) : d.date;
      if (!iso || iso < startISO || iso > endISO) continue;
      out.push({
        index: idx,
        date: iso,
        vote: pair[1],
        title: layer === "ontario" ? d.title : d.subject,
        outcome: layer === "ontario" ? d.outcome : d.result,
        url: layer === "ontario" ? (d.billUrl || null) : (d.url || null),
        ayes: layer === "ontario" ? d.ayes : null,
        nays: layer === "ontario" ? d.nays : null,
      });
    }
    out.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : b.index - a.index);
    return out;
  }

  global.DemeBriefingLayers = {
    normRiding, memberForRiding, ontarioDateToISO, windowVotes,
  };
})(typeof window !== "undefined" ? window : this);
