/* Three-level Upcoming — shared fields (Oct 28, 2026).
   The homepage's Upcoming panels for Queen's Park (Ontario) and
   Parliament Hill (House of Commons), plus the shared-fields block
   on the Toronto panel. Owner's consistency rule: every Upcoming
   panel carries the SAME information fields in the same order, so
   no level reads richer or thinner than another —

     1. Next sitting        (labelled field)
     2. Next expected vote  (labelled field)
     3. The business        (the classified item list)
     4. Counts              (per-level classification counts,
                             never blended across levels)
     5. Stamp               (as-published-for date, harvest date,
                             official source link)

   Where a chamber's sources cannot support a field, the field
   stays present with the honest content (e.g. "has not been
   published yet") — it is never silently dropped.

   Data: the Wave 3B harvest snapshots
   (record-data/ontario/upcoming.json from the day's Orders and
   Notices Paper; record-data/federal/upcoming.json from the
   Commons projected business + LEGISinfo), written by
   harvest/ontario_harvest.py and harvest/federal_harvest.py.
   Their sittingDate/generatedAt are always displayed — a stale
   snapshot shows its age, never hides it.

   States (the 3B model; there is no official "upcoming recorded
   divisions" feed at either legislature, so states say exactly
   what the source earns): "Vote scheduled" only for a formally
   named deferred division; "On today's order paper" for the
   day's published business; "Expected" for bills at report stage
   or third reading — candidates, never scheduled business.
   (Nov 5, 2026: the order-paper label, the counts line and the
   no-vote sentence are date-aware — an item or snapshot that is
   not today's names its own date, e.g. "On the order paper for
   Oct 28, 2026", and a past scheduled vote reads "was scheduled".)

   Read-only by design: no account surface, no weigh-in UI, no
   watch buttons — Parliament Watch / Queen's Park Watch remain
   the held Wave 3B feature. Reading needs no account. */
/* v76 (Nov 3, 2026): the Queen's Park and Parliament Hill panels
   moved from the homepage to the top of their own record pages
   (representatives.html?level=ontario / ?level=canada), where this
   same script renders them into the same mount ids. The homepage
   keeps the Toronto panel (fields + tail below) and gains a
   one-line pointer under it: when a layer's snapshot is fresh
   (its sittingDate is today or later, or it was harvested within
   the last two days), the pointer names that layer's first item
   of business; a stale snapshot leaves the pointer as links only.
   Each record-page panel also carries an explicit as-of line,
   filled from the snapshot's sittingDate (data-driven). */

"use strict";
(() => {
  const byId = (id) => document.getElementById(id);
  const fullDate = (iso) => (window.DemeCouncilStatus
    && typeof window.DemeCouncilStatus.formatFullDate === "function")
    ? window.DemeCouncilStatus.formatFullDate(iso) : fmtDate(iso);
  const todayTO = () => (window.DemeCouncilStatus
    && typeof window.DemeCouncilStatus.todayInToronto === "function")
    ? window.DemeCouncilStatus.todayInToronto()
    : new Date().toISOString().slice(0, 10);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const STATES = {
    vote_scheduled: { label: "Vote scheduled", cls: "ink", rank: 0 },
    on_todays_order_paper: { label: "On today's order paper", cls: "", rank: 1 },
    on_todays_agenda: { label: "On today's order paper", cls: "", rank: 1 },
    expected: { label: "Expected", cls: "plain", rank: 2 },
  };
  const stateOf = (it) => STATES[it.state] || STATES.expected;

  /* Date-aware chip label (Nov 5, 2026): the "today's order paper"
     label is earned only by an item dated today (Toronto). An item
     from an older paper names its own date instead — a stale
     snapshot never dresses itself up as today's business. */
  function stateLabel(it) {
    const st = stateOf(it);
    if (st.rank === 1) {
      const d = String(it.date || "").slice(0, 10);
      if (d && d !== todayTO()) return `On the order paper for ${fmtDate(d)}`;
    }
    return st.label;
  }

  /* "On today's order paper" as a phrase, date-aware: today's paper
     when the snapshot is today's, the dated paper otherwise. */
  function paperPhrase(up) {
    const d = String(up.sittingDate || up.generatedAt || "").slice(0, 10);
    return d && d !== todayTO()
      ? `the order paper for ${fmtDate(d)}` : "today's order paper";
  }

  function fieldsBlock(rows) {
    return `<dl class="up-fields">${rows.map(([k, v]) =>
      `<div class="up-field"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  }

  /* "Next sitting" sentence for a legislative layer, from the
     snapshot's sitting date relative to today in Toronto. */
  function sittingSentence(up, house, paperWord) {
    const d = up.sittingDate || up.generatedAt;
    if (!d) return "Not published yet.";
    const today = todayTO();
    if (d === today) return `${esc(fullDate(d))} — ${house} is sitting today.`;
    if (d > today) return `${esc(fullDate(d))} — the next sitting in the published ${paperWord}.`;
    return `As published for ${esc(fullDate(d))} — no newer ${paperWord} has been harvested yet.`;
  }

  /* ---------------- legislative layers (Queen's Park, Parliament) --- */
  function layerCard(it, chamber) {
    const st = stateOf(it);
    const head = it.bill ? `${esc(it.bill)} — ${esc(it.title)}` : esc(it.title);
    /* The note drops out when the title already says it (the
       Ontario paper's deferred-vote item carries its stage inside
       its own title — printing both would stutter). */
    let note = it.agendaNote || it.stage || "";
    if (note && it.title.toLowerCase().includes(note.toLowerCase())) note = "";
    return `<article class="card">
      <div class="meta"><span>${esc(fmtDate(it.date))}</span>
        <span>${esc(chamber)}</span>
        <span class="pill ${st.cls}">${esc(stateLabel(it))}</span></div>
      <h3>${head}</h3>
      ${note ? `<p class="brief">${esc(note)}</p>` : ""}
      ${it.sourceUrl ? `<p class="more"><a href="${esc(it.sourceUrl)}" target="_blank" rel="noopener">Official source <span aria-hidden="true">→</span></a></p>` : ""}
    </article>`;
  }

  function expectedItem(it) {
    const head = it.bill ? `<strong>${esc(it.bill)}</strong> — ` : "";
    const src = it.sourceUrl
      ? ` <a class="src" href="${esc(it.sourceUrl)}" target="_blank" rel="noopener">Official source</a>` : "";
    return `<li>${head}${esc(it.title)} <span>(${esc(it.stage || "Expected")})</span>${src}</li>`;
  }

  function renderLayer(cfg, up) {
    const box = byId(cfg.box);
    if (!box) return;
    const items = (up.items || []).slice().sort((a, b) =>
      (stateOf(a).rank - stateOf(b).rank)
      || String(a.date).localeCompare(String(b.date)));
    const scheduled = items.filter((i) => i.state === "vote_scheduled");
    const todayItems = items.filter((i) => stateOf(i).rank === 1);
    const expected = items.filter((i) => stateOf(i).rank === 2);

    /* Field 2 — Next expected vote. */
    let nextVote;
    if (scheduled.length) {
      const f = scheduled[0];
      const head = f.bill ? `${esc(f.bill)} — ${esc(f.title)}` : esc(f.title);
      const verb = String(f.date || "").slice(0, 10) >= todayTO()
        ? "is scheduled for" : "was scheduled for";
      nextVote = `A vote ${verb} ${esc(fmtDate(f.date))}: ${head}`
        + (f.stage && !f.title.toLowerCase().includes(f.stage.toLowerCase())
          ? ` (${esc(f.stage)})` : "")
        + (scheduled.length > 1
          ? ` — and ${plural(scheduled.length - 1, "one more", "more")} below.` : ".");
    } else {
      nextVote = cfg.noVote(up);
    }

    let html = fieldsBlock([
      ["Next sitting", sittingSentence(up, cfg.house, cfg.paperWord)],
      ["Next expected vote", nextVote],
    ]);

    /* Field 3 — The business. */
    const cards = scheduled.concat(todayItems);
    if (cards.length) {
      html += `<div class="cards two">${cards.map((i) => layerCard(i, cfg.chamber)).join("")}</div>`;
    } else if (!expected.length) {
      html += `<p class="upcoming-line">No business is listed for this sitting day in the current ${esc(cfg.paperWord)}.</p>`;
    }
    if (expected.length) {
      html += `<h3 class="up-expected-h">Expected — bills at report stage or third reading</h3>
        <ul class="up-expected">${expected.map(expectedItem).join("")}</ul>`;
    }

    /* Field 4 — Counts (this level only). The order-paper count
       label is date-aware like the chips: a stale snapshot's count
       names the paper's date, never "today". */
    const c = up.classification || {};
    const stale = String(up.sittingDate || up.generatedAt || "").slice(0, 10)
      !== todayTO();
    const parts = cfg.countParts
      .filter(([key]) => typeof c[key] === "number")
      .map(([key, one, many]) => {
        if (stale && (key === "onTodaysOrderPaper" || key === "onTodaysAgenda")) {
          const lbl = `on the order paper for ${fmtDate(up.sittingDate || up.generatedAt)}`;
          return plural(c[key], lbl, lbl);
        }
        return plural(c[key], one, many);
      });
    if (parts.length) {
      html += `<p class="up-counts" style="margin-top:1.1rem">For ${esc(fmtDate(up.sittingDate || up.generatedAt))}: ${parts.join(" · ")}.</p>`;
    }

    /* Field 5 — Stamp. */
    html += `<p class="up-fresh">${cfg.stamp(up)}</p>`;
    box.innerHTML = html;

    /* As-of line (v76): the record-page panel states its own
       snapshot date up top, from the feed — never hardcoded. */
    const asof = document.querySelector(
      `[data-upcoming-asof="${cfg.key}"]`);
    if (asof) {
      asof.textContent = up.sittingDate
        ? `As of the sitting day of ${fullDate(up.sittingDate)}.`
        : (up.generatedAt ? `As of ${fullDate(up.generatedAt)}.` : "");
    }
  }

  const LAYERS = [
    {
      key: "ontario",
      box: "upcoming-ontario", path: "ontario/upcoming.json",
      chamber: "Ontario Legislature", house: "the Assembly",
      paperWord: "order paper",
      noVote: (up) => `No vote is formally scheduled in this paper. The next votes are expected on the items on ${paperPhrase(up)}, as they are called.`,
      countParts: [
        ["voteScheduled", "vote scheduled", "votes scheduled"],
        ["onTodaysOrderPaper", "on today's order paper", "on today's order paper"],
      ],
      stamp: (up) => `From the Orders and Notices Paper for ${esc(fmtDate(up.sittingDate || up.generatedAt))}${up.paperNo ? ` (No. ${esc(up.paperNo)})` : ""} · harvested ${esc(fmtDate(up.generatedAt))}. The Assembly can take up other listed business. Official source: <a href="https://www.ola.org/en/current-agenda" target="_blank" rel="noopener">the Assembly's current agenda</a>.`,
      fail: "Upcoming business at Queen's Park could not be loaded just now. The official source is <a href=\"https://www.ola.org/en/current-agenda\" target=\"_blank\" rel=\"noopener\">the Assembly's current agenda</a>.",
    },
    {
      key: "federal",
      box: "upcoming-federal", path: "federal/upcoming.json",
      chamber: "House of Commons", house: "the House",
      paperWord: "projected business",
      noVote: (up) => `No recorded division is formally scheduled for this sitting. The next votes are expected on the items on ${paperPhrase(up)}, as they are called.`,
      countParts: [
        ["voteScheduled", "vote scheduled", "votes scheduled"],
        ["onTodaysAgenda", "on today's order paper", "on today's order paper"],
        ["expected", "expected", "expected"],
      ],
      stamp: (up) => `From the House of Commons projected business for ${esc(fmtDate(up.sittingDate || up.generatedAt))} · harvested ${esc(fmtDate(up.generatedAt))}. The House can change its business without notice. Official source: <a href="https://www.ourcommons.ca/en/parliamentary-business" target="_blank" rel="noopener">the House's parliamentary business</a>.`,
      fail: "Upcoming business at Parliament Hill could not be loaded just now. The official source is <a href=\"https://www.ourcommons.ca/en/parliamentary-business\" target=\"_blank\" rel=\"noopener\">the House's parliamentary business</a>.",
    },
  ];

  LAYERS.forEach((cfg) => {
    const box = byId(cfg.box);
    if (!box) return;
    loadJSON(dataPath(cfg.path))
      .then((up) => renderLayer(cfg, up || {}))
      .catch(() => { box.innerHTML = `<p class="upcoming-line">${cfg.fail}</p>`; });
  });

  /* ---------------- Toronto: the same fields on the existing panel ---
     The Toronto panel's business list (status band + cards) is
     rendered by the homepage script from the same two files; this
     block adds fields 1, 2, 4 and 5 around it, from
     council-status.json + upcoming.json, so the three panels
     carry the same fields in the same order. */
  (async () => {
    const head = byId("upcoming-toronto-fields");
    const tail = byId("upcoming-toronto-tail");
    if (!head || !tail) return;
    let up = null, st = null;
    try { up = await loadJSON(dataPath("upcoming.json")); } catch (e) { /* degrade: no block */ }
    try { st = await loadJSON(dataPath("council-status.json")); } catch (e) { /* degrade: partial */ }
    if (!up && !st) return;
    const today = todayTO();
    const items = ((up && up.items) || [])
      .filter((u) => u && u.body === "City Council");

    /* Field 1 — Next sitting. */
    const dates = new Set();
    if (st) {
      (st.meetingDates || []).forEach((d) => dates.add(d));
      if (st.firstNewTermMeetingDate) dates.add(st.firstNewTermMeetingDate);
    }
    items.forEach((u) => { if (u.date) dates.add(String(u.date).slice(0, 10)); });
    const future = [...dates].filter((d) => d >= today).sort();
    let nextSitting;
    if (future.length) {
      nextSitting = future[0] === today
        ? `${esc(fullDate(future[0]))} — City Council meets today.`
        : `${esc(fullDate(future[0]))} — the next City Council meeting on the published schedule.`;
    } else if (st && st.newTermStart) {
      nextSitting = `The new Council takes office on ${esc(fullDate(st.newTermStart))}. The date of its first meeting has not been published yet${st.scheduleCheckedOn ? ` (schedule checked ${esc(fmtDate(st.scheduleCheckedOn))})` : ""}.`;
    } else {
      nextSitting = "Not published yet.";
    }

    /* Field 2 — Next expected vote. */
    let nextVote;
    if (items.length) {
      const first = items.map((u) => String(u.date).slice(0, 10)).sort()[0];
      nextVote = `City Council votes on ${esc(fullDate(first))} — ${plural(items.length, "published item is", "published items are")} listed below.`;
    } else {
      nextVote = "No Council vote is scheduled in a published agenda right now. The first items of the new term will appear here when the City publishes its agenda.";
    }
    head.innerHTML = fieldsBlock([
      ["Next sitting", nextSitting],
      ["Next expected vote", nextVote],
    ]);

    /* Field 4 — Counts. */
    const cl = (up && up.classification) || {};
    const fc = typeof cl.futureCouncilItems === "number"
      ? cl.futureCouncilItems : items.length;
    let counts = `${plural(fc, "City Council item is", "City Council items are")} published as upcoming.`;
    const hk = cl.todayItemsHousekeeping || {};
    const hkNames = Object.keys(hk);
    if (hkNames.length) {
      const tot = hkNames.reduce((a, k) => a + (hk[k] || 0), 0);
      counts += ` ${plural(tot, "item", "items")} from ${hkNames.join(", ")} also appear in the published agendas${up && up.generatedAt ? ` as of ${fmtDate(up.generatedAt)}` : ""} — board business, not Council business, and not counted here.`;
    }

    /* Field 5 — Stamp. */
    const stamp = `Agenda data as published ${up ? esc(fmtDate(up.generatedAt)) : ""} · Official source: <a href="https://secure.toronto.ca/council/" target="_blank" rel="noopener">Toronto's council meeting portal</a>.`;
    tail.innerHTML = `<p class="up-counts">${esc(counts)}</p><p class="up-fresh">${stamp}</p>`
      + (items.length ? ""
        : `<p class="upcoming-line"><a href="representatives.html?level=toronto">See the Toronto record →</a></p>`);
  })();

  /* ---------------- Homepage pointer to the other layers ----------
     One line under the Toronto panel. A layer earns a headline
     only while its snapshot is fresh: its sittingDate is today or
     later, or it was harvested within the last two days. Otherwise
     the line stays links only — a stale snapshot never dresses
     itself up as current business. */
  const elsewhere = byId("upcoming-elsewhere");
  if (elsewhere) {
    const dayMs = 86400000;
    const isFresh = (up) => {
      if (!up) return false;
      const today = todayTO();
      const sd = String(up.sittingDate || "").slice(0, 10);
      if (sd && sd >= today) return true;
      const ga = String(up.generatedAt || "").slice(0, 10);
      if (!ga) return false;
      const diff = (Date.parse(today) - Date.parse(ga)) / dayMs;
      return diff >= 0 && diff <= 2;
    };
    const headline = (up) => {
      const items = (up.items || []).slice().sort((a, b) =>
        (stateOf(a).rank - stateOf(b).rank)
        || String(a.date).localeCompare(String(b.date)));
      const pick = items.find((i) => stateOf(i).rank < 2) || items[0];
      if (!pick) return "";
      if (pick.bill) return `${pick.bill} · ${pick.stage || "Expected"}`;
      let t = pick.title || "";
      if (pick.stage
          && !t.toLowerCase().includes(pick.stage.toLowerCase())) {
        t += ` · ${pick.stage}`;
      }
      return t;
    };
    LAYERS.forEach((cfg) => {
      const slot = elsewhere.querySelector(
        `[data-elsewhere-headline="${cfg.key}"]`);
      if (!slot) return;
      loadJSON(dataPath(cfg.path))
        .then((up) => {
          if (!isFresh(up)) return;
          const h = headline(up || {});
          if (h) slot.textContent = `: ${h}`;
        })
        .catch(() => { /* links only */ });
    });
  }
})();
