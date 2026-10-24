/* Story thread — one documented keyword grouping from threads.json,
   shown year by year, newest first. Threads are a finding aid only:
   the decisions, their briefs, and their outcomes are the record's own,
   hydrated from the same per-year shards Explore uses. */
"use strict";
renderChrome("");

const PAGE = 50;
const box = document.getElementById("thread");
const pager = document.getElementById("thread-pager");
const cardCache = new Map(); // ref -> card
let flat = []; // [{year, ref}] newest year first, newest first within a year
let shown = 0;
let lastYearShown = null;

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

async function init() {
  const id = new URLSearchParams(location.search).get("t");
  let data;
  try {
    data = await loadJSON(dataPath("threads.json"));
  } catch (e) {
    box.innerHTML = `<div class="calm"><h1>The stories could not be loaded.</h1>
      <p>Please reload the page, or go <a href="index.html">back home</a>.</p></div>`;
    return;
  }
  const thread = (data.threads || []).find((t) => t.id === id);
  if (!thread) {
    box.innerHTML = `<div class="calm"><h1>That story thread wasn't found.</h1>
      <p>The record itself is unchanged — this grouping just doesn't exist.
      <a href="index.html">Back home →</a></p></div>`;
    return;
  }
  document.title = `${thread.label} — a story over time — Deme`;
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
    <p class="lede" style="margin-bottom:.6rem">${fmtNum(thread.count)} decisions ·
      ${esc(years[years.length - 1])}–${esc(years[0])}</p>
    <p class="small" style="max-width:44rem">Grouped by these words in a
    decision's title or subject terms: ${esc(ruleShown)}${ruleShown.endsWith("…") ? "" : "."}</p>
    <p class="small" style="max-width:44rem">Grouping is a finding aid — the
    record itself is unchanged. <a href="about.html">How threads are built →</a></p>
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
  await hydrate(slice);
  let html = "";
  for (const { year, ref } of slice) {
    if (year !== lastYearShown) {
      if (lastYearShown !== null) html += `</div>`;
      html += `<h2 class="thread-year">${esc(year)}</h2><div class="cards">`;
      lastYearShown = year;
    }
    const card = cardCache.get(ref);
    html += card ? decisionCard(card) : `<article class="card">
      <h3><a href="decision.html?ref=${encodeURIComponent(ref)}">Item ${esc(ref)}</a></h3>
      <p class="more"><a href="decision.html?ref=${encodeURIComponent(ref)}">Details →</a></p>
    </article>`;
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
