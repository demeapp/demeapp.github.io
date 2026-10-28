/* Toronto directory — the Toronto level of the combined
   Representatives directory (representatives.html). This is the
   script that ran inline on the old councillors.html, moved
   unchanged into its own file when the three directories combined
   (nav-parity wave, Oct 28, 2026); the only edit is the
   renderChrome target, now the combined page. Loaded by
   representatives.html for the Toronto level only, after
   ward-finder.js. */
renderChrome("representatives.html");
let all = [];
let currentSort = "ward";
let filter = "";
/* Incoming treatment (search-federation wave, Oct 28, 2026): the
   seven members elected October 26, 2026 carry no summary stats yet.
   The card says when they take office, what happens to their record,
   and why the disc shows initials — official portraits are added
   when the City of Toronto publishes them, never before. Six are
   new; Mike Layton returns, so his card points at his earlier
   service instead of claiming his record starts now. */
function incomingBlockHTML(c) {
  const prior = (c.terms || []).filter((t) => t !== "2026-2030");
  const recordLine = prior.length
    ? `Returning to Council — their earlier service (${esc(prior[0].slice(0, 4))}–${esc(prior[prior.length - 1].slice(5))}) is on their record page. Their new-term record begins November 15, 2026.`
    : "No votes yet — their voting record begins with the new term.";
  return `<div class="incoming-block">
    <p class="incoming-marker"><strong>Elected October 26, 2026 — takes office November 15, 2026</strong></p>
    <p class="incoming-record">${recordLine}</p>
    <p class="incoming-portrait">No official portrait yet — the City of Toronto has not published one. Their initials stand in until it does; Deme adds official portraits as the City publishes them.</p>
  </div>`;
}
function personCard(c) {
  const role = c.mayor ? "Mayor of Toronto"
    : `Councillor · Ward ${c.ward} — ${esc(c.wardName)}`;
  const stats = c.incoming
    ? incomingBlockHTML(c)
    : memberStatsHTML(c);
  return `<article class="person${c.mayor ? " is-mayor" : ""}">
    <div class="person-top">${avatarHTML(c)}
      <div>
        <h3><a href="councillor.html?m=${encodeURIComponent(c.slug)}">${esc(c.name)}</a></h3>
        <p class="ward">${role}</p>
      </div>
    </div>
    ${stats}
  </article>`;
}
/* One filter for the grid: a name, as before — and now also a ward
   name or a ward number ("ward 21", "21", "Scarborough Southwest"),
   which the unified finder accepts in the same box. */
function matches(c, q) {
  if (!q) return true;
  if (c.name.toLowerCase().includes(q)) return true;
  if (c.wardName && c.wardName.toLowerCase().includes(q)) return true;
  const wm = q.match(/^(?:ward\s*)?(\d{1,2})$/);
  if (wm && c.ward === Number(wm[1])) return true;
  if (q === "mayor" && c.mayor) return true;
  return false;
}
/* ---- Earlier-members ward data (polish wave) ----
   earlier-wards.json (ward per member per term) and ward-crosswalk.json
   (era ward lists + predecessor/successor mapping) load LAZILY, only
   when the Earlier details is first opened (or the section search is
   first used). Until then — and if the load fails — rows render exactly
   as before, just without ward info. Unknown wards are omitted.
   register-counts.json (v30) rides the same lazy load: the official-
   register counts line on each row appears only once it has loaded,
   and a failed load leaves the row exactly as before — never a
   register line, never a 0 invented from the failure. */
let earlierWards = null;
let wardCrosswalk = null;
let registerCounts = null;
let earlierDataPromise = null;
let earlierQuery = "";
function loadEarlierData() {
  if (earlierDataPromise) return earlierDataPromise;
  earlierDataPromise = Promise.all([
    loadJSON(dataPath("earlier-wards.json")).catch(() => null),
    loadJSON(dataPath("ward-crosswalk.json")).catch(() => null),
    loadJSON(dataPath("register-counts.json")).catch(() => null),
  ]).then(([w, x, rc]) => {
    earlierWards = w;
    wardCrosswalk = x;
    registerCounts = rc;
    render(filter);
    return true;
  });
  return earlierDataPromise;
}
/* Compact ward summary for a member: consecutive terms sharing a ward
   collapse into one segment, e.g. "Ward 30 — Toronto—Danforth
   (2006–2018) · Ward 14 — Toronto—Danforth (2018–2026)". Mayors and
   unknown wards produce no segment. */
function wardGroups(c) {
  if (!earlierWards || !earlierWards[c.slug]) return [];
  const groups = [];
  for (const t of c.terms) {
    const info = earlierWards[c.slug][t];
    if (!info || info.ward == null) continue;
    const last = groups[groups.length - 1];
    if (last && last.ward === info.ward && last.wardName === info.wardName) {
      last.terms.push(t);
    } else groups.push({ ward: info.ward, wardName: info.wardName, terms: [t] });
  }
  return groups.map((g) => {
    const span = g.terms.length === 1
      ? fmtTerm(g.terms[0])
      : `${fmtTerm(g.terms[0]).slice(0, 4)}–${fmtTerm(g.terms[g.terms.length - 1]).slice(5)}`;
    return `Ward ${g.ward} — ${g.wardName} (${span})`;
  });
}
function wardSummary(c) {
  return wardGroups(c).join(" · ");
}
/* Interests declared for an earlier row — the member cards' measure:
   recorded votes where the member declared an interest and did not
   vote (councillors.json `interest`, counted from the vote rows
   flagged Absent(Interest Declared)). That count lives in the
   name-by-name record, 2018–2026. A member whose service ended
   before the record begins has no rows in it at all — verified
   against record-data/member/*.json for all 94 members (Oct 23,
   2026): exactly the members last seen in the record era have rows.
   For them the stat is the record's own missing mark — never a 0
   the data cannot support. */
/* The finder must not dead-end on a past member's name: when no
   current member matches but earlier members do, name them and point
   into the Earlier members section (the click opens it). */
/* Earlier members sort MOST RECENT FIRST (Amendment 3, Oct 28,
   2026): by each member's most recent service — their last date in
   the record (lastSeen), falling back to the end year of their last
   term — with name A–Z as the deterministic tiebreak. */
function lastServiceKey(c) {
  if (c.lastSeen) return c.lastSeen;
  const terms = c.terms || [];
  const last = terms[terms.length - 1];
  const end = last ? Number(String(last).slice(5, 9)) : 0;
  return end ? `${end}-12-31` : "0000-00-00";
}
function byRecentService(a, b) {
  const ka = lastServiceKey(a), kb = lastServiceKey(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  return a.name.localeCompare(b.name);
}
function earlierHintHTML(query) {
  const hits = query ? all.filter((c) => !c.current && matches(c, query)) : [];
  if (!hits.length) return `<p class="small">No current member matches.</p>`;
  hits.sort(byRecentService);
  const names = hits.slice(0, 3).map((c) => esc(c.name)).join(", ");
  const more = hits.length > 3 ? ` and ${hits.length - 3} more` : "";
  return `<p class="small">No current member matches — but ${names}${more} ${hits.length === 1 ? "is" : "are"} in <a href="#earlier-details" data-open-earlier>Earlier members ↓</a>.</p>`;
}
function earlierInterest(c) {
  if (!c.lastSeen || c.lastSeen < "2023-06-01") return "—";
  return fmtNum(Number(c.interest) || 0);
}
/* Official-register counts for an earlier row (v30) — a SEPARATE
   record from the vote-flag stat above it: entries in the City
   Clerk's Registry of Declared Interest (2007–2026) and disclosures
   in the Gift Disclosure Registry (2011–2025), from
   register-counts.json. A member who served into a register's era
   with no entries gets the true 0 in words; a member whose service
   ended before a register existed gets plain words — never a bare
   dash, never a 0 the era cannot support. Returns "" until the
   counts file has loaded, so rows render exactly as before without
   it (and stay that way if the load failed). */
function registerSegments(rc) {
  const regN = Number(rc.registerEntries) || 0;
  const giftN = Number(rc.giftDisclosures) || 0;
  const reg = rc.registerEraNA
    ? simpleT("No declared-interest register existed during their service",
        "No official list of declared interests existed while they served")
    : regN === 0
      ? simpleT("0 declarations in the official register",
          "0 declarations in the official list")
      : `${fmtNum(regN)} ${regN === 1 ? "declaration" : "declarations"}`;
  const gift = rc.giftEraNA
    ? simpleT("No gift register existed during their service",
        "No gift list existed while they served")
    : giftN === 0
      ? simpleT("0 gift disclosures in the gift registry",
          "0 gift disclosures in the gift list")
      : `${fmtNum(giftN)} gift ${giftN === 1 ? "disclosure" : "disclosures"}`;
  return { reg, gift };
}
function registerLineHTML(c) {
  if (!registerCounts || !registerCounts.members) return "";
  const rc = registerCounts.members[c.slug];
  if (!rc) return "";
  const { reg, gift } = registerSegments(rc);
  return `<p class="em-register"><strong>${simpleT("Official register:", "Official list:")}</strong> ${esc(reg)} · ${esc(gift)}<span class="em-register-src">${simpleT("City Clerk’s Registry of Declared Interest (2007–2026) · Gift Disclosure Registry (2011–2025)", "City Clerk's official list (2007–2026) · Gift Disclosure Registry (2011–2025)")}</span></p>`;
}
function earlierRow(c) {
  const wards = wardGroups(c).map((w) => `<span>${esc(w)}</span>`).join("");
  return `<li>${avatarHTML(c, "sm")}<div class="em-main">
    <p class="em-name"><a href="councillor.html?m=${encodeURIComponent(c.slug)}">${esc(c.name)}</a></p>
    <p class="em-terms">${esc(c.terms.map(fmtTerm).join(" · "))}</p>
    ${wards ? `<p class="em-wards">${wards}</p>` : ""}
    <div class="em-stats" aria-label="Record summary">
      <div><span>Votes cast</span><strong>${fmtNum(c.votesCast)}</strong></div>
      <div><span>${simpleT("Recorded-vote participation", "Recorded votes they took part in")}</span><strong>${esc(fmtAtt(c))}</strong></div>
      <div><span>${simpleT("Interest declared on a recorded vote · stepped back (since Jun 2023)", "Declared an interest on a recorded vote · did not vote (since Jun 2023)")}</span><strong>${earlierInterest(c)}</strong></div>
    </div>
    ${registerLineHTML(c)}
  </div></li>`;
}
function render(q) {
  const query = (q || "").toLowerCase();
  const cur = all.filter((c) => c.current && matches(c, query));
  if (currentSort === "name") cur.sort((a, b) => a.name.localeCompare(b.name));
  else cur.sort((a, b) => (a.mayor ? -1 : b.mayor ? 1 : a.ward - b.ward));
  document.getElementById("current").innerHTML = cur.length
    ? cur.map(personCard).join("")
    : earlierHintHTML(query);
  const old = all.filter((c) => !c.current && matches(c, query));
  old.sort(byRecentService);
  document.getElementById("earlier").innerHTML = old.map(earlierRow).join("");
  /* The section search keeps its own state: if a section query is
     active, a main-finder re-render re-applies it on top of the fresh
     default list instead of silently wiping the visitor's search. */
  if (earlierQuery) renderEarlierSearch();
}
/* ---- Earlier section search ----
   Name query: substring filter. Ward query (a ward name, "ward 18",
   or a bare number): resolved against BOTH ward eras. A number or
   name that exists in both eras shows both interpretations, clearly
   separated — numbers were reused for different areas in 2018 and are
   never silently equated. */
const normWardText = (s) => String(s || "").toLowerCase()
  .replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
function eraWardLists() {
  if (!wardCrosswalk || !wardCrosswalk.eras) return null;
  return {
    old: wardCrosswalk.eras["2006-2018"].wards,
    current: wardCrosswalk.eras["2018-2026"].wards,
  };
}
function findWardMatches(raw) {
  const lists = eraWardLists();
  if (!lists) return null;
  const q = normWardText(raw);
  const num = q.match(/^(?:ward\s*)?(\d{1,2})$/);
  const out = { old: [], current: [] };
  if (num) {
    const n = Number(num[1]);
    out.old = lists.old.filter((w) => w.ward === n);
    out.current = lists.current.filter((w) => w.ward === n);
    return out;
  }
  if (q.length < 3) return out;
  const bare = q.replace(/^ward\s+/, "");
  out.old = lists.old.filter((w) => normWardText(w.wardName).includes(bare));
  out.current = lists.current.filter((w) => normWardText(w.wardName).includes(bare));
  return out;
}
/* Entries for a (term, ward) pair among earlier members, A–Z. */
function earlierEntriesFor(termWardPairs) {
  const wanted = new Set(termWardPairs.map(([t, w]) => `${t}|${w}`));
  const rows = [];
  for (const c of all) {
    if (c.current || !earlierWards || !earlierWards[c.slug]) continue;
    for (const t of c.terms) {
      const info = earlierWards[c.slug][t];
      if (info && info.ward != null && wanted.has(`${t}|${info.ward}`)) {
        rows.push({ c, term: t, ward: info.ward, wardName: info.wardName });
      }
    }
  }
  return rows;
}
function groupedRowsHTML(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.term}|${r.ward}`;
    if (!groups.has(key)) groups.set(key, { term: r.term, ward: r.ward, wardName: r.wardName, members: [] });
    groups.get(key).members.push(r.c);
  }
  return [...groups.values()]
    .sort((a, b) => b.term.localeCompare(a.term) || a.ward - b.ward)
    .map((g) => {
      g.members.sort(byRecentService);
      return `<div class="earlier-group"><h4>${esc(fmtTerm(g.term))} · Ward ${g.ward} — ${esc(g.wardName)}</h4>
      <ul class="personlist">${g.members.map(earlierRow).join("")}</ul></div>`;
    }).join("");
}
function renderEarlierSearch() {
  const box = document.getElementById("earlier-custom");
  const list = document.getElementById("earlier");
  if (!box || !list) return;
  const raw = earlierQuery.trim();
  if (!raw) { box.hidden = true; box.innerHTML = ""; list.hidden = false; return; }
  if (!earlierWards || !wardCrosswalk) {
    box.hidden = false; list.hidden = true;
    box.innerHTML = `<p class="small">Loading ward history…</p>`;
    loadEarlierData();
    return;
  }
  const wm = findWardMatches(raw);
  const isWardQuery = wm && (wm.old.length || wm.current.length);
  box.hidden = false;
  list.hidden = true;
  if (!isWardQuery) {
    const q = raw.toLowerCase();
    const hits = all.filter((c) => !c.current && c.name.toLowerCase().includes(q));
    hits.sort(byRecentService);
    box.innerHTML = hits.length
      ? `<ul class="personlist">${hits.map(earlierRow).join("")}</ul>`
      : `<p class="small">No earlier member matches “${esc(raw)}”.</p>`;
    return;
  }
  const parts = [];
  for (const w of wm.current) {
    const preds = (wardCrosswalk.predecessors[String(w.ward)] || []);
    const pairs = [];
    for (const c of all) {
      if (c.current || !earlierWards[c.slug]) continue;
      for (const t of c.terms) {
        const info = earlierWards[c.slug][t];
        if (!info || info.ward == null) continue;
        if (t < "2018" && preds.includes(info.ward)) pairs.push([t, info.ward]);
        if (t >= "2018" && info.ward === w.ward) pairs.push([t, info.ward]);
      }
    }
    const rows = earlierEntriesFor(pairs);
    parts.push(`<div class="earlier-group"><h3>Ward ${w.ward} — ${esc(w.wardName)} (2018–today)</h3>
      <p class="small earlier-note">Ward boundaries were redrawn in 2018 — numbers were reused for different areas. Earlier members below represented the wards that covered roughly this area before 2018.</p>
      ${rows.length ? groupedRowsHTML(rows) : `<p class="small">No earlier members in the record for this area.</p>`}</div>`);
  }
  for (const w of wm.old) {
    const pairs = [];
    for (const c of all) {
      if (c.current || !earlierWards[c.slug]) continue;
      for (const t of c.terms) {
        const info = earlierWards[c.slug][t];
        if (info && info.ward === w.ward && t < "2018") pairs.push([t, info.ward]);
      }
    }
    const rows = earlierEntriesFor(pairs);
    const succ = (wardCrosswalk.successors[String(w.ward)] || []);
    const lists = eraWardLists();
    const succText = succ.map((n) => {
      const cw = lists.current.find((x) => x.ward === n);
      return cw ? `Ward ${n} — ${cw.wardName}` : `Ward ${n}`;
    }).join(" and ");
    parts.push(`<div class="earlier-group"><h3>Ward ${w.ward} — ${esc(w.wardName)} (2006–2018)</h3>
      ${rows.length ? groupedRowsHTML(rows) : `<p class="small">No earlier members in the record for this ward.</p>`}
      ${succText ? `<p class="small earlier-note">Since 2018 this area is mostly in ${esc(succText)}.</p>` : ""}</div>`);
  }
  box.innerHTML = parts.join("");
}
function initEarlierSearch() {
  const details = document.getElementById("earlier-details");
  const input = document.getElementById("eq");
  if (details) details.addEventListener("toggle", () => { if (details.open) loadEarlierData(); });
  if (!input) return;
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const v = input.value;
    t = setTimeout(() => {
      earlierQuery = v;
      if (v.trim()) loadEarlierData();
      renderEarlierSearch();
    }, 150);
  });
}
loadJSON(dataPath("councillors.json")).then((people) => {
  all = people;
  const nEarlier = people.filter((c) => !c.current).length;
  const countEl = document.getElementById("earlier-count");
  if (countEl) countEl.textContent = nEarlier;
  const noteEl = document.getElementById("earlier-count-note");
  if (noteEl) noteEl.textContent = `· ${nEarlier} members — find yours`;
  document.addEventListener("click", (e) => {
    if (!e.target.closest("a[data-open-earlier], #earlier-jump")) return;
    const d = document.getElementById("earlier-details");
    if (!d) return;
    e.preventDefault();
    d.open = true;
    loadEarlierData();
    d.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  render("");
  document.getElementById("dir-sort").addEventListener("change", (e) => {
    currentSort = e.target.value;
    render(filter);
  });
  initEarlierSearch();
  initFinder();
}).catch(() => {
  document.getElementById("current").innerHTML =
    `<p class="small">The member list could not be loaded. Please reload.</p>`;
});

/* The unified finder: ONE input that is both the directory search
   and the postal-code lookup. Text filters the grid live, exactly as
   the name search always did. A postal code runs the ward lookup —
   the existing WardFinder FSA map, first 3 characters only, computed
   here in the browser; it writes nothing anywhere: no device profile,
   no saved ward, nothing sent. Single-ward areas surface the member
   and highlight their card below; boundary areas list every
   candidate and let the visitor choose. */
function initFinder() {
  const form = document.getElementById("finder-form");
  const input = document.getElementById("fq");
  const result = document.getElementById("finder-result");
  if (!form || !input || !result) return;
  let cues = null;
  let lastFsa = null;
  let t;
  const norm = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  /* Postal-shaped input starts with a letter followed by a digit
     (M5, M5V, M5V1J1…). Anything else is a name/ward search. */
  const looksPostal = (v) => /^[A-Z]\d/.test(norm(v));
  function memberFor(n) {
    return all.find((c) => c.current && !c.mayor && c.ward === n) || null;
  }
  function clearHighlights() {
    document.querySelectorAll(".person.lookup-hit")
      .forEach((el) => el.classList.remove("lookup-hit"));
  }
  function highlight(slug, scroll) {
    clearHighlights();
    const link = document.querySelector(
      `#current article.person h3 a[href="councillor.html?m=${encodeURIComponent(slug)}"]`);
    const card = link ? link.closest("article.person") : null;
    if (card) {
      card.classList.add("lookup-hit");
      if (scroll) card.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  async function lookup() {
    const fsa = norm(input.value).slice(0, 3);
    if (!/^[A-Z]\d[A-Z]$/.test(fsa)) {
      result.innerHTML = `<p class="wf-note">That doesn't look like a postal
        code yet — the first three characters are enough (a letter, a
        number, a letter — like M5V).</p>`;
      input.focus();
      return;
    }
    if (filter) { filter = ""; render(""); }
    result.innerHTML = `<p class="wf-note">Looking up ${esc(fsa)}…</p>`;
    let wards = null;
    try {
      if (!cues) {
        try { cues = await loadJSON(dataPath("ward-cues.json")); }
        catch (e) { cues = {}; }
      }
      wards = await WardFinder.wardsFor(fsa);
    } catch (e) { wards = null; }
    if (wards === null || !wards.length) {
      result.innerHTML = `<p class="wf-note"><strong>That postal code isn't
        in Toronto</strong> — Deme covers Toronto City Council. If you do
        live in Toronto, check the first three characters, or type your
        member's name here instead.</p>`;
      return;
    }
    if (wards.length === 1) {
      const c = memberFor(wards[0]);
      if (!c) {
        result.innerHTML = `<p class="wf-note">That's Ward ${wards[0]} —
          its seat is vacant in the current record.</p>`;
        return;
      }
      result.innerHTML = `<div class="wf-confirm">
        <p><strong>Ward ${c.ward} — ${esc(c.wardName)}.</strong>
        Your representative is ${esc(c.name)}.</p>
        <p class="wf-actions">
          <a class="btn bronze" href="councillor.html?m=${encodeURIComponent(c.slug)}">See ${esc(c.name)}'s record</a>
          <button class="btn secondary" type="button" id="lookup-show">Show their card below</button>
        </p></div>`;
      const show = result.querySelector("#lookup-show");
      if (show) show.addEventListener("click", () => {
        input.value = "";
        filter = "";
        lastFsa = null;
        render("");
        highlight(c.slug, true);
      });
      highlight(c.slug, false);
      return;
    }
    result.innerHTML = `<div class="wf-confirm">
      <p><strong>${esc(fsa)} straddles a ward boundary</strong> — parts
      of it sit in ${wards.length} wards, so Deme won't guess.
      Which part is yours?</p>
      <div class="wf-candidates">
        ${wards.map((n) => {
          const c = memberFor(n);
          if (!c) return "";
          return `<button type="button" class="wf-candidate" data-slug="${esc(c.slug)}">
            <span class="wf-cand-ward">Ward ${n} — ${esc(c.wardName)}</span>
            <span class="wf-cand-who">Councillor ${esc(c.name)}</span>
            <span class="wf-cand-cue">${esc((cues && (cues[n] || cues[String(n)])) || "")}</span>
          </button>`;
        }).join("")}
      </div></div>`;
    result.querySelectorAll("[data-slug]").forEach((b) =>
      b.addEventListener("click", () => {
        window.location.href =
          `councillor.html?m=${encodeURIComponent(b.dataset.slug)}`;
      }));
  }
  input.addEventListener("input", () => {
    const v = input.value;
    clearTimeout(t);
    if (!v.trim()) {
      lastFsa = null;
      result.innerHTML = "";
      clearHighlights();
      filter = "";
      render("");
      return;
    }
    if (looksPostal(v)) {
      /* A postal code is not a name — never grid-filter by it. A
         complete FSA resolves on its own; the Find button covers
         every other case. */
      if (filter) { filter = ""; render(""); }
      const s = norm(v);
      if (s.length >= 3 && /^[A-Z]\d[A-Z]$/.test(s.slice(0, 3))) {
        const fsa = s.slice(0, 3);
        if (fsa !== lastFsa) {
          t = setTimeout(() => { lastFsa = fsa; lookup(); }, 350);
        }
      } else {
        lastFsa = null;
      }
      return;
    }
    if (/^[A-Za-z]$/.test(v.trim())) return; /* one letter: wait for more */
    lastFsa = null;
    result.innerHTML = "";
    clearHighlights();
    t = setTimeout(() => { filter = v.trim(); render(filter); }, 150);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(t);
    const v = input.value.trim();
    if (!v) {
      result.innerHTML = `<p class="wf-note">Type a member's name or a
        ward — or the first three characters of your postal code.</p>`;
      input.focus();
      return;
    }
    if (looksPostal(v)) {
      lastFsa = norm(v).slice(0, 3);
      lookup();
    } else {
      lastFsa = null;
      result.innerHTML = "";
      filter = v;
      render(filter);
    }
  });
}
