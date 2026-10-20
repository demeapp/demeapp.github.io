/* Deme — shared helpers, chrome (header/footer), and the vote store. */
"use strict";

/* Progressive-enhancement flags: .js gates any pre-reveal hidden state
   (content is never hidden when JS fails); .vt tells CSS the browser
   can run cross-document view transitions, so the page-in fallback
   stays off. */
document.documentElement.classList.add("js");
if (typeof document.startViewTransition === "function") {
  document.documentElement.classList.add("vt");
}

/* ---------------- formatting helpers ---------------- */
const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-CA"));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

/* ---------------- motion helpers ----------------
   Animated counter: ease-out over ~900ms, formatted with fmtNum.
   Sets the final value instantly under reduced motion, without
   requestAnimationFrame, or if anything goes wrong — the rendered
   number is always exactly fmtNum(target). */
function animateCount(el, target) {
  if (!el) return;
  const finalText = fmtNum(target);
  const reduced = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof requestAnimationFrame !== "function") {
    el.textContent = finalText;
    return;
  }
  const dur = 900, t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtNum(Math.round(target * e));
    if (p < 1) requestAnimationFrame(tick); else el.textContent = finalText;
  }
  requestAnimationFrame(tick);
}

/* Scroll reveal: .reveal elements get .in as they enter the viewport.
   Without IntersectionObserver every element is revealed at once. */
function setupReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  if (typeof IntersectionObserver !== "function") {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  els.forEach((el) => io.observe(el));
}

/* ---------------- data loading (cached) ---------------- */
const _cache = new Map();
function loadJSON(path) {
  if (!_cache.has(path)) {
    _cache.set(path, fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return _cache.get(path);
}
const dataPath = (p) => `data/${p}`;

/* ---------------- site chrome ---------------- */
const NAV = [
  ["index.html", "Home"],
  ["explore.html", "Explore"],
  ["councillors.html", "Councillors"],
  ["vote.html", "Vote"],
  ["my-record.html", "My Record"],
  ["about.html", "About"],
];
const COLUMN_MARK = `
<svg class="mark" width="30" height="38" viewBox="0 0 30 38" role="img"
     aria-label="Deme column mark">
  <rect x="3" y="2" width="24" height="4" rx="1" fill="#B08A4A"/>
  <rect x="6" y="9" width="3.6" height="19" fill="#101E38"/>
  <rect x="13.2" y="9" width="3.6" height="19" fill="#101E38"/>
  <rect x="20.4" y="9" width="3.6" height="19" fill="#101E38"/>
  <rect x="3" y="31" width="24" height="4" rx="1" fill="#B08A4A"/>
</svg>`;
function renderChrome(active) {
  const header = document.querySelector(".site-header");
  if (header) {
    header.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html">${COLUMN_MARK}
        <span><span class="wordmark">Deme</span>
        <span class="tagline">Where the people meet the vote</span></span></a>
      <nav class="site-nav" aria-label="Main">
        ${NAV.map(([href, label]) =>
          `<a href="${href}"${href === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav></div>`;
  }
  const footer = document.querySelector(".site-footer");
  if (footer) {
    footer.innerHTML = `<div class="wrap"><div class="rule"></div>
      <div class="footer-grid">
        <div class="footer-brand">
          <p><strong>Deme</strong> — Toronto City Council's record, in plain
          language. Non-partisan. No grades, no endorsements — just the record.</p>
        </div>
        <nav class="footer-group" aria-label="Explore the record">
          <p class="footer-h">Explore the record</p>
          <ul>
            <li><a href="explore.html">Explore</a></li>
            <li><a href="councillors.html">Councillors</a></li>
            <li><a href="vote.html">Vote</a></li>
          </ul>
        </nav>
        <nav class="footer-group" aria-label="How it works">
          <p class="footer-h">How it works</p>
          <ul>
            <li><a href="about.html">About</a></li>
            <li><a href="my-record.html">My Record</a></li>
          </ul>
        </nav>
      </div>
      <p class="fineprint">Built from the City of Toronto's published council
      records. Decision archive: 2018–2026 · Voting record: 2006–2026 ·
      Archive current to Oct 19, 2026. <a href="about.html">How Deme works</a></p>
      </div>`;
  }
}

/* ---------------- decision card renderer ---------------- */
function decisionCard(c, opts = {}) {
  const more = c.hasVote
    ? `<a href="decision.html?ref=${encodeURIComponent(c.ref)}">See the record
       <span aria-hidden="true">→</span></a>`
    : `<a href="decision.html?ref=${encodeURIComponent(c.ref)}">Details
       <span aria-hidden="true">→</span></a>`;
  const wards = (c.wards && c.wards.length)
    ? ` · Ward${c.wards.length > 1 ? "s" : ""} ${c.wards.join(", ")}`
    : (c.citywide ? " · Citywide" : "");
  return `<article class="card">
    <div class="meta"><span>${esc(fmtDate(c.date))}</span>
      <span>${esc(c.body)}</span>
      <span class="pill">${esc(c.statusLabel)}</span></div>
    <h3><a href="decision.html?ref=${encodeURIComponent(c.ref)}">${esc(c.title)}</a></h3>
    ${c.brief ? `<p class="brief">${esc(c.brief)}</p>` : ""}
    ${c.stake ? `<p class="stake">${esc(c.stake)}</p>` : ""}
    <p class="more">${more}<span class="muted">${wards}</span></p>
  </article>`;
}

/* ---------------- vote store ----------------
   All vote reads/writes go through this adapter interface:
     getWard() / setWard(n|null)
     getPick(ref) / setPick(ref, choice) / clearPick(ref)
     allPicks() -> {ref: {choice, ts}}
     exportAll() / resetAll()
     getWatchWard() / setWatchWard(n|null)
     getInterests() / setInterests(ids)
     getWardRep() / setWardRep(slug, name) / clearWardRep()
     getMayorRep() / setMayorRep(slug, name) / clearMayorRep()
     hasProfile()
   LocalAdapter below is the production adapter on a static host: picks
   and the "Your Deme" profile (ward, an optional second watched
   ward, followed topics, ward/mayor rep snapshots, last-changed
   time) live in the visitor's own browser (localStorage), v2.
   Migration: on read, a valid v2 wins. Otherwise a valid v1 migrates
   losslessly — ward and every pick (choice + ts) carry over exactly,
   new fields empty — v2 is persisted, verified by re-reading it
   (ward + pick count must match), and only then is v1 removed. If
   persisting/verifying fails, v1 stays and the migrated state is
   kept in memory for the session. Corrupt JSON counts as absent.
   A future API phase swaps in a RemoteAdapter implementing the same
   methods — no page code changes. There is deliberately NO aggregate,
   tally, or percentage-of-visitors concept anywhere in this interface:
   a static site has no other visitors' data, and Deme never implies
   otherwise. */
/* Council alerts (staged) — single config point. Empty string = sign-ups not open yet; the parent will supply the Google Form URL here. */
const DEME_ALERTS_FORM_URL = "";
const VoteStore = (() => {
  const KEY = "deme.votes.v2", OLD = "deme.votes.v1";
  let mem = null; /* session-only state if a migration cannot persist */
  const now = () => new Date().toISOString();
  const fresh = () => ({ v: 2, ward: null, watchWard: null, interests: [],
    picks: {}, wardRep: null, mayorRep: null, profileUpdatedAt: null });
  function shape(p) {
    const s = fresh();
    s.ward = p.ward ?? null;
    s.watchWard = p.watchWard ?? null;
    if (Array.isArray(p.interests)) s.interests = p.interests;
    s.picks = p.picks;
    s.wardRep = p.wardRep ?? null;
    s.mayorRep = p.mayorRep ?? null;
    s.profileUpdatedAt = p.profileUpdatedAt ?? null;
    return s;
  }
  function parse(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.picks && typeof p.picks === "object") return p;
      }
    } catch (e) { /* corrupt / unavailable — treat as absent */ }
    return null;
  }
  function read() {
    if (mem) return mem;
    const p2 = parse(KEY);
    if (p2 && p2.v === 2) return shape(p2);
    const p1 = parse(OLD);
    if (p1 && p1.v === 1) {
      const s = fresh();
      s.ward = p1.ward ?? null;
      s.picks = p1.picks;
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
        const back = parse(KEY);
        if (!back || back.v !== 2 || back.ward !== s.ward
          || Object.keys(back.picks).length !== Object.keys(s.picks).length) {
          throw new Error("verify");
        }
        try { localStorage.removeItem(OLD); } catch (e) {}
        return s;
      } catch (e) { mem = s; return mem; }
    }
    return fresh();
  }
  function write(s) {
    if (mem) mem = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); }
    catch (e) { mem = s; }
  }
  return {
    storageKey: KEY,
    getWard() { return read().ward; },
    setWard(n) {
      const s = read();
      if (s.ward !== n) {
        s.ward = n; s.wardRep = null; s.profileUpdatedAt = now();
      }
      write(s);
    },
    getWatchWard() { return read().watchWard; },
    setWatchWard(n) {
      const s = read();
      if (s.watchWard !== n) { s.watchWard = n; s.profileUpdatedAt = now(); }
      write(s);
    },
    getInterests() { return read().interests.slice(); },
    setInterests(ids) {
      const s = read();
      const next = Array.isArray(ids) ? ids.slice() : [];
      if (JSON.stringify(s.interests) !== JSON.stringify(next)) {
        s.interests = next; s.profileUpdatedAt = now();
      }
      write(s);
    },
    getWardRep() { return read().wardRep; },
    setWardRep(slug, name) {
      const s = read(); s.wardRep = { slug, name }; write(s);
    },
    clearWardRep() { const s = read(); s.wardRep = null; write(s); },
    getMayorRep() { return read().mayorRep; },
    setMayorRep(slug, name) {
      const s = read(); s.mayorRep = { slug, name }; write(s);
    },
    clearMayorRep() { const s = read(); s.mayorRep = null; write(s); },
    hasProfile() {
      const s = read();
      return s.ward != null || s.watchWard != null || s.interests.length > 0;
    },
    getPick(ref) { return read().picks[ref] || null; },
    setPick(ref, choice) {
      const s = read();
      s.picks[ref] = { choice, ts: now() };
      write(s);
    },
    clearPick(ref) { const s = read(); delete s.picks[ref]; write(s); },
    allPicks() { return read().picks; },
    exportAll() { return read(); },
    resetAll() {
      mem = null;
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(OLD);
      } catch (e) {}
    },
  };
})();

/* TMMIS (City of Toronto agenda) record link for an item reference. */
const tmmisUrl = (ref) =>
  `https://secure.toronto.ca/tmmis/viewAgendaItemHistory.do?item=${encodeURIComponent(ref)}`;

/* Static sections are already parsed when this script runs (it sits at
   the end of <body> on every page), so reveal can be wired up now. */
setupReveal();
