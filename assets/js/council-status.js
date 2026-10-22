/* Deme — live Council status resolver.
   Pure, testable logic for the homepage Council status band: given
   the hand-maintained schedule in data/council-status.json, the
   upcoming items, and today's date (an ISO date string), it says
   which state Council is in and the plain-language words for it.
   It makes no requests and reads no globals, so Node tests can
   require it directly; in the browser it is window.DemeCouncilStatus.
   All date math runs on ISO date strings via UTC day numbers — no
   visitor timezone can drift a date. "Today" for the browser is
   derived in America/Toronto, where Council sits, via
   todayInToronto() below. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) root.DemeCouncilStatus = api;
})(typeof window !== "undefined" ? window
  : (typeof globalThis !== "undefined" ? globalThis : null), function () {
  "use strict";

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday"];
  const MONTHS_FULL = ["January", "February", "March", "April", "May",
    "June", "July", "August", "September", "October", "November",
    "December"];

  /* "2026-07-29" -> {y, m, d} or null. Only the date part is read. */
  function parseISO(iso) {
    if (typeof iso !== "string") return null;
    const parts = iso.slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return null;
    }
    return { y: parts[0], m: parts[1], d: parts[2] };
  }

  /* Whole days since the epoch for an ISO date, in UTC — the only
     arithmetic used here, so differences are exact calendar days. */
  function dayNumber(iso) {
    const p = parseISO(iso);
    if (!p) return null;
    return Date.UTC(p.y, p.m - 1, p.d) / 86400000;
  }

  /* Whole calendar days from one ISO date to another (b - a). */
  function diffDays(a, b) {
    const na = dayNumber(a), nb = dayNumber(b);
    if (na == null || nb == null) return null;
    return nb - na;
  }

  /* "Wednesday, July 29, 2026" — weekday-aware, unlike fmtDate in
     common.js, which these sentences need and fmtDate does not give.
     The weekday comes from the UTC date, so it cannot drift. */
  function formatFullDate(iso) {
    const p = parseISO(iso);
    if (!p) return String(iso || "");
    const wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    return `${wd}, ${MONTHS_FULL[p.m - 1]} ${p.d}, ${p.y}`;
  }

  /* "July 29, 2026" — the long form without a weekday. */
  function formatLongDate(iso) {
    const p = parseISO(iso);
    if (!p) return String(iso || "");
    return `${MONTHS_FULL[p.m - 1]} ${p.d}, ${p.y}`;
  }

  /* Today in Toronto, as an ISO date string, whatever zone the
     visitor's device is in. Assembled from parts so the result is
     always YYYY-MM-DD. */
  function todayInToronto(now) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now || new Date());
    const get = (t) => (parts.find((x) => x.type === t) || {}).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  const dayWord = (n) => (n === 1 ? "day" : "days");

  /* resolve(statusData, councilItems, todayISO)
     -> {state, headline, body, nextMeetingDate, daysUntil, items}
     councilItems is the raw upcoming items array; the City Council
     filter is enforced here too (defence in depth, matching the
     homepage's own filter), so housekeeping bodies can never be
     returned as Council business. Inputs are never mutated. */
  function resolve(statusData, councilItems, todayISO) {
    const data = statusData && typeof statusData === "object"
      ? statusData : {};
    const today = typeof todayISO === "string" && parseISO(todayISO)
      ? todayISO.slice(0, 10) : todayInToronto();
    const allItems = Array.isArray(councilItems) ? councilItems : [];
    const council = allItems.filter(
      (u) => u && u.body === "City Council");
    const itemDate = (u) =>
      (typeof u.date === "string" ? u.date.slice(0, 10) : "");

    const electionDate = data.electionDate || "2026-10-26";
    const newTermStart = data.newTermStart || "2026-11-15";
    const oldTermLast = data.oldTermLastMeetingDate || null;
    const firstNewTerm = data.firstNewTermMeetingDate || null;

    /* Every known Council meeting date: the hand-maintained list,
       the published first new-term date if there is one, and the
       dates of the City Council items passed in. */
    const known = new Set(
      (Array.isArray(data.meetingDates) ? data.meetingDates : [])
        .filter((d) => parseISO(d))
        .map((d) => d.slice(0, 10)));
    if (firstNewTerm && parseISO(firstNewTerm)) {
      known.add(firstNewTerm.slice(0, 10));
    }
    council.forEach((u) => {
      const d = itemDate(u);
      if (parseISO(d)) known.add(d);
    });
    const knownSorted = Array.from(known).sort();
    const nextAfter = (iso) =>
      knownSorted.find((d) => diffDays(iso, d) > 0) || null;

    /* a. MEETING_DAY — today is a Council meeting date. */
    if (known.has(today)) {
      return {
        state: "MEETING_DAY",
        headline: "Council meets today",
        body: `City Council meets today, ${formatFullDate(today)}.`,
        nextMeetingDate: today,
        daysUntil: 0,
        items: council.filter((u) => itemDate(u) === today),
      };
    }

    /* b. NEW_TERM — the new Council has taken office. A meeting
       today was already claimed by MEETING_DAY above. */
    if (parseISO(newTermStart) && diffDays(newTermStart, today) >= 0) {
      const next = (firstNewTerm && diffDays(today, firstNewTerm) > 0)
        ? firstNewTerm.slice(0, 10) : nextAfter(today);
      if (next) {
        const n = diffDays(today, next);
        return {
          state: "NEW_TERM",
          headline: "The new Council is in office",
          body: `The new Council has taken office. Council next meets on ${formatFullDate(next)} — ${n} ${dayWord(n)}.`,
          nextMeetingDate: next,
          daysUntil: n,
          items: council,
        };
      }
      return {
        state: "NEW_TERM",
        headline: "The new Council is in office",
        body: "The new Council has taken office. Its first meeting date will appear here when the City publishes it.",
        nextMeetingDate: null,
        daysUntil: null,
        items: council,
      };
    }

    /* c. ELECTION_RECESS — after the old term's last meeting and
       before the new term starts, with no Council meeting date
       falling between today and the new term. */
    const intervening = knownSorted.some(
      (d) => diffDays(today, d) > 0 && diffDays(d, newTermStart) > 0);
    if (oldTermLast && parseISO(oldTermLast)
        && diffDays(oldTermLast, today) > 0
        && diffDays(today, newTermStart) > 0
        && !intervening) {
      const rel = diffDays(electionDate, today);
      const votes = rel === 0
        ? `Toronto votes today, ${formatFullDate(electionDate)}.`
        : (rel > 0
          ? `Toronto voted ${formatFullDate(electionDate)}.`
          : `Toronto votes ${formatFullDate(electionDate)}.`);
      return {
        state: "ELECTION_RECESS",
        headline: "Election recess",
        body: `City Council is in election recess. ${votes} The new Council takes office ${formatLongDate(newTermStart)}.`,
        nextMeetingDate: firstNewTerm || null,
        daysUntil: null,
        items: council,
      };
    }

    /* d. BETWEEN_MEETINGS — a next meeting date is known. */
    const next = nextAfter(today);
    if (next) {
      const n = diffDays(today, next);
      return {
        state: "BETWEEN_MEETINGS",
        headline: "Next Council meeting",
        body: `Council next meets on ${formatFullDate(next)} — ${n} ${dayWord(n)}.`,
        nextMeetingDate: next,
        daysUntil: n,
        items: council,
      };
    }

    /* e. FALLBACK — nothing determinable. Say when the schedule was
       checked; never invent a date. */
    const checked = data.scheduleCheckedOn
      ? ` The schedule was last checked on ${formatLongDate(data.scheduleCheckedOn)}.`
      : "";
    return {
      state: "FALLBACK",
      headline: "No meeting date published yet",
      body: `No next Council meeting date is published yet.${checked}`,
      nextMeetingDate: null,
      daysUntil: null,
      items: council,
    };
  }

  return { resolve, formatFullDate, formatLongDate, todayInToronto,
    diffDays };
});
