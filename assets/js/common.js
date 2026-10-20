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
   LocalAdapter below is the production adapter on a static host: picks
   live in the visitor's own browser (localStorage), versioned schema.
   A future API phase swaps in a RemoteAdapter implementing the same
   methods — no page code changes. There is deliberately NO aggregate,
   tally, or percentage-of-visitors concept anywhere in this interface:
   a static site has no other visitors' data, and Deme never implies
   otherwise. */
const VoteStore = (() => {
  const KEY = "deme.votes.v1";
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && typeof parsed.picks === "object") {
          return parsed;
        }
      }
    } catch (e) { /* storage unavailable — fall through to empty */ }
    return { v: 1, ward: null, picks: {} };
  }
  function write(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  return {
    getWard() { return read().ward; },
    setWard(n) { const s = read(); s.ward = n; write(s); },
    getPick(ref) { return read().picks[ref] || null; },
    setPick(ref, choice) {
      const s = read();
      s.picks[ref] = { choice, ts: new Date().toISOString() };
      write(s);
    },
    clearPick(ref) { const s = read(); delete s.picks[ref]; write(s); },
    allPicks() { return read().picks; },
    exportAll() { return read(); },
    resetAll() { try { localStorage.removeItem(KEY); } catch (e) {} },
    storageKey: KEY,
  };
})();

/* TMMIS (City of Toronto agenda) record link for an item reference. */
const tmmisUrl = (ref) =>
  `https://secure.toronto.ca/tmmis/viewAgendaItemHistory.do?item=${encodeURIComponent(ref)}`;

/* Static sections are already parsed when this script runs (it sits at
   the end of <body> on every page), so reveal can be wired up now. */
setupReveal();
