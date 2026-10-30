/* Home personalization — the "Start here" section on index.html.
   Owner rule (Oct 20, 2026): a ward belongs to the account profile —
   it is set when the account is created and edited in the account
   form on My Record; there is no device-level ward. So while
   accounts are live, a SIGNED-OUT visitor gets the signpost panel
   (renderSignpost): it writes nothing — no device ward, no rep
   snapshot, no HomeStore choice — and points at the two honest
   routes, an account (which carries the ward) and the directory's
   postal-code lookup (which saves nothing). "For you" stays off too.
   The flows below run only when the profile can drive them: a
   signed-in visitor (whose VoteStore ward IS their profile ward,
   mirrored by the account layer) or, while accounts are not live at
   all, the on-device profile as before.
   State in that profile mode: localStorage key deme.home.v1
   { welcomed, choice } where choice is a ward number, "mayor", or
   null. A numeric choice is ALSO written through VoteStore
   (deme.votes.v2) — the ward is never forked into a second store.
   Nothing here gates any other content: every other section of the
   home page renders whether or not a ward is set. */
"use strict";

const HomeStore = (() => {
  const KEY = "deme.home.v1";
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === "object") {
          return { welcomed: Boolean(p.welcomed), choice: p.choice ?? null };
        }
      }
    } catch (e) { /* fall through to fresh state */ }
    return { welcomed: false, choice: null };
  }
  function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  return { read, write, key: KEY };
})();

(function initStartHere() {
  const section = document.getElementById("starthere");
  const body = document.getElementById("starthere-body");
  if (!section || !body) return;

  let people = [];
  /* v62 (C7): the representative card carries the same navy
     participation module as the directory cards; the data loads
     alongside councillors.json and renderWard awaits it, so the
     card never renders a figure-less interim state. */
  let partData = null;
  const partReady = loadJSON(dataPath("participation.json"))
    .then((d) => { partData = d; }).catch(() => {});
  const cardCache = new Map(); // ref -> card, hydrated from year shards

  /* The personalization index is sharded by year
     (record-data/search-lite-<year>.json: [ref, date, wards, position]
     tuples split from the bulk search index, which is no longer
     published as a single file — it is the email-gated bulk dataset,
     see open-data.html). Shards load newest-first, and the scan stops
     once the requested top-N is settled: every unloaded row sits in
     an earlier year, so it is strictly older than the Nth row already
     held and cannot displace it. Rows are restored to bulk-index
     order (position) before the caller's own sort runs, so the
     selection — ties included — is exactly what the full index
     produced. Identical output is enforced by harness/difftest in the
     fix wave's gate package. */
  let _liteYears = null;
  async function topSearchRows(pred, n) {
    if (!_liteYears) {
      const idx = await loadJSON(dataPath("search-lite-index.json"));
      _liteYears = idx.years || [];
    }
    const picked = [];
    for (const y of _liteYears) {
      const tuples = await loadJSON(dataPath(`search-lite-${y}.json`));
      for (const t of tuples) {
        const row = { ref: t[0], date: t[1], w: t[2], year: String(y), _pos: t[3] };
        if (pred(row)) picked.push(row);
      }
      if (picked.length >= n) break;
    }
    picked.sort((a, b) => a._pos - b._pos);
    return picked;
  }

  async function hydrateCards(refs) {
    const need = refs.filter((r) => !cardCache.has(r.ref));
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
      } catch (e) { /* cards render from search rows if a shard fails */ }
    }));
    return refs.map((r) => cardCache.get(r.ref) || null);
  }

  /* Same card format as the Representatives directory (redesign,
     Oct 30, 2026): the one-hero-figure participation module plus
     the quiet two-item footer; the stats grid is the no-entry
     fallback only. */
  function personCard(c) {
    const role = c.mayor ? "Mayor of Toronto"
      : `Councillor · Ward ${c.ward} — ${esc(c.wardName)}`;
    const entry = partData ? partData.members[c.slug] : null;
    const intItem = (c.lastSeen && c.lastSeen < "2023-06-01")
      ? "Interest record starts Jun 2023"
      : `<b>${fmtNum(Number(c.interest) || 0)}</b> declared interest${Number(c.interest) === 1 ? "" : "s"} · since Jun 2023`;
    const record = entry
      ? `${participationCardModule(entry,
          { layer: "toronto", current: !!c.current, incoming: !!c.incoming,
            currentLabel: partCurrentLabel(partData, "toronto") })}
         ${repCardFooterHTML([esc(memberTenure(c)), intItem])}`
      : memberStatsHTML(c);
    return `<article class="person${c.mayor ? " is-mayor" : ""}">
      <div class="person-top">${avatarHTML(c)}
        <div>
          <h3><a href="councillor.html?m=${encodeURIComponent(c.slug)}">${esc(c.name)}</a></h3>
          <p class="ward">${role}</p>
        </div>
      </div>
      ${record}
    </article>`;
  }

  /* Thread id -> label, from the summary the page already loads. */
  async function threadLabels() {
    try {
      const d = await loadJSON(dataPath("threads-summary.json"));
      const m = {};
      (d.threads || []).forEach((t) => { m[t.id] = t.label; });
      return m;
    } catch (e) { return {}; }
  }

  function currentPerson(state) {
    return state.choice === "mayor"
      ? people.find((c) => c.current && c.mayor)
      : people.find((c) => c.current && !c.mayor && c.ward === state.choice);
  }

  /* Continuity: prime the rep snapshot when there is none; if the
     stored one names someone else, return the notice. */
  function repNotice(state, person) {
    const isMayor = state.choice === "mayor";
    const snap = isMayor ? VoteStore.getMayorRep() : VoteStore.getWardRep();
    if (!snap) {
      if (isMayor) VoteStore.setMayorRep(person.slug, person.name);
      else VoteStore.setWardRep(person.slug, person.name);
      return "";
    }
    if (snap.slug === person.slug) return "";
    const old = esc(snap.name), nm = esc(person.name);
    const tail = `<p><a href="councillor.html?m=${encodeURIComponent(person.slug)}">See ${nm}'s record →</a>
      <button class="btn secondary small" type="button" id="rep-gotit">Got it</button></p></div>`;
    if (isMayor) {
      return `<div class="notice"><h3>Toronto's mayor changed</h3>
        <p>When the new Council took office, the mayor's office changed
        hands. ${old} was mayor when you set your choice; ${nm} is mayor
        now.</p>${tail}`;
    }
    return `<div class="notice"><h3>Your representative changed</h3>
      <p>When the new Council took office, Ward ${state.choice}'s seat
      changed hands. ${old} was the councillor on record when you set
      your ward; ${nm} represents Ward ${state.choice} now.</p>${tail}`;
  }

  /* Step 2 (also the "Edit your profile" editor), kept in VoteStore.
     The second ward is picked with the same postal-code finder as
     step 1 (its built-in list is the fallback); the pick is staged
     and only written when Save is pressed, as before. */
  async function renderStep2(state) {
    section.hidden = false;
    const isMayor = state.choice === "mayor";
    const labels = await threadLabels();
    const ints = VoteStore.getInterests(), ww0 = VoteStore.getWatchWard();
    body.innerHTML = `
      <p class="kicker">Start here</p>
      <h2 id="starthere-h">Optional extras</h2>
      <hr class="rule">
      <div class="card starthere-card">
        <div class="profile-field">
          <div id="profile-watch-finder"></div>
        </div>
        <div class="profile-field">
          <label id="profile-topics-l">Topics you follow</label>
          <div class="chips" id="profile-ints" role="group" aria-labelledby="profile-topics-l">
            ${Object.keys(labels).map((id) => `<button type="button" class="chip" data-id="${esc(id)}" aria-pressed="${ints.includes(id)}">${esc(labels[id])}</button>`).join("")}
          </div>
        </div>
        <p class="toolbar" style="margin:0 0 .8rem">
          <button class="btn" type="button" id="profile-save">${isMayor ? "Save and show my extras" : "Save and show my ward"}</button>
          <button class="btn secondary" type="button" id="profile-skip">Skip this step</button>
        </p>
        <p class="small" style="margin:0">${(typeof demeSignedIn === "function" && demeSignedIn())
          ? `Saved to your account profile, and kept in this browser
          so your pages can use it — like your picks. Change it any
          time in My Record.`
          : `Kept in this browser — like your picks. Change it any
          time in My Record.`}</p>
      </div>`;
    const watchFinder = WardFinder.mount(
      document.getElementById("profile-watch-finder"), {
        idPrefix: "sh2",
        people,
        label: isMayor ? "Watch a ward" : "Also watch a second ward (optional)",
        current: (ww0 != null && ww0 !== state.choice) ? ww0 : null,
        exclude: typeof state.choice === "number" ? state.choice : null,
        noneLabel: "No second ward",
        inputLabel: "Postal code of the area to watch",
        collapseWhenEmpty: true,
      });
    body.querySelectorAll("#profile-ints .chip").forEach((b) =>
      b.addEventListener("click", () => b.setAttribute("aria-pressed",
        b.getAttribute("aria-pressed") === "true" ? "false" : "true")));
    document.getElementById("profile-save").addEventListener("click", () => {
      VoteStore.setWatchWard(watchFinder.value());
      VoteStore.setInterests([...body.querySelectorAll(
        '#profile-ints .chip[aria-pressed="true"]')].map((b) => b.dataset.id));
      const person = currentPerson(state);
      if (person) repNotice(state, person); /* prime the rep snapshot */
      renderWard(state);
      renderForYou();
    });
    document.getElementById("profile-skip").addEventListener("click", () => {
      renderWard(state);
      renderForYou();
    });
  }

  /* "For you": only with a watched ward or topics (Start Here
     already serves a primary-ward-only profile). */
  async function renderForYou() {
    const sec = document.getElementById("foryou");
    const fb = document.getElementById("foryou-body");
    if (!sec || !fb) return;
    try {
      const ward = VoteStore.getWard(), ww = VoteStore.getWatchWard();
      const ints = VoteStore.getInterests();
      if (ww == null && !ints.length) { sec.hidden = true; return; }
      const refSet = new Set();
      if (ints.length) {
        try {
          const td = await loadJSON(dataPath("threads.json"));
          (td.threads || []).filter((t) => ints.includes(t.id))
            .forEach((t) => Object.values(t.years || {})
              .forEach((ys) => ys.forEach((r) => refSet.add(r))));
        } catch (e) { /* fall back to the ward matches alone */ }
      }
      /* For You is the EXTRA view: the primary ward already has its
         own section above, so a decision qualifies here only through
         the watched ward or a followed topic — never through the
         primary ward alone. (The launch-day visual audit caught the
         two sections showing the same four cards.) */
      const rows = (await topSearchRows((r) => refSet.has(r.ref)
        || (r.w && ww != null && r.w.includes(ww)), 12))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 12);
      const cards = (await hydrateCards(rows)).filter(Boolean).slice(0, 4);
      const basis = [];
      if (ww != null) basis.push(`Ward ${ww} (watched)`);
      if (ints.length) {
        const labels = await threadLabels();
        ints.forEach((id) => basis.push(labels[id] || id));
      }
      sec.hidden = false;
      fb.innerHTML = `
        <p class="kicker">Your profile</p>
        <h2>For you</h2>
        <hr class="rule">
        <p class="small">Latest decisions for ${esc(basis.join(" · "))}
        — from your profile. Edit it in
        <a href="my-record.html">My Record</a>.</p>
        ${cards.length
          ? `<div class="cards two">${cards.map((c) => decisionCard(c)).join("")}</div>`
          : `<p class="small">Nothing in the archive matches your extra ward and topics yet — the record grows with every Council meeting.</p>`}`;
    } catch (e) { sec.hidden = true; }
  }

  /* Step 1 — the entry panel. A visitor with no profile always gets
     this panel (or its slim form after skipping): the ward is found
     by postal code first, with the ward list as the fallback inside
     the finder, and the Mayor as the citywide alternative. */
  function renderPicker(state) {
    section.hidden = false;
    body.innerHTML = `
      <p class="kicker">Your profile</p>
      <h2 id="starthere-h">Make Deme yours</h2>
      <hr class="rule">
      <div class="card starthere-card entry-panel">
        <p class="entry-lede">Set your ward to see your representative, your
        area's decisions, and alerts.</p>
        <div id="sh-finder"></div>
        <div class="entry-alt">
          <button class="btn secondary" type="button" id="starthere-mayor">Citywide — show me the Mayor</button>
          <button class="wf-listtoggle" type="button" id="starthere-skip">Skip — just show me everything</button>
        </div>
        <p class="small" style="margin:.9rem 0 0">Nothing else on this page
        waits on it — the whole record stays open either way.</p>
      </div>`;
    WardFinder.mount(document.getElementById("sh-finder"), {
      idPrefix: "sh",
      people,
      label: "Find your ward by postal code",
      btnClass: "btn bronze",
      current: null,
      noneLabel: "Choose your ward…",
      onChoose(n) {
        if (n == null) return;
        VoteStore.setWard(n);
        const next = { welcomed: true, choice: n };
        HomeStore.write(next);
        renderStep2(next);
      },
    });
    document.getElementById("starthere-mayor").addEventListener("click", () => {
      /* One store, one truth (D3): choosing the Mayor CLEARS any
         stored ward, so Home, My Record and Explore all agree there
         is no "my ward" anymore. */
      VoteStore.setWard(null);
      const next = { welcomed: true, choice: "mayor" };
      HomeStore.write(next);
      renderStep2(next);
    });
    document.getElementById("starthere-skip").addEventListener("click", () => {
      const next = { welcomed: true, choice: null };
      HomeStore.write(next);
      render(next);
    });
  }

  /* The persistent slim form of the entry panel: shown to a visitor
     who skipped setup and still has no ward — the door to the
     profile never disappears. */
  function renderEntrySlim(state) {
    section.hidden = false;
    body.innerHTML = `
      <p class="kicker">Your profile</p>
      <h2 id="starthere-h">Make Deme yours</h2>
      <hr class="rule">
      <div class="card starthere-card entry-slim">
        <p>Set your ward to see your representative, your area's decisions,
        and alerts.</p>
        <p class="entry-actions">
          <button class="btn bronze" type="button" id="entry-set">Set your ward</button>
          <a class="btn secondary" href="my-record.html">Open My Record</a>
        </p>
      </div>`;
    document.getElementById("entry-set").addEventListener("click", () => {
      renderPicker(state);
    });
  }

  async function renderWard(state) {
    await partReady;
    const isMayor = state.choice === "mayor";
    const person = currentPerson(state);
    const notice = person ? repNotice(state, person) : "";
    const ww = VoteStore.getWatchWard(), ints = VoteStore.getInterests();
    let summary = "";
    if (ww != null || ints.length) {
      const bits = [];
      if (ww != null) {
        bits.push(`${isMayor ? "Watching" : "Also watching"} Ward ${ww}`);
      }
      if (ints.length) {
        const labels = await threadLabels();
        bits.push(`Following: ${ints.map((id) => labels[id] || id).join(", ")}`);
      }
      summary = `<p class="small" style="margin-top:.8rem">${esc(bits.join(" · "))}</p>`;
    }
    body.innerHTML = `
      <p class="kicker">Start here</p>
      <h2 id="starthere-h">${isMayor ? "Your mayor" : "Your ward"}</h2>
      <hr class="rule">
      ${notice}
      ${person ? personCard(person) : ""}
      ${summary}
      <div class="cards two" id="starthere-cards" style="margin-top:1rem">
        <p class="small">Loading the latest decisions…</p>
      </div>
      <p style="margin-top:1.1rem">
        <button class="btn secondary small" type="button" id="starthere-change">Change ward</button>
        <button class="btn secondary small" type="button" id="starthere-edit">Edit your profile</button>
      </p>`;
    document.getElementById("starthere-change").addEventListener("click", () => {
      renderPicker(state);
    });
    document.getElementById("starthere-edit").addEventListener("click", () => {
      renderStep2(state);
    });
    const gotit = document.getElementById("rep-gotit");
    if (gotit) {
      gotit.addEventListener("click", () => {
        if (isMayor) VoteStore.setMayorRep(person.slug, person.name);
        else VoteStore.setWardRep(person.slug, person.name);
        renderWard(state);
      });
    }
    const box = document.getElementById("starthere-cards");
    try {
      let cards = [];
      if (isMayor) {
        const latest = await loadJSON(dataPath("latest.json"));
        /* The homepage's own "Latest decisions" section shows the
           newest Council decisions; repeating the identical four
           cards here helps no one. Skip anything already on the
           page and take the next decisions in line. */
        const shownRefs = new Set([...document.querySelectorAll(
          '#latest a[href*="decision.html?ref="]')]
          .map((a) => new URL(a.href).searchParams.get("ref")));
        cards = (latest.council || [])
          .filter((c) => !shownRefs.has(c.ref)).slice(0, 4);
        if (!cards.length) cards = (latest.council || []).slice(0, 4);
      } else {
        const mine = (await topSearchRows(
          (r) => r.w && r.w.includes(state.choice), 4))
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .slice(0, 4);
        cards = (await hydrateCards(mine)).filter(Boolean);
      }
      box.innerHTML = cards.length
        ? cards.map((c) => decisionCard(c)).join("")
        : `<p class="small">No decisions are tagged to this ward yet in the archive.</p>`;
    } catch (e) {
      box.innerHTML = `<p class="small">The latest decisions could not be loaded.</p>`;
    }
  }

  /* The signed-out panel (accounts live): a signpost, not a setup.
     It offers no picker and keeps no state — the ward lives on the
     account profile, and the directory lookup finds a councillor
     without saving anything. */
  function renderSignpost() {
    section.hidden = false;
    body.innerHTML = `
      <p class="kicker">Your profile</p>
      <h2 id="starthere-h">Make Deme yours</h2>
      <hr class="rule">
      <div class="card starthere-card entry-panel">
        <p class="entry-lede">Your ward is part of your account
        profile — it's set when you create your account, so Deme can
        put your representative's actual votes beside your picks, on any
        device.</p>
        <p class="entry-actions">
          <a class="btn bronze" href="my-record.html#account-zone">Create your account</a>
          <a class="btn secondary" href="my-record.html#account-zone">Sign in</a>
        </p>
        <p class="small" style="margin:.9rem 0 0">Just looking for
        your representative? <a href="representatives.html?level=toronto#ward-lookup">Find
        them by postal code in the directory</a> — a lookup only;
        nothing is saved. And nothing else on this page waits on an
        account — the whole record stays open either way.</p>
      </div>`;
  }

  function render(state) {
    if (state.welcomed && state.choice == null) { renderEntrySlim(state); return; }
    section.hidden = false;
    if (!state.welcomed) renderPicker(state);
    else renderWard(state);
  }

  loadJSON(dataPath("councillors.json")).then(async (list) => {
    people = list;
    /* R1 (register, Oct 24; fixed Oct 26): this script loads BEFORE
       account.js, and the account layer restores a stored session
       asynchronously — until that restore settles, its in-memory
       answer to "signed in?" is no, so deciding here on the fetch
       alone raced the restore and showed a returning signed-in
       visitor the signed-out signpost on a cold load. Wait for the
       account layer's own settle signal (authReady resolves at the
       end of its boot, signed in or out) before asking. If the
       account layer is absent, decide immediately, as before. */
    if (window.DemeAccount && typeof window.DemeAccount.authReady === "function") {
      await window.DemeAccount.authReady();
    }
    if (typeof demeSignedOut === "function" && demeSignedOut()) {
      /* Signed out with live accounts: no device ward is read,
         adopted, or written, no rep snapshot is primed, and the
         profile-driven "For you" section stays off. */
      renderSignpost();
      return;
    }
    const state = HomeStore.read();
    /* Returning visitor: a ward already in VoteStore is the choice.
       In this branch that ward is the profile ward (signed in) or
       the on-device profile (accounts not live) — never a signed-out
       device ward; that state returned above. */
    const storedWard = VoteStore.getWard();
    if (storedWard != null) {
      state.welcomed = true;
      state.choice = storedWard;
    }
    render(state);
    renderForYou();
  }).catch(() => { section.hidden = true; });
})();
