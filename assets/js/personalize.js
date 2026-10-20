/* Home personalization — the "Start here" section on index.html.
   State: localStorage key deme.home.v1 { welcomed, choice } where
   choice is a ward number, "mayor", or null. A numeric choice is ALSO
   written through VoteStore (deme.votes.v1) — the ward is never forked
   into a second store. Nothing here gates any other content: every
   other section of the home page renders whether or not a ward is set,
   and everything stays in this browser. */
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
  const cardCache = new Map(); // ref -> card, hydrated from year shards

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

  /* Same card format as councillors.html — one stat line, no more. */
  function personCard(c) {
    const role = c.mayor ? "Mayor of Toronto"
      : `Councillor · Ward ${c.ward} — ${esc(c.wardName)}`;
    return `<article class="person">
      <h3><a href="councillor.html?m=${encodeURIComponent(c.slug)}">${esc(c.name)}</a></h3>
      <p class="ward">${role}</p>
      <p class="onestat">Attendance ${c.attendance == null ? "—" : c.attendance + "%"} ·
        ${fmtNum(c.votesCast)} votes cast</p>
    </article>`;
  }

  function renderPicker(state) {
    const wards = people.filter((c) => c.current && !c.mayor)
      .sort((a, b) => a.ward - b.ward);
    body.innerHTML = `
      <p class="kicker">Start here</p>
      <h2 id="starthere-h">Start with your own ward</h2>
      <hr class="rule">
      <div class="card starthere-card">
        <p style="margin:0 0 1rem">New here? Start with your own ward.</p>
        <div class="starthere-picker">
          <label class="visually-hidden" for="starthere-ward">Your ward</label>
          <select id="starthere-ward">
            <option value="">Choose your ward…</option>
            ${wards.map((c) => `<option value="${c.ward}">Ward ${c.ward} — ${esc(c.wardName)}</option>`).join("")}
            <option value="mayor">Citywide — the Mayor represents all of Toronto</option>
          </select>
          <button class="btn" type="button" id="starthere-go">Show my ward</button>
          <button class="btn secondary" type="button" id="starthere-skip">Skip — just show me everything</button>
        </div>
        <p class="small" style="margin:.8rem 0 0">Your choice is kept only
        in this browser. Nothing else on this page waits on it.</p>
      </div>`;
    const sel = document.getElementById("starthere-ward");
    if (state.choice === "mayor") sel.value = "mayor";
    else if (typeof state.choice === "number") sel.value = String(state.choice);
    document.getElementById("starthere-go").addEventListener("click", () => {
      if (!sel.value) { sel.focus(); return; }
      const choice = sel.value === "mayor" ? "mayor" : Number(sel.value);
      /* One store, one truth (D3): choosing the Mayor CLEARS any
         stored ward, so Home, My Record and Explore all agree there
         is no "my ward" anymore. */
      VoteStore.setWard(choice === "mayor" ? null : choice);
      const next = { welcomed: true, choice };
      HomeStore.write(next);
      render(next);
    });
    document.getElementById("starthere-skip").addEventListener("click", () => {
      HomeStore.write({ welcomed: true, choice: null });
      section.hidden = true;
    });
  }

  async function renderWard(state) {
    const isMayor = state.choice === "mayor";
    const person = isMayor
      ? people.find((c) => c.current && c.mayor)
      : people.find((c) => c.current && !c.mayor && c.ward === state.choice);
    body.innerHTML = `
      <p class="kicker">Start here</p>
      <h2 id="starthere-h">${isMayor ? "Your mayor" : "Your ward"}</h2>
      <hr class="rule">
      ${person ? personCard(person) : ""}
      <div class="cards two" id="starthere-cards" style="margin-top:1rem">
        <p class="small">Loading the latest decisions…</p>
      </div>
      <p style="margin-top:1.1rem">
        <button class="btn secondary small" type="button" id="starthere-change">Change ward</button>
      </p>`;
    document.getElementById("starthere-change").addEventListener("click", () => {
      renderPicker(state);
    });
    const box = document.getElementById("starthere-cards");
    try {
      let cards = [];
      if (isMayor) {
        const latest = await loadJSON(dataPath("latest.json"));
        cards = (latest.council || []).slice(0, 4);
      } else {
        const search = await loadJSON(dataPath("search.json"));
        const mine = search
          .filter((r) => r.w && r.w.includes(state.choice))
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

  function render(state) {
    if (state.welcomed && state.choice == null) { section.hidden = true; return; }
    section.hidden = false;
    if (!state.welcomed) renderPicker(state);
    else renderWard(state);
  }

  loadJSON(dataPath("councillors.json")).then((list) => {
    people = list;
    const state = HomeStore.read();
    /* Returning visitor: a ward already in VoteStore is the choice. */
    const storedWard = VoteStore.getWard();
    if (storedWard != null) {
      state.welcomed = true;
      state.choice = storedWard;
    }
    render(state);
  }).catch(() => { section.hidden = true; });
})();
