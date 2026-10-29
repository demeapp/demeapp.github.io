/* Story thread — one documented keyword grouping from threads.json,
   shown year by year, newest first. Threads are a finding aid only:
   the decisions, their briefs, and their outcomes are the record's own,
   hydrated from the same per-year shards Explore uses.
   v57: the same page renders the Ontario and federal stories with
   ?level=ontario / ?level=canada — the same mechanism, the level's
   own divisions.json as the hydration source, and division cards
   linking to the internal on/ and ca/ division pages. Toronto (no
   level param) is the default path and renders exactly as before. */
"use strict";
renderChrome("");

const PAGE = 50;
const box = document.getElementById("thread");
const pager = document.getElementById("thread-pager");
const cardCache = new Map(); // ref -> card
let flat = []; // [{year, ref}] newest year first, newest first within a year
let shown = 0;
let lastYearShown = null;

/* Levels (v57, DESIGN §3.1/§3.3): Toronto is the default and its
   URLs carry no level param. The two division levels hydrate from
   their shipped divisions.json and link to the internal division
   pages; every level-specific string lives in this table, never
   hardcoded in the render paths below. */
const LEVELS = {
  toronto: {
    threadsFile: "threads.json",
    unit: "Toronto decisions",
    titleChamber: null,
    ruleWhere: "decision's title or subject terms",
  },
  ontario: {
    threadsFile: "ontario/threads.json",
    divisionsFile: "ontario/divisions.json",
    unit: "Ontario divisions",
    titleChamber: "Ontario Legislature",
    ruleWhere: "division's title",
    dir: "on",
  },
  canada: {
    threadsFile: "federal/threads.json",
    divisionsFile: "federal/divisions.json",
    unit: "House of Commons divisions",
    titleChamber: "House of Commons",
    ruleWhere: "division's subject",
    dir: "ca",
  },
};
let LEVEL = LEVELS.toronto;

/* The lede's span start, "Jan 2018" style, derived from the story's
   own oldest date (Toronto's stories all start in Jan 2018, so the
   rendered Toronto lede is unchanged). */
function startLabel(iso) {
  const s = String(iso || "");
  const mon = MONTHS[Number(s.slice(5, 7)) - 1];
  return mon ? `${mon} ${s.slice(0, 4)}` : s.slice(0, 4);
}

/* Ontario division dates ship long-form ("June 2, 2026"); the card
   renderer formats ISO, so hydration normalizes them here. */
const ON_MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11,
  December: 12,
};
function ontarioIso(s) {
  const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(String(s || ""));
  if (!m || !ON_MONTHS[m[1]]) return String(s || "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${m[3]}-${pad(ON_MONTHS[m[1]])}-${pad(Number(m[2]))}`;
}

/* threads.json's `rule` field is the grouping pattern itself (e.g.
   "\bhousing\b"). Render it as the plain list of words it matches, so
   the header stays readable without changing what the rule is. */
function humanizeRule(rule) {
  return String(rule || "").split("|").map((part) => {
    /* A pattern part with no trailing \b is a prefix match in the
       record (librar…, bicycl…, subway…) — the ellipsis says so. */
    const openEnded = !/\\b\s*$/.test(part);
    const cleaned = part
      .replace(/\\b/g, "")
      .replace(/\\w\*/g, "…")
      .replace(/\\/g, "")
      .replace(/\?/g, "")
      .trim();
    return openEnded && cleaned && !cleaned.endsWith("…") ? cleaned + "…" : cleaned;
  }).filter(Boolean).join(", ");
}

async function hydrate(refs) {
  const byYear = new Map();
  refs.forEach(({ year, ref }) => {
    if (!cardCache.has(ref)) {
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(ref);
    }
  });
  await Promise.all([...byYear.keys()].map(async (y) => {
    try {
      const cards = await loadJSON(dataPath(`index-${y}.json`));
      const want = new Set(byYear.get(y));
      cards.forEach((c) => { if (want.has(c.ref)) cardCache.set(c.ref, c); });
    } catch (e) { /* a missing shard renders calm fallbacks, never guesses */ }
  }));
}

/* Division hydration (v57): the level's divisions.json loads once
   per story page and the matched indices are read straight from it
   — no new shard files. Cards are cached as {rec, iso} so the
   renderer gets the record's own fields plus an ISO date. */
let divisionsAll = null;
async function hydrateDivisions(refs) {
  const want = refs.filter(({ ref }) => !cardCache.has(ref));
  if (!want.length) return;
  if (!divisionsAll) {
    try {
      divisionsAll = await loadJSON(dataPath(LEVEL.divisionsFile));
    } catch (e) { /* a missing file renders calm fallbacks, never guesses */ return; }
  }
  want.forEach(({ ref }) => {
    const d = divisionsAll[ref];
    if (d) {
      cardCache.set(ref, {
        rec: d,
        iso: LEVEL === LEVELS.ontario ? ontarioIso(d.date) : d.date,
      });
    }
  });
}

/* Division cards (v57): the same card shape as the homepage's
   divisionCard — date, chamber, outcome pill, the title linking to
   the internal division page (the official bill/vote link lives on
   that page), and the closing line onto the members' records. */
function divisionCard(i, card) {
  const d = card.rec;
  if (LEVEL === LEVELS.ontario) {
    const tally = d.outcome && d.ayes != null && d.nays != null
      ? `${d.outcome} ${d.ayes}–${d.nays}` : (d.outcome || "");
    return `<article class="card">
      <div class="meta"><span>${esc(fmtDate(card.iso))}</span>
        <span>Ontario Legislature</span>
        ${tally ? `<span class="pill">${esc(tally)}</span>` : ""}</div>
      <h3><a href="on/division-${i}.html">${esc(d.title)}</a></h3>
      <p class="more"><a href="representatives.html?level=ontario">On the MPPs' records <span aria-hidden="true">→</span></a></p>
    </article>`;
  }
  return `<article class="card">
    <div class="meta"><span>${esc(fmtDate(card.iso))}</span>
      <span>House of Commons</span>
      ${d.result ? `<span class="pill">${esc(d.result)}</span>` : ""}</div>
    <h3><a href="ca/division-${i}.html">${esc(d.subject)}</a></h3>
    <p class="more"><a href="representatives.html?level=canada">On the MPs' records <span aria-hidden="true">→</span></a></p>
  </article>`;
}

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get("t");
  LEVEL = LEVELS[params.get("level")] || LEVELS.toronto;
  let data;
  try {
    data = await loadJSON(dataPath(LEVEL.threadsFile));
  } catch (e) {
    box.innerHTML = `<div class="calm"><h1>The stories could not be loaded.</h1>
      <p>Please reload the page, or go <a href="index.html">back home</a>.</p></div>`;
    return;
  }
  const thread = (data.threads || []).find((t) => t.id === id);
  if (!thread) {
    box.innerHTML = `<div class="calm"><h1>That story wasn't found.</h1>
      <p>The record itself is unchanged — this grouping just doesn't exist.
      <a href="index.html">Back home →</a></p></div>`;
    return;
  }
  document.title = LEVEL.titleChamber
    ? `${thread.label} — ${LEVEL.titleChamber} — a story over time — Deme`
    : `${thread.label} — a story over time — Deme`;
  /* Prefer the exporter's human-readable ruleText (D12 — the regex
     stem "librar…" is not a rule a reader can use); humanizeRule is
     the fallback for shards without one. */
  const ruleShown = thread.ruleText || humanizeRule(thread.rule);
  const years = Object.keys(thread.years).sort().reverse();
  flat = years.flatMap((y) => thread.years[y].map((ref) => ({ year: y, ref })));
  box.innerHTML = `
    <p class="kicker">Stories over time</p>
    <h1 style="font-size:clamp(1.9rem,4.5vw,2.8rem)">${esc(thread.label)}</h1>
    <hr class="rule">
    <p class="lede" style="margin-bottom:.6rem">${fmtNum(thread.count)} ${LEVEL.unit} · ${esc(startLabel(thread.oldest))} – ${esc(fmtDate(thread.newest))} · Newest first</p>
    <p class="small" style="max-width:44rem">Grouped by these words in a
    ${LEVEL.ruleWhere}: ${esc(ruleShown)}${ruleShown.endsWith("…") ? "" : "."}</p>
    <p class="small" style="max-width:44rem">Grouping is a finding aid — the
    record itself is unchanged. <a href="about.html">How stories are built →</a></p>
    <div id="thread-list"></div>`;
  /* The paged list renders into its own container so the header stays put. */
  renderMoreInto(document.getElementById("thread-list"));
}

async function renderMoreInto(listBox) {
  /* The pager rewrite below destroys the focused button — remember
     whether it held focus so its replacement can take it back. */
  const wasFocused = document.activeElement
    && document.activeElement.id === "thread-more";
  const slice = flat.slice(shown, shown + PAGE);
  shown += slice.length;
  if (LEVEL.divisionsFile) await hydrateDivisions(slice);
  else await hydrate(slice);
  let html = "";
  for (const { year, ref } of slice) {
    if (year !== lastYearShown) {
      if (lastYearShown !== null) html += `</div>`;
      html += `<h2 class="thread-year">${esc(year)}</h2><div class="cards">`;
      lastYearShown = year;
    }
    const card = cardCache.get(ref);
    html += card
      ? (LEVEL.divisionsFile ? divisionCard(ref, card) : decisionCard(card))
      : (LEVEL.divisionsFile ? `<article class="card">
      <h3><a href="${LEVEL.dir}/division-${ref}.html">Item ${esc(ref)}</a></h3>
      <p class="more"><a href="${LEVEL.dir}/division-${ref}.html">Details →</a></p>
    </article>` : `<article class="card">
      <h3><a href="decision.html?ref=${encodeURIComponent(ref)}">Item ${esc(ref)}</a></h3>
      <p class="more"><a href="decision.html?ref=${encodeURIComponent(ref)}">Details →</a></p>
    </article>`);
  }
  if (slice.length && shown >= flat.length) html += `</div>`;
  listBox.insertAdjacentHTML("beforeend", html);
  pager.innerHTML = shown < flat.length
    ? `<button class="btn secondary" id="thread-more">Show more (${fmtNum(flat.length - shown)} remaining)</button>`
    : "";
  const more = document.getElementById("thread-more");
  if (more) {
    more.addEventListener("click", () => renderMoreInto(listBox));
    if (wasFocused) more.focus();
  } else if (wasFocused) {
    pager.setAttribute("tabindex", "-1");
    pager.focus();
  }
}
init();
