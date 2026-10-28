/* "Your week on the record" — the on-site weekly briefing inside
   My Record (product wave INC4, Oct 28, 2026).

   What this is: a page section the visitor opens. It assembles, in
   the browser, the last 7 days of the Toronto record against the
   visitor's own profile — their ward's decisions, how their
   councillor voted, their topics, their decided watches, and what
   is coming up at Council. It is a pull surface only: nothing is
   sent anywhere, nothing arrives, and no copy here may imply
   otherwise. It never reads or reuses the profiles alerts_opt_in
   consent (that consent is for email digests; this page is not
   email, not an alert, and not a digest delivery).

   Whose data: only the visitor's own. The profile comes from the
   same resolution record.js uses — profileWard() when it is
   reachable (signed in: the VoteStore ward, which account.js
   mirrors from the account profile row; signed out with live
   accounts: no ward at all), otherwise the identical logic inline.
   Interests and the watched ward read VoteStore, the same mirror
   record.js's own sections render from. Watches read
   DemeAccount.getWatches(), which returns only the signed-in
   visitor's own rows (or that same visitor's stamped on-device
   cache) — there is no other visitor's data anywhere in this file,
   and no pick anyone made is ever tallied, aggregated or shown to
   anyone else.

   Scope: Toronto only, and labelled so. The profile stores a
   Toronto ward and nothing at any other level, so no Ontario or
   federal content is personalised here. Recorded-vote participation
   is never called "attendance" (it is not used here at all).

   Data: no new server storage, no new files. The scan replicates
   personalize.js's pattern over record-data/search-lite-YYYY.json
   tuples [ref, date, wards, position], hydrated from
   record-data/index-YYYY.json and rendered with common.js's
   decisionCard(). Section B reads record-data/recent-votes.json.
   Section C reads record-data/threads.json. Section E reads
   record-data/upcoming.json filtered to City Council, the same
   filter record.js applies.

   Seen-at: deliberately NOT implemented. VoteStore's read path
   (common.js shape()) whitelists its fields, so a briefingSeenAt
   field written into deme.votes.v2 would be silently dropped by
   the next VoteStore write; there is no accessor for it, and
   adding one is outside this change. See the INC4 report. */
"use strict";

(function initBriefing() {
  const bodyEl = document.getElementById("briefing-body");
  if (!bodyEl) return;

  /* ---------------- dates (America/Toronto) ----------------
     council-status.js exposes todayInToronto(), but My Record does
     not load that script, so the same Intl computation runs here. */
  function todayInToronto() {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date());
      const get = (t) => (parts.find((x) => x.type === t) || {}).value;
      const iso = `${get("year")}-${get("month")}-${get("day")}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    } catch (e) { /* fall through to the UTC date */ }
    return new Date().toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return t.toISOString().slice(0, 10);
  }
  const inWindow = (date, start, end) =>
    typeof date === "string" && date >= start && date <= end;

  /* ---------------- profile resolution ----------------
     record.js's profileWard() is a top-level function declaration
     and this script loads after record.js, so it is callable; the
     inline fallback is the identical rule in case that ever
     changes. Nothing here writes a profile for anyone: a visitor
     with no ward gets the signpost and nothing else. */
  function briefingWard() {
    if (typeof profileWard === "function") {
      try { return profileWard(); } catch (e) { /* use the fallback */ }
    }
    if (window.DemeAccount && typeof window.DemeAccount.enabled === "function"
        && window.DemeAccount.enabled()
        && typeof window.DemeAccount.isSignedIn === "function"
        && !window.DemeAccount.isSignedIn()) return null;
    return (typeof VoteStore !== "undefined" && VoteStore.getWard)
      ? VoteStore.getWard() : null;
  }

  function renderSignpost() {
    bodyEl.innerHTML = `<div class="calm">
      <p class="calm-head">Set your Toronto ward to see your week on the record.</p>
      <p>Your ward is part of your profile.
      <a href="#account-zone">Set it in your account</a> above, and
      this section will gather your ward's week from the record.</p>
    </div>`;
  }

  /* ---------------- search-lite scan + hydration ----------------
     The personalize.js pattern, window-scoped: only the shards for
     the years the window touches are loaded. Tuples keep their
     bulk-index position so ordering matches the full index. */
  const cardCache = new Map();
  async function liteRows(start, end) {
    const idx = await loadJSON(dataPath("search-lite-index.json"));
    const years = (idx.years || []).filter((y) =>
      Number(y) >= Number(start.slice(0, 4))
      && Number(y) <= Number(end.slice(0, 4)));
    const rows = [];
    for (const y of years) {
      let tuples = [];
      try {
        tuples = await loadJSON(dataPath(`search-lite-${y}.json`));
      } catch (e) { tuples = []; /* one missing shard is not the week */ }
      for (const t of tuples || []) {
        rows.push({ ref: t[0], date: t[1],
          w: Array.isArray(t[2]) ? t[2] : [], year: String(y), _pos: t[3] });
      }
    }
    return rows;
  }
  async function hydrateCards(rows) {
    const need = rows.filter((r) => !cardCache.has(r.ref));
    const byYear = new Map();
    need.forEach((r) => {
      const y = String(r.year || String(r.date || "").slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r.ref);
    });
    await Promise.all([...byYear.keys()].map(async (y) => {
      try {
        const cards = await loadJSON(dataPath(`index-${y}.json`));
        const want = new Set(byYear.get(y));
        cards.forEach((c) => { if (want.has(c.ref)) cardCache.set(c.ref, c); });
      } catch (e) { /* cards that fail to hydrate are left out */ }
    }));
    return rows.map((r) => cardCache.get(r.ref) || null);
  }
  const byDateDesc = (a, b) =>
    (a.date < b.date ? 1 : a.date > b.date ? -1 : (a._pos || 0) - (b._pos || 0));
  function cardsHTML(cards) {
    return `<div class="cards two">${cards.map((c) => decisionCard(c)).join("")}</div>`;
  }

  /* ---------------- the render ---------------- */
  let rendering = false;
  let rerunQueued = false;
  async function render() {
    if (rendering) { rerunQueued = true; return; }
    rendering = true;
    try {
      /* The account layer restores a stored session asynchronously;
         personalize.js waits for its settle signal (authReady) for
         exactly this reason, and so does this section — deciding on
         a cold load before the restore settles would show a
         returning signed-in visitor the signpost. */
      if (window.DemeAccount
          && typeof window.DemeAccount.authReady === "function") {
        await window.DemeAccount.authReady();
      }
      const ward = briefingWard();
      if (ward == null) { renderSignpost(); return; }
      const watchWardRaw = (typeof VoteStore !== "undefined"
        && VoteStore.getWatchWard) ? VoteStore.getWatchWard() : null;
      const watchWard = (watchWardRaw != null && watchWardRaw !== ward)
        ? watchWardRaw : null;
      const interests = (typeof VoteStore !== "undefined"
        && VoteStore.getInterests) ? VoteStore.getInterests() : [];

      const today = (window.DemeCouncilStatus
        && typeof window.DemeCouncilStatus.todayInToronto === "function")
        ? window.DemeCouncilStatus.todayInToronto() : todayInToronto();
      const start = addDays(today, -6); /* last 7 days, today included */
      const fwdEnd = addDays(today, 7);

      /* Fetches — every one is an existing file or the visitor's
         own account rows; each failure degrades its own section. */
      const peopleP = loadJSON(dataPath("councillors.json"))
        .then((v) => ({ ok: true, v })).catch(() => ({ ok: false, v: [] }));
      const rowsP = liteRows(start, today)
        .then((v) => ({ ok: true, v })).catch(() => ({ ok: false, v: [] }));
      const recentP = loadJSON(dataPath("recent-votes.json"))
        .then((v) => ({ ok: true, v })).catch(() => ({ ok: false, v: null }));
      const upcomingP = loadJSON(dataPath("upcoming.json"))
        .then((v) => ({ ok: true, v })).catch(() => ({ ok: false, v: null }));
      /* Section C is the only section omitted on a load failure:
         threads.json failing must not invent an empty topics week. */
      const threadsP = interests.length
        ? loadJSON(dataPath("threads.json"))
            .then((v) => ({ ok: true, v })).catch(() => ({ ok: false, v: null }))
        : Promise.resolve({ ok: false, v: null });
      const [peopleR, rowsR, recentR, upcomingR, threadsR] =
        await Promise.all([peopleP, rowsP, recentP, upcomingP, threadsP]);

      const rows = rowsR.v;
      const rowByRef = new Map(rows.map((r) => [r.ref, r]));
      const sections = [];

      /* ---- Section A: decided this week — your ward(s) ---- */
      const wardSet = new Set(watchWard != null ? [ward, watchWard] : [ward]);
      let aHTML;
      if (!rowsR.ok) {
        aHTML = `<p class="small">This week's decisions could not be loaded. Please reload the page.</p>`;
      } else {
        const mine = rows.filter((r) => inWindow(r.date, start, today)
          && Array.isArray(r.w) && r.w.some((w) => wardSet.has(w)))
          .sort(byDateDesc);
        const shown = mine.slice(0, 8);
        const cards = (await hydrateCards(shown)).filter(Boolean);
        if (cards.length) {
          aHTML = cardsHTML(cards) + (mine.length > shown.length
            ? `<p style="margin-top:1rem"><a href="explore.html">More in the Record →</a></p>`
            : "");
        } else {
          aHTML = `<p class="small">${watchWard != null
            ? "No decisions tagged to your ward or your watched ward in the last 7 days."
            : "No decisions tagged to your ward in the last 7 days."}</p>`;
        }
      }
      sections.push(`<h3>Decided this week — your ward${watchWard != null ? "s" : ""}</h3>${aHTML}`);

      /* ---- Section B: your councillor voted ----
         The rep lookup is record.js's myCouncillor() lookup done
         against this section's own councillors.json load (the same
         loadJSON cache record.js fills): myCouncillor() itself
         closes over record.js's page state, which settles on its
         own schedule, so calling it from here could read an
         unsettled empty list. The lookup rule is identical:
         the current member whose ward is the profile ward. */
      const people = peopleR.v || [];
      const rep = people.find((p) => p && p.current && p.ward === ward) || null;
      let bHTML;
      if (!rep) {
        bHTML = `<p class="small">Ward ${esc(ward)} has no councillor on record right now.</p>`;
      } else if (!recentR.ok || !recentR.v) {
        bHTML = `<p class="small">Your councillor's recent votes could not be loaded.</p>`;
      } else {
        const votes = (Array.isArray(recentR.v[rep.slug])
          ? recentR.v[rep.slug] : [])
          .filter((v) => v && inWindow(v.date, start, today));
        if (votes.length) {
          bHTML = `<p class="small" style="margin-top:0">How ${esc(rep.name)}, your Ward ${esc(ward)} councillor, voted in the last 7 days:</p>`
            + votes.slice(0, 10).map((v) => `<article class="card" style="margin-bottom:1rem">
              <div class="meta"><span>${esc(fmtDate(v.date))}</span>
                <span>Recorded vote</span></div>
              <h3><a href="decision.html?ref=${encodeURIComponent(v.ref)}">${esc(cleanTitle(v.title))}</a></h3>
              <p style="margin:.2rem 0 0">Voted: <strong>${esc(v.vote)}</strong></p>
            </article>`).join("");
        } else {
          bHTML = `<p class="small">No recorded votes for your councillor in the last 7 days.</p>`;
        }
      }
      sections.push(`<h3>Your councillor voted</h3>${bHTML}`);

      /* ---- Section C: your topics (only with topics, and only
         when threads.json actually loaded) ---- */
      if (interests.length && threadsR.ok && threadsR.v) {
        const refSet = new Set();
        (threadsR.v.threads || []).filter((t) => interests.includes(t.id))
          .forEach((t) => Object.values(t.years || {})
            .forEach((ys) => (ys || []).forEach((r) => refSet.add(r))));
        const topicRows = [...refSet]
          .map((ref) => rowByRef.get(ref))
          .filter((r) => r && inWindow(r.date, start, today))
          .sort(byDateDesc);
        const shown = topicRows.slice(0, 8);
        const cards = (await hydrateCards(shown)).filter(Boolean);
        let cHTML;
        if (!rowsR.ok) {
          cHTML = `<p class="small">This week's decisions could not be loaded. Please reload the page.</p>`;
        } else if (cards.length) {
          cHTML = cardsHTML(cards) + (topicRows.length > shown.length
            ? `<p style="margin-top:1rem"><a href="explore.html">More in the Record →</a></p>`
            : "");
        } else {
          cHTML = `<p class="small">No decisions on the topics you follow in the last 7 days.</p>`;
        }
        sections.push(`<h3>Your topics</h3>${cHTML}`);
      }

      /* ---- Section D: your picks & watches — decided ----
         Watches half only, from the outcome field — a read, not a
         computation. record.js's alignment machinery renders the
         picks themselves in the picks section directly below, so
         the picks half here is the link to it; nothing about any
         pick is tallied or shown to anyone but its owner. A watch
         counts as decided when its own outcome field is set;
         notified_at is not used — it tracks a notification state,
         not the decision. Signed out, getWatches() returns nothing
         (watches are account rows plus their owner's device cache),
         and the honest line below says so without pitching. */
      let decidedWatches = [];
      try {
        const acct = window.DemeAccount;
        if (acct && typeof acct.getWatches === "function") {
          decidedWatches = (acct.getWatches() || []).filter((w) =>
            w && w.item_ref && w.outcome != null && w.outcome !== "");
        }
      } catch (e) { decidedWatches = []; }
      let dHTML = "";
      if (decidedWatches.length) {
        dHTML = decidedWatches.slice(0, 8).map((w) => `<article class="card" style="margin-bottom:1rem">
          <div class="meta"><span>Item ${esc(w.item_ref)}</span>
            <span class="pill">Decided</span></div>
          <h3><a href="decision.html?ref=${encodeURIComponent(w.item_ref)}">${esc(cleanTitle(w.item_title || "Council item"))}</a></h3>
          <p style="margin:.2rem 0 0">Outcome: <strong>${esc(w.outcome)}</strong></p>
        </article>`).join("");
      } else {
        dHTML = `<p class="small">None of the items you're watching has been decided yet.</p>`;
      }
      dHTML += `<p style="margin-top:.6rem"><a href="#picks">Your picks and how they landed ↓</a></p>`;
      sections.push(`<h3>Your picks &amp; watches — decided</h3>${dHTML}`);

      /* ---- Section E: coming up at Council ----
         record.js's weighInHTML()/watchHTML() markup generators
         are callable, but their click binding (bindWeighIns) is
         wired only to record.js's own #upcoming box and its own
         item state — reusing the markup here would render buttons
         nothing answers. So this section renders the items as
         cards linked to the weigh-in section below, where the
         live controls are. */
      let eHTML;
      if (!upcomingR.ok || !upcomingR.v) {
        eHTML = `<p class="small">What's coming up could not be loaded. Please reload the page.</p>`;
      } else {
        const coming = (upcomingR.v.items || []).filter((u) =>
          u && u.body === "City Council"
          && inWindow(String(u.date || "").slice(0, 10), today, fwdEnd));
        if (coming.length) {
          eHTML = coming.map((u) => `<article class="card" style="margin-bottom:1rem">
            <div class="meta"><span>${esc(fmtDate(u.date))}</span>
              <span>${esc(u.body)}</span><span class="pill ink">Coming up</span></div>
            <h3>${esc(cleanTitle(u.title))}</h3>
            ${u.brief ? `<p>${esc(u.brief)}</p>` : ""}
            <p class="more"><a href="#weigh-in">Weigh in below ↓</a></p>
          </article>`).join("");
        } else {
          eHTML = `<div class="calm">
            <p class="calm-head">No Council votes are scheduled in the published agenda right now.</p>
            <p>When the City publishes the next Council agenda, its items will be listed here with briefs — ready to weigh in on before the vote.</p>
          </div>`;
        }
      }
      sections.push(`<h3>Coming up at Council</h3>${eHTML}`);

      /* Empty week: the honest per-section lines above stand on
         their own — older items are never backfilled into a week
         they do not belong to. */
      bodyEl.innerHTML = sections.join("");
    } catch (e) {
      bodyEl.innerHTML = `<p class="small">Your week on the record could not be assembled. Please reload the page.</p>`;
    } finally {
      rendering = false;
      if (rerunQueued) { rerunQueued = false; render(); }
    }
  }

  /* The account layer announces session settles with "deme:session"
     (sign-in, sign-out, bootstrap) — re-render so the briefing
     follows the visitor's sign-in state on this page. */
  window.addEventListener("deme:session", () => { render(); });
  render();
})();
