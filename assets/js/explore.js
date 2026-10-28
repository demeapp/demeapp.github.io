/* Explore — one uniform path: the slim search index is filtered in the
   browser; briefs for the visible page are hydrated from per-year shards.
   Plain-words questions are parsed by ask.js (parseAsk) into structured
   pieces; applyFilters merges those pieces with the manual controls
   into ONE effectiveFilters object, and the row predicate — and the
   interpretation line above the results — read only from it. */
"use strict";
renderChrome("explore.html");

const STATUS_LABELS = {
  ADOPTED: "Adopted", AMENDED: "Adopted with changes",
  RECEIVED: "Received for information", POSTPONE: "Postponed",
  REFERRED: "Referred back for more work", WITHDRAW: "Withdrawn",
  CONFRMED: "Confirmed", NO_ACTN: "No action taken",
  NOQUORUM: "Not decided — no quorum", RESCIND: "Rescinded",
  DEFERIND: "Deferred indefinitely", NOTADOPT: "Not adopted",
  DEEMADPT: "Deemed adopted", WO_RECS: "Forwarded without a recommendation",
  INT_FAIL: "Not introduced", OOORDER: "Ruled out of order",
};
const PAGE = 25;
let rows = [], councillors = [], filtered = [], shown = 0;
/* Render generations: applyFilters bumps renderSeq on every reset,
   and page renders run one at a time off renderTail. A render whose
   generation has been superseded — by a streamed shard landing, a
   keystroke, any reset — appends nothing. Without this, a render
   suspended in hydrate() while the next reset starts a second render
   of the same first page appends its copy too, and the visitor sees
   page one twice (or three times). */
let renderSeq = 0;
let renderTail = Promise.resolve();
let archiveLoading = false; // D1: true until every search-<year> shard lands
let userEngaged = false; // polish wave: true once the visitor types, filters, or pages
let parsed = null; // parseAsk result for the current query text, or null
let profileFilter = null; // "Use my profile" filter, or null when off
let profileSummaryBase = ""; // profile-row summary without " — filter on"
const briefCache = new Map(); // ref -> card (filled from year shards)
const $ = (id) => document.getElementById(id);

/* Federated record search (search-federation wave, Oct 28, 2026):
   the one box searches all three record layers — Toronto decisions
   (the per-year shards above) plus the Ontario and federal recorded
   divisions, read from the derived slim shards built by
   tools/build_division_search.py out of the layers' own divisions
   files. The level chips choose the layer; counts are always per
   layer and never summed. People search is NOT here any more — it
   lives in the Representatives directory; this page only answers
   "what did the record decide". */
const LEVELS = ["all", "toronto", "ontario", "canada"];
let level = "all";
let onRows = null; // Ontario slim division rows (null until loaded)
let caRows = []; // federal slim division rows, accumulated per session
let caManifest = null; // federal session manifest (null until loaded)
let caStarted = false;
let divLayer = null, divList = [], divShown = 0;
let lastAll = null; // per-layer counts for the All-levels count line

function divNorm(s) {
  return String(s == null ? "" : s).normalize("NFD")
    .replace(/[̀-ͯ]/g, "").toLowerCase();
}
/* What a division can honestly be searched by, from the layer data:
   Ontario — title words, bill number, outcome, parliament. Federal —
   subject words, bill (C-39 matches "c39" too), result, session.
   Neither layer file carries per-division member or party fields, so
   no member or party filter is offered for them. */
function divHaystack(layerName, r) {
  if (layerName === "ontario") {
    return divNorm([r.t, r.o, r.b ? `bill ${r.b}` : "",
      r.p ? `parliament ${r.p}` : ""].join(" "));
  }
  return divNorm([r.t, r.b || "", (r.b || "").replace(/-/g, ""),
    r.b ? `bill ${r.b}` : "", r.r, r.s].join(" "));
}
/* The words the divisions are matched against: the question parser's
   free words plus its topic labels (topics themselves are Toronto's
   taxonomy — a division matches the topic's own word in its subject,
   not the Toronto synonym list). */
function divTokens() {
  const toks = [];
  const push = (s) => divNorm(s).split(/\s+/).forEach((t) => {
    if (t && !toks.includes(t)) toks.push(t);
  });
  if (parsed) {
    parsed.freeTokens.forEach(push);
    parsed.topicTokens.forEach((g) => push(g.label || ""));
  } else {
    push($("q").value);
  }
  /* Bill designations stay whole: the question parser splits "C-39"
     into "c" + "39", which would match any subject containing both
     fragments anywhere — the compound token restores the precision
     the visitor typed. */
  (divNorm($("q").value).match(/\b[a-z]-\d+\b/g) || []).forEach(push);
  return toks;
}
const BILL_TOKEN_RE = /^[a-z]{1,2}-\d+$/;
const NUM_TOKEN_RE = /^\d+$/;
function computeDivFiltered(layerName) {
  const src = layerName === "ontario" ? (onRows || []) : caRows;
  const toks = divTokens();
  /* Bill designations and bare numbers match at boundaries, never
     as substrings: "C-39" must not return C-391–C-399, and "119"
     must not bite into a longer number (visitor-eye blocker, Oct
     28, 2026 — the first cut matched substrings and returned 28
     divisions for C-39, only 9 of them C-39). Ordinary words keep
     the archive's substring matching. */
  const matchers = toks.map((t) => (BILL_TOKEN_RE.test(t) || NUM_TOKEN_RE.test(t))
    ? new RegExp(`(?<![a-z0-9])${t.replace(/[-]/g, "\\-")}(?![0-9])`) : null);
  const yearSel = $("f-year").value;
  let yf = null, yt = null;
  if (yearSel) { yf = Number(yearSel); yt = Number(yearSel); }
  else if (parsed && parsed.yearFrom != null) {
    yf = parsed.yearFrom; yt = parsed.yearTo;
  }
  const oc = layerName === "ontario"
    ? $("f-on-outcome").value : $("f-ca-result").value;
  return src.filter((r) => {
    const y = Number(String(r.d).slice(0, 4));
    if (yf != null && (y < yf || y > yt)) return false;
    if (oc && (layerName === "ontario" ? r.o : r.r) !== oc) return false;
    if (toks.length && !toks.every((t, i) => matchers[i]
      ? matchers[i].test(r._hay) : r._hay.includes(t))) return false;
    return true;
  });
}
/* Division cards follow the homepage's three-chamber Latest pattern
   (index.html divisionCard): chamber named on every card, the title
   links to the official record, and a closing line routes to the
   members whose record the division sits on. */
function onDivisionCard(r) {
  const tally = r.o && r.ay != null && r.na != null
    ? `${r.o} ${r.ay}–${r.na}` : (r.o || "");
  const head = r.u
    ? `<a href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.t)}</a>`
    : `<a href="representatives.html?level=ontario">${esc(r.t)}</a>`;
  return `<article class="card">
    <div class="meta"><span>${esc(fmtDate(r.d))}</span>
      <span>Ontario Legislature</span>
      ${tally ? `<span class="pill">${esc(tally)}</span>` : ""}</div>
    <h3>${head}</h3>
    <p class="more"><a href="representatives.html?level=ontario">On the MPPs' records <span aria-hidden="true">→</span></a></p>
  </article>`;
}
function caDivisionCard(r) {
  const head = r.u
    ? `<a href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.t)}</a>`
    : `<a href="representatives.html?level=canada">${esc(r.t)}</a>`;
  return `<article class="card">
    <div class="meta"><span>${esc(fmtDate(r.d))}</span>
      <span>House of Commons</span>
      ${r.b ? `<span>${esc(r.b)}</span>` : ""}
      ${r.r ? `<span class="pill">${esc(r.r)}</span>` : ""}</div>
    <h3>${head}</h3>
    <p class="more"><a href="representatives.html?level=canada">On the MPs' records <span aria-hidden="true">→</span></a></p>
  </article>`;
}
function fillDivOutcomeSelects() {
  if (onRows) {
    const order = ["Carried", "Lost"];
    const present = [...new Set(onRows.map((r) => r.o).filter(Boolean))]
      .sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || a.localeCompare(b));
    const sel = $("f-on-outcome"), cur = sel.value;
    fillSelect(sel, present.map((o) => [o, o]), "All outcomes");
    if (cur && present.includes(cur)) sel.value = cur;
  }
  if (caManifest) {
    const order = ["Agreed To", "Negatived", "Tie"];
    const present = [...new Set(caRows.map((r) => r.r).filter(Boolean))]
      .sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || a.localeCompare(b));
    const sel = $("f-ca-result"), cur = sel.value;
    fillSelect(sel, present.map((o) => [o, o]), "All results");
    if (cur && present.includes(cur)) sel.value = cur;
  }
}
async function ensureOntario() {
  if (onRows) return;
  try {
    const loaded = await loadJSON(dataPath("ontario/search-divisions.json"));
    loaded.forEach((r) => { r._hay = divHaystack("ontario", r); });
    onRows = loaded;
  } catch (e) { onRows = []; }
  fillDivOutcomeSelects();
  if (level === "ontario" || level === "all") applyFilters();
}
async function ensureCanada() {
  if (caStarted) return;
  caStarted = true;
  try {
    const idx = await loadJSON(dataPath("federal/search-divisions-index.json"));
    caManifest = idx.sessions || [];
    fillYearOptions();
    for (const s of caManifest) {
      const part = await loadJSON(
        dataPath(`federal/search-divisions-${s.s}.json`)).catch(() => []);
      part.forEach((r) => { r._hay = divHaystack("canada", r); });
      caRows = caRows.concat(part);
      /* Newest sessions land first, so the visible page is already
         the newest results — streaming only grows the counts. */
      if (level === "canada") refreshDivCountsOnly();
      else if (level === "all") refreshAllCountsOnly();
    }
  } catch (e) { /* the layer simply stays empty */ }
  fillDivOutcomeSelects();
  if (level === "canada" || level === "all") applyFilters();
}

function tokens(q) {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}
function matches(row, qTokens) {
  if (!qTokens.length) return true;
  const hay = row.t + " " + row.tp;
  return qTokens.every((t) => hay.includes(t));
}

/* The single source of truth for what is being shown. Manual controls
   win over parsed pieces (changing a control clears the conflicting
   parsed piece — see the change handlers in init). */
function effectiveFilters() {
  const yearSel = $("f-year").value;
  const statusSel = $("f-status").value;
  const wardSel = $("f-ward").value;
  /* The profile ward only (owner rule, Oct 20, 2026): signed out
     with live accounts there is no "my ward" here — see common.js. */
  const storedWard = (typeof demeProfileWard === "function") ? demeProfileWard() : null;

  let yearFrom = null, yearTo = null;
  if (yearSel) { yearFrom = Number(yearSel); yearTo = Number(yearSel); }
  else if (parsed && parsed.yearFrom != null) {
    yearFrom = parsed.yearFrom; yearTo = parsed.yearTo;
  }

  let statusCodes = null, statusLabel = null;
  if (statusSel) { statusCodes = [statusSel]; statusLabel = STATUS_LABELS[statusSel] || statusSel; }
  else if (parsed && parsed.statusGroup) {
    statusCodes = parsed.statusGroup.codes; statusLabel = parsed.statusGroup.label;
  }

  let wardNum = null;
  if (wardSel) wardNum = Number(wardSel);
  else if (parsed && parsed.ward != null) {
    wardNum = parsed.ward === "mine" ? storedWard : parsed.ward;
  }

  /* The member whose record the question is about: an explicit name,
     or "my councillor" resolved through the stored ward. */
  let member = (parsed && parsed.member) || null;
  if (!member && parsed && parsed.ward === "mine" && storedWard != null) {
    const m = councillors.find((c) => c.current && !c.mayor && c.ward === storedWard);
    if (m) member = { slug: m.slug, name: m.name };
  }

  return {
    freeTokens: parsed ? parsed.freeTokens : tokens($("q").value),
    topicGroups: parsed ? parsed.topicTokens : [],
    ref: parsed && parsed.ref ? parsed.ref : null,
    yearFrom, yearTo,
    body: $("f-body").value || null,
    statusCodes, statusLabel,
    wardNum,
    voteOnly: $("f-vote").checked || Boolean(parsed && parsed.voteOnly),
    closeOnly: Boolean(parsed && parsed.closeOnly),
    member,
    storedWard,
  };
}

/* The filter computation, split out of applyFilters (polish wave,
   Oct 22, 2026) so the archive stream can refresh the result COUNT
   without re-rendering the cards — see streamRest. */
function computeFiltered() {
  const eff = effectiveFilters();
  /* A profile filter with no wards and no interest refs is treated as
     off — the predicate below is a no-op whenever profileFilter is off. */
  const profileActive = Boolean(profileFilter
    && (profileFilter.wards.length || profileFilter.interestRefs));
  const list = rows.filter((r) =>
    (!eff.ref || (r.ref && String(r.ref).toUpperCase() === eff.ref)) &&
    matches(r, eff.freeTokens) &&
    askRowMatchesTopics(r, eff.topicGroups) &&
    (eff.yearFrom == null || (Number(r.year) >= eff.yearFrom && Number(r.year) <= eff.yearTo)) &&
    (!eff.body || r.body === eff.body) &&
    (!eff.statusCodes || eff.statusCodes.includes(r.status)) &&
    (eff.wardNum == null || (r.w && r.w.includes(eff.wardNum))) &&
    (!eff.voteOnly || r.hv === 1) &&
    (!eff.closeOnly || (r.hv === 1 && r.dm != null && r.dm <= 2)) &&
    (!profileActive
      || (r.w && r.w.some((w) => profileFilter.wards.includes(w)))
      || (profileFilter.interestRefs && profileFilter.interestRefs.has(r.ref))));
  /* Close-votes lens: with the close filter on, browse by the margin
     of the vote that decided each item — closest first, ties newest
     first. r.dm is that deciding margin (the item's last Adopt Item
     vote at City Council stage, precomputed in the search rows), and
     the tiles' printed vote counts quote the same deciding vote, so
     the banner's "margin of two or fewer" holds literally. This is
     deliberately not the closest-calls convention: closest-calls.json
     and the alignment figures keep the FIRST Council-stage motion as
     an item's "main" vote. */
  if (eff.closeOnly) {
    list.sort((a, b) => (a.dm - b.dm) || (a.date < b.date ? 1 : -1));
  } else {
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  return { list, eff };
}

/* The mobile Filters toggle label carries how many filters are set,
   so a collapsed panel never hides an active filter silently. */
function syncFiltersToggle() {
  const btn = document.getElementById("filters-toggle");
  if (!btn) return;
  let n = 0;
  if ($("f-year") && $("f-year").value) n += 1;
  if ($("f-body") && $("f-body").value) n += 1;
  if ($("f-status") && $("f-status").value) n += 1;
  if ($("f-ward") && $("f-ward").value) n += 1;
  if ($("f-vote") && $("f-vote").checked) n += 1;
  if (level === "ontario" && $("f-on-outcome") && $("f-on-outcome").value) n += 1;
  if (level === "canada" && $("f-ca-result") && $("f-ca-result").value) n += 1;
  btn.textContent = n ? `Filters \u2014 ${n} set` : "Filters";
}
/* The level dispatcher: every existing caller (typing, filters, the
   archive stream, the profile chips) calls applyFilters; the chips
   decide which layer's renderer answers. */
function applyFilters(opts) {
  syncFiltersToggle();
  if (level === "ontario" || level === "canada") { applyDivisions(); return; }
  if (level === "all") { applyAll(); return; }
  applyTorontoFilters(opts);
}
function applyTorontoFilters(opts) {
  syncFiltersToggle();
  /* keepShown (stream-triggered refreshes only): rebuild the list
     without yanking an engaged visitor back to page one. */
  const keepShown = opts && opts.keepShown ? shown : 0;
  const { list, eff } = computeFiltered();
  filtered = list;
  shown = 0;
  renderSeq++;
  $("results").innerHTML = "";
  memberHit(eff);
  renderInterpretation(eff);
  renderMyWardChip(eff);
  renderMore();
  if (keepShown > PAGE) {
    (async () => {
      while (shown < keepShown && shown < filtered.length) await renderMore();
    })();
  }
}

function memberHit(eff) {
  const box = $("memberhit");
  /* Search-federation wave (Oct 28, 2026): people search lives in
     the Representatives directory now — the panel carries a standing
     cross-link to it. What stays here is only the link the question
     parser itself promised: a question that names a member ("how
     did X vote on…") still points at that member's own record, as
     the interpretation line above says. The bare-name and
     cross-layer people hits are gone — one people search, in the
     directory built for it. */
  let html = "";
  if (eff.member) {
    const mc = councillors.find((c) => c.slug === eff.member.slug);
    html = `<div class="notice person-hit">${mc ? avatarHTML(mc, "sm") : ""}<span>Looking for the person? See
       <a href="councillor.html?m=${encodeURIComponent(eff.member.slug)}">
       ${esc(eff.member.name)}'s voting record →</a></span></div>`;
  }
  box.innerHTML = html;
}

function renderInterpretation(eff) {
  const box = $("interpretation");
  if (!box) return;
  const raw = $("q").value.trim();
  const parsedActive = Boolean(parsed && (parsed.member || parsed.statusGroup
    || parsed.voteOnly || parsed.closeOnly || parsed.yearFrom != null
    || parsed.ward != null || parsed.topicTokens.length || parsed.ref));
  if (parsed && !parsedActive) {
    /* Nothing was recognized. If the raw text looks like a question,
       say so plainly and let the plain search stand on its own. */
    const lower = raw.toLowerCase();
    const looksQuestion = /^(how|what|when|did|who|which)\b/.test(lower) || lower.endsWith("?");
    if (raw && looksQuestion) {
      box.hidden = false;
      box.innerHTML = `<span>${simpleT("I couldn't break that question down — here are the plain results for", "I could not work out that question — here are the plain results for")} “${esc(raw)}”.</span>`;
    } else {
      box.hidden = true; box.innerHTML = "";
    }
    return;
  }
  if (!parsedActive) { box.hidden = true; box.innerHTML = ""; return; }

  const parts = [];
  if (eff.ref) {
    parts.push(`Showing decisions for Council item “${esc(eff.ref)}”`);
  }
  if (eff.topicGroups.length) {
    parts.push(`Showing decisions about ${eff.topicGroups.map((g) => esc(g.label)).join(", ")}`);
  }
  if (eff.freeTokens.length) {
    parts.push(`matching the words “${esc(eff.freeTokens.join(" "))}”`);
  }
  if (eff.yearFrom != null) {
    parts.push(eff.yearFrom === eff.yearTo ? `${eff.yearFrom}` : `${eff.yearFrom}–${eff.yearTo}`);
  }
  if (eff.wardNum != null) parts.push(`Ward ${eff.wardNum}`);
  if (eff.closeOnly) parts.push(simpleT("close recorded votes (margin of two or fewer)", "close recorded votes (won by two votes or fewer)"));
  else if (eff.voteOnly) parts.push("with a recorded vote");
  if (eff.statusLabel && parsed && parsed.statusGroup) {
    parts.push(`Outcome: ${esc(eff.statusLabel)}`);
  }
  if (eff.member) {
    parts.push(simpleOn()
      ? `${esc(eff.member.name)}'s own votes are on their record page. Open any result to see just how each member voted.`
      : `${esc(eff.member.name)}'s own votes are on their record page — open any result to see exactly how every member voted.`);
  }
  box.hidden = false;
  box.innerHTML = `<span>${parts.join(" · ")}${simpleT(" — set by your question. Change anything with the filters, or ", " — from your question. Change anything with the filters, or ")}</span>
    <button type="button" class="interp-clear" id="interp-clear">clear the question</button>`;
  $("interp-clear").addEventListener("click", () => {
    parsed = null;
    $("q").value = "";
    applyFilters();
  });
}

/* "My ward" chip: only when a numeric ward is stored. Pressing it sets
   the ward select (a manual control, so it clears any parsed ward). */
function renderMyWardChip(eff) {
  const row = $("myward-row"), btn = $("myward");
  if (!row || !btn) return;
  if (eff.storedWard == null) { row.hidden = true; return; }
  row.hidden = false;
  btn.textContent = `My ward — Ward ${eff.storedWard}`;
  btn.setAttribute("aria-pressed",
    String($("f-ward").value === String(eff.storedWard)));
}

/* On-device profile offer: shown only with a stored profile, no
   q/year/vote params in the URL, and no dismissal this session. */
function profileDismissed() {
  try { return sessionStorage.getItem("deme.explore.profileDismissed") === "1"; }
  catch (e) { return false; }
}
function renderProfileState() {
  const summary = $("profile-summary");
  if (summary) {
    summary.textContent = profileSummaryBase + (profileFilter ? " — filter on" : "");
  }
  const use = $("use-profile"), clear = $("clear-profile");
  if (use) use.hidden = Boolean(profileFilter);
  if (clear) clear.hidden = !profileFilter;
}
async function setupProfileRow(params) {
  const row = $("profile-row");
  if (!row) return;
  if (typeof VoteStore === "undefined" || !VoteStore.hasProfile()) return;
  /* Signed out with live accounts, a stored profile is account data
     this visitor hasn't claimed — the offer stays hidden (the ward
     itself resolves through demeProfileWard everywhere below). */
  if (typeof demeSignedOut === "function" && demeSignedOut()) return;
  if (params.has("q") || params.has("year") || params.has("vote")) return;
  if (profileDismissed()) return;
  const labels = {};
  try {
    const d = await loadJSON(dataPath("threads-summary.json"));
    (d.threads || []).forEach((t) => { labels[t.id] = t.label; });
  } catch (e) { /* labels fall back to the thread ids themselves */ }
  const ward = VoteStore.getWard(), watchWard = VoteStore.getWatchWard();
  const ints = VoteStore.getInterests();
  let summary = "";
  if (ward != null) summary += `Ward ${ward}`;
  if (watchWard != null) summary += (ward != null ? " + Ward " : "Ward ") + watchWard;
  if (ints.length) summary += ` · ${ints.map((id) => labels[id] || id).join(", ")}`;
  profileSummaryBase = summary;
  renderProfileState();
  row.hidden = false;
}

async function hydrate(refs) {
  const byYear = new Map();
  refs.forEach((r) => {
    if (!briefCache.has(r.ref)) {
      if (!byYear.has(r.year)) byYear.set(r.year, []);
      byYear.get(r.year).push(r.ref);
    }
  });
  await Promise.all([...byYear.keys()].map(async (y) => {
    try {
      const cards = await loadJSON(dataPath(`index-${y}.json`));
      const want = new Set(byYear.get(y));
      cards.forEach((c) => { if (want.has(c.ref)) briefCache.set(c.ref, c); });
    } catch (e) { /* cards render without briefs if a shard fails */ }
  }));
}
/* ---------------- the living count (polish wave, Oct 22, 2026) ----
   The result number counts up to the total as results land — fast
   (~650ms), ease-out, tabular figures, and purely cosmetic: it never
   delays or blocks the results themselves, and under reduced motion
   (or without rAF) the final value is set instantly. The animated
   span is aria-hidden; the line's aria-label always carries the true
   final value for assistive tech. */
let lastCount = null;
let countRaf = null;
function animateCountNum(el, from, to) {
  if (!el) return;
  if (countRaf) cancelAnimationFrame(countRaf);
  const reduced = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || from === to || typeof requestAnimationFrame !== "function") {
    el.textContent = fmtNum(to);
    return;
  }
  const dur = 650, t0 = performance.now();
  const step = (now) => {
    /* Lower clamp as in animateCount: a first frame timestamped
       before t0 must not ease below the start value. */
    const p = Math.min(1, Math.max(0, (now - t0) / dur)),
      e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtNum(Math.round(from + (to - from) * e));
    if (p < 1) countRaf = requestAnimationFrame(step);
    else el.textContent = fmtNum(to);
  };
  countRaf = requestAnimationFrame(step);
}
function renderCount() {
  const el = $("count");
  if (!el) return;
  const n = filtered.length;
  const suffix = archiveLoading
    ? simpleT(" — the full archive is still loading; older years are on the way.", " — the full archive is still loading. Older years are on the way.") : "";
  if (!n) {
    if (countRaf) cancelAnimationFrame(countRaf);
    el.textContent = (archiveLoading
      ? "No decisions in the years loaded so far"
      : "No decisions match. Try fewer words, or clear a filter.") + suffix;
    el.setAttribute("aria-label", el.textContent);
    lastCount = 0;
    return;
  }
  const from = lastCount == null ? 0 : lastCount;
  el.setAttribute("aria-label",
    `${fmtNum(n)} decision${n === 1 ? "" : "s"} found${suffix}`);
  el.innerHTML = `<span class="count-num" aria-hidden="true">${fmtNum(from)}</span>`
    + ` decision${n === 1 ? "" : "s"} found${suffix}`;
  animateCountNum(el.querySelector(".count-num"), from, n);
  lastCount = n;
}
/* Stream-time count refresh: recompute the filtered total and update
   ONLY the count line. The cards on screen are the newest page and
   cannot change while older years stream in behind them. */
function refreshCountOnly() {
  if (level === "ontario" || level === "canada") return;
  filtered = computeFiltered().list;
  if (level === "all") {
    if (lastAll) { lastAll.toronto = filtered.length; renderAllCount(); }
    return;
  }
  renderCount();
}

/* -------- single-layer division modes (Ontario / Federal) -------- */
function renderDivCount() {
  const el = $("count");
  if (!el) return;
  const loading = divLayer === "ontario" ? !onRows : caStarted && !caManifest;
  const n = divList.length;
  let text;
  if (loading) text = "Loading the record…";
  else if (!n) text = "No divisions match. Try fewer words, or clear a filter.";
  else text = `${fmtNum(n)} division${n === 1 ? "" : "s"} found`
    + (divLayer === "canada" && caLoadingSuffix() ? " — older sessions are still loading." : "");
  el.textContent = text;
  el.setAttribute("aria-label", text);
}
function caLoadingSuffix() {
  return caManifest && caRows.length < caManifest.reduce((a, s) => a + s.n, 0);
}
function refreshDivCountsOnly() {
  if (level !== "canada" && level !== "ontario") return;
  divList = computeDivFiltered(divLayer);
  renderDivCount();
}
function renderDivPage() {
  const slice = divList.slice(divShown, divShown + PAGE);
  divShown += slice.length;
  const html = slice.map((r) =>
    divLayer === "ontario" ? onDivisionCard(r) : caDivisionCard(r)).join("");
  $("results").insertAdjacentHTML("beforeend", html);
  renderDivCount();
  $("pager").innerHTML = divShown < divList.length
    ? `<button class="btn secondary" id="more-div">Show more (${fmtNum(divList.length - divShown)} remaining)</button>`
    : "";
  const more = $("more-div");
  if (more) more.addEventListener("click", () => { userEngaged = true; renderDivPage(); });
}
function applyDivisions() {
  divLayer = level;
  renderSeq++;
  $("results").innerHTML = "";
  $("memberhit").innerHTML = "";
  const interp = $("interpretation");
  interp.hidden = true; interp.innerHTML = "";
  const loaded = divLayer === "ontario" ? Boolean(onRows) : Boolean(caManifest);
  divList = loaded ? computeDivFiltered(divLayer) : [];
  divShown = 0;
  if (!loaded) {
    $("results").innerHTML = `<p class="layer-empty">Loading the ${divLayer === "ontario" ? "Ontario Legislature" : "House of Commons"} record…</p>`;
    $("pager").innerHTML = "";
    renderDivCount();
    return;
  }
  if (!divList.length) {
    $("results").innerHTML = `<p class="layer-empty">No divisions match. Try fewer words, or clear a filter.</p>`;
    $("pager").innerHTML = "";
    renderDivCount();
    return;
  }
  renderDivPage();
}

/* -------- All levels: one section per layer, counts per layer ---- */
function renderAllCount() {
  const el = $("count");
  if (!el || !lastAll) return;
  const seg = (name, n, unit, loading) => n == null
    ? `${name} — loading`
    : `${name} — ${fmtNum(n)} ${unit}${n === 1 ? "" : "s"}${loading ? " (more on the way)" : ""}`;
  const text = [
    seg("Toronto", lastAll.toronto, "decision", archiveLoading),
    seg("Ontario", lastAll.ontario, "division", !onRows),
    seg("House of Commons", lastAll.canada, "division",
      Boolean(caManifest && caLoadingSuffix())),
  ].join(" · ");
  el.textContent = text;
  el.setAttribute("aria-label", text);
}
function refreshAllCountsOnly() {
  if (!lastAll) return;
  lastAll.canada = caManifest ? computeDivFiltered("canada").length : null;
  renderAllCount();
}
function fallbackCard(r) {
  /* Shard unavailable: never guess at a title — show the item itself. */
  return `<article class="card">
    <div class="meta"><span>${esc(fmtDate(r.date))}</span>
      <span>${esc(r.body)}</span>
      <span class="pill">${esc(STATUS_LABELS[r.status] || "Decided")}</span></div>
    <h3><a href="decision.html?ref=${encodeURIComponent(r.ref)}">Item ${esc(r.ref)}</a></h3>
    <p class="more"><a href="decision.html?ref=${encodeURIComponent(r.ref)}">Details →</a></p>
  </article>`;
}
function layerSection(layerKey, heading, list, cardsHTML) {
  /* The heading carries the layer's own count (visitor-eye nit,
     Oct 28, 2026): each section is self-verifying, and the count
     line above remains the summary — the counts sit with their
     layers and are never added together. */
  const unit = layerKey === "toronto" ? "decision" : "division";
  const countTxt = list == null ? "loading…"
    : `${fmtNum(list.length)} ${unit}${list.length === 1 ? "" : "s"}`;
  let body;
  if (list == null) {
    body = `<p class="layer-empty">Loading this record…</p>`;
  } else if (!list.length) {
    body = `<p class="layer-empty">No ${unit}s match.</p>`;
  } else {
    body = `<div class="cards">${cardsHTML}</div>`
      + (list.length > 10
        ? `<p style="margin-top:.9rem"><button type="button" class="btn secondary" data-setlevel="${layerKey}">See all ${layerKey === "toronto" ? "Toronto decisions" : layerKey === "ontario" ? "Ontario divisions" : "federal divisions"} <span aria-hidden="true">→</span></button></p>`
        : "");
  }
  return `<section class="layer-block" aria-label="${esc(heading)} results">
    <h3 class="layer-h">${esc(heading)} <span class="lh-count">— ${countTxt}</span></h3>${body}</section>`;
}
function applyAll() {
  const { list, eff } = computeFiltered();
  filtered = list;
  renderSeq++;
  const seq = renderSeq;
  memberHit(eff);
  renderInterpretation(eff);
  /* The ward/profile strips are Toronto controls — in All mode the
     shared filters only rule (scope), so the strips stay hidden. */
  const mw = $("myward-row");
  if (mw) mw.hidden = true;
  (async () => {
    const top = filtered.slice(0, 10);
    await hydrate(top);
    if (seq !== renderSeq) return;
    const onList = onRows ? computeDivFiltered("ontario") : null;
    const caList = caManifest ? computeDivFiltered("canada") : null;
    lastAll = {
      toronto: filtered.length,
      ontario: onList ? onList.length : null,
      canada: caList ? caList.length : null,
    };
    const toCards = top.map((r) => {
      const full = briefCache.get(r.ref);
      return full ? decisionCard(full) : fallbackCard(r);
    }).join("");
    const onCards = onList
      ? onList.slice(0, 10).map(onDivisionCard).join("") : "";
    const caCards = caList
      ? caList.slice(0, 10).map(caDivisionCard).join("") : "";
    $("results").innerHTML =
      layerSection("toronto", "Toronto City Council", filtered, toCards)
      + layerSection("ontario", "Ontario Legislature", onList, onCards)
      + layerSection("canada", "House of Commons", caList, caCards);
    $("pager").innerHTML = "";
    $("results").querySelectorAll("[data-setlevel]").forEach((b) =>
      b.addEventListener("click", () => setLevel(b.dataset.setlevel)));
    renderAllCount();
  })();
}

/* Entry point for every page render (applyFilters' first page and
   the Show more button alike): queue this generation's render behind
   any render still in flight, so appends land one at a time, in
   order, exactly once each. */
function renderMore() {
  const seq = renderSeq;
  renderTail = renderTail.then(() => renderPage(seq));
  return renderTail;
}
async function renderPage(seq) {
  if (seq !== renderSeq) return; // superseded before it even started
  /* The pager rewrite below destroys the focused button — remember
     whether it held focus so its replacement can take it back. */
  const wasFocused = document.activeElement
    && document.activeElement.id === "more";
  const slice = filtered.slice(shown, shown + PAGE);
  shown += slice.length;
  await hydrate(slice);
  /* A reset landed while this page hydrated: the DOM (and `shown`)
     now belong to the newer generation — append nothing. */
  if (seq !== renderSeq) return;
  const html = slice.map((r) => {
    const full = briefCache.get(r.ref);
    if (full) return decisionCard(full);
    return fallbackCard(r);
  }).join("");
  const resultsEl = $("results");
  const beforeCount = resultsEl.children.length;
  resultsEl.insertAdjacentHTML("beforeend", html);
  /* Presentation hooks only (Explore restyle): tag each new card with
     its outcome code + a recorded-vote flag so CSS can key the accent
     and marker to facts already in the index row. No text changes. */
  [...resultsEl.children].slice(beforeCount).forEach((el, i) => {
    const r = slice[i];
    if (!r) return;
    if (r.status) el.dataset.status = r.status;
    if (r.hv === 1) el.classList.add("has-vote");
  });
  renderCount();
  $("pager").innerHTML = shown < filtered.length
    ? `<button class="btn secondary" id="more">Show more (${fmtNum(filtered.length - shown)} remaining)</button>`
    : "";
  const more = $("more");
  if (more) {
    more.addEventListener("click", () => { userEngaged = true; renderMore(); });
    if (wasFocused) more.focus();
  } else if (wasFocused) {
    $("pager").setAttribute("tabindex", "-1");
    $("pager").focus();
  }
}

/* The Year select is level-aware: Toronto and Ontario span
   2018–2026; the federal record runs 2004–2026 (its manifest, once
   loaded, is the authority for the span). All levels offers the
   union — a year simply finds nothing in a layer that has none. */
function fillYearOptions() {
  const sel = $("f-year");
  if (!sel) return;
  const cur = sel.value;
  let yf = 2018, yt = 2026;
  if (level === "canada" || level === "all") {
    yf = 2004; yt = 2026;
    if (caManifest && caManifest.length) {
      const yrs = caManifest.flatMap((s) =>
        [Number(String(s.from).slice(0, 4)), Number(String(s.to).slice(0, 4))]);
      yf = Math.min(...yrs); yt = Math.max(...yrs);
    }
  }
  const vals = [];
  for (let y = yt; y >= yf; y--) vals.push([String(y), String(y)]);
  fillSelect(sel, vals, "All years");
  if (cur && vals.some(([v]) => v === cur)) sel.value = cur;
}
/* The level chips: pressed state, per-level filter visibility, the
   ?level= URL param, and lazy layer loads. Leaving Toronto clears
   the Toronto-only controls — a hidden filter must never keep
   filtering in silence. */
function setLevel(next) {
  level = LEVELS.includes(next) ? next : "all";
  document.querySelectorAll(".lchip").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.level === level)));
  const torontoControls = level === "toronto";
  $("cell-body").hidden = !torontoControls;
  $("cell-status").hidden = !torontoControls;
  $("cell-ward").hidden = !torontoControls;
  $("cell-vote").hidden = !torontoControls;
  $("note-vote").hidden = !torontoControls;
  $("cell-on-outcome").hidden = level !== "ontario";
  $("cell-ca-result").hidden = level !== "canada";
  if (!torontoControls) {
    $("f-body").value = "";
    $("f-status").value = "";
    $("f-ward").value = "";
    $("f-vote").checked = false;
    if (profileFilter) { profileFilter = null; renderProfileState(); }
    const mw = $("myward-row");
    if (mw) mw.hidden = true;
    const prow = $("profile-row");
    if (prow && !prow.hidden) {
      prow.hidden = true;
      prow.dataset.levelHidden = "1";
    }
  } else {
    const prow = $("profile-row");
    if (prow && prow.dataset.levelHidden) {
      prow.hidden = false;
      delete prow.dataset.levelHidden;
    }
  }
  fillYearOptions();
  const url = new URL(location.href);
  if (level === "all") url.searchParams.delete("level");
  else url.searchParams.set("level", level);
  history.replaceState(null, "", url);
  if (level === "ontario" || level === "all") ensureOntario();
  if (level === "canada" || level === "all") ensureCanada();
  applyFilters();
}
function fillSelect(el, values, allLabel) {
  el.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("");
}
/* F-5 (Oct 21): body/outcome options are derived from the full
   archive, which streams in per year — until it lands, the selects
   say so and stay disabled instead of posing as empty filters.
   fillBodyStatus() fills and re-enables them. */
function fillLoadingSelect(el) {
  el.innerHTML = `<option value="">Loading…</option>`;
  el.disabled = true;
}
function parseCurrentQuery() {
  const q = $("q").value;
  parsed = q.trim()
    ? parseAsk(q, { members: councillors, storedWard: (typeof demeProfileWard === "function" ? demeProfileWard() : null) })
    : null;
}
/* D1: the search index arrives per year. 2026 + 2025 land first
   (~0.41 MB gzip, a ~79% cut in the old blocking payload) and the
   page works; the older years stream in behind it. (Polish wave,
   Oct 22, 2026: the stream no longer re-runs the full render per
   shard — see streamRest.) The body/outcome selects are derived from
   the full archive, so they fill when the stream completes — a
   selection made mid-stream is preserved across the refill. */
const SEARCH_YEARS = ["2026", "2025", "2024", "2023", "2022", "2021",
  "2020", "2019", "2018"];
function fillBodyStatus() {
  const bodySel = $("f-body"), statusSel = $("f-status");
  const bodyVal = bodySel.value, statusVal = statusSel.value;
  const bodyCounts = new Map();
  rows.forEach((r) => bodyCounts.set(r.body, (bodyCounts.get(r.body) || 0) + 1));
  const bodies = [...bodyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  fillSelect(bodySel, bodies.map(([b, n]) => [b, `${b} (${fmtNum(n)})`]), "All bodies");
  const statuses = [...new Set(rows.map((r) => r.status))].sort();
  fillSelect(statusSel,
    statuses.map((s) => [s, STATUS_LABELS[s] || s]), "All outcomes");
  bodySel.disabled = false;
  statusSel.disabled = false;
  if (bodyVal) bodySel.value = bodyVal;
  if (statusVal) statusSel.value = statusVal;
}
async function streamRest() {
  for (const y of SEARCH_YEARS.slice(2)) {
    try {
      const part = await loadJSON(dataPath(`search-${y}.json`));
      rows = rows.concat(part);
    } catch (e) { /* a missing year simply never joins the archive */ }
    /* Polish wave (Oct 22, 2026): this loop used to re-run the full
       filter + sort + card render on EVERY shard — seven extra full
       passes over a growing archive, the "clunky" load the owner
       flagged. Until the visitor engages, the visible first page
       cannot change (older years stream in behind it), so only the
       count line updates — watch it climb. An engaged visitor keeps
       the live re-filter, with their place in the list preserved. */
    if (userEngaged) applyFilters({ keepShown: true });
    else refreshCountOnly();
  }
  archiveLoading = false;
  fillBodyStatus();
  applyFilters();
}
async function init() {
  councillors = await loadJSON(dataPath("councillors.json"));
  archiveLoading = true;
  const first = await Promise.all(SEARCH_YEARS.slice(0, 2).map((y) =>
    loadJSON(dataPath(`search-${y}.json`)).catch(() => [])));
  rows = first.flat();
  fillLoadingSelect($("f-body"));
  fillLoadingSelect($("f-status"));
  fillSelect($("f-ward"),
    Array.from({ length: 25 }, (_, i) => {
      const n = i + 1;
      const c = councillors.find((x) => x.current && !x.mayor && x.ward === n);
      return [String(n), c ? `Ward ${n} — ${c.wardName}` : `Ward ${n}`];
    }),
    "All wards");

  const params = new URLSearchParams(location.search);
  if (params.get("q")) $("q").value = params.get("q");
  if (params.get("vote") === "1" && (!params.get("level") || params.get("level") === "toronto")) $("f-vote").checked = true;
  parseCurrentQuery();
  /* Level chips (search-federation wave): the initial level comes
     from ?level= (the doors and other pages link with it); the year
     param is applied after setLevel fills the level's year options,
     so a federal deep link can carry a 2004–2017 year. */
  document.querySelectorAll(".lchip").forEach((b) =>
    b.addEventListener("click", () => { userEngaged = true; setLevel(b.dataset.level); }));
  setLevel(params.get("level") || "all");
  if (params.get("year")) { $("f-year").value = params.get("year"); applyFilters(); }
  $("f-on-outcome").addEventListener("change", () => { userEngaged = true; applyFilters(); });
  $("f-ca-result").addEventListener("change", () => { userEngaged = true; applyFilters(); });

  let debounce;
  $("q").addEventListener("input", () => {
    userEngaged = true;
    clearTimeout(debounce);
    debounce = setTimeout(() => { parseCurrentQuery(); applyFilters(); }, 220);
  });
  /* Manual control changes clear the conflicting parsed pieces. */
  $("f-year").addEventListener("change", () => {
    userEngaged = true;
    if (parsed) { parsed.yearFrom = null; parsed.yearTo = null; parsed.ref = null; }
    applyFilters();
  });
  $("f-status").addEventListener("change", () => {
    userEngaged = true;
    if (parsed) parsed.statusGroup = null;
    applyFilters();
  });
  $("f-ward").addEventListener("change", () => {
    userEngaged = true;
    if (profileFilter) { profileFilter = null; renderProfileState(); }
    if (parsed) parsed.ward = null;
    applyFilters();
  });
  $("f-vote").addEventListener("change", () => {
    userEngaged = true;
    if (parsed) { parsed.voteOnly = false; parsed.closeOnly = false; }
    applyFilters();
  });
  $("f-body").addEventListener("change", () => { userEngaged = true; applyFilters(); });
  /* Mobile only: the filter panel starts collapsed behind the Filters
     toggle, so the first result is not pushed a full screen down.
     Desktop is untouched — the button stays hidden, the panel shows. */
  const filtersIn = $("filters-in"), filtersToggle = $("filters-toggle");
  if (filtersIn && filtersToggle) {
    const mq = window.matchMedia("(max-width: 700px)");
    const applyMq = () => {
      if (mq.matches) { filtersToggle.hidden = false; }
      else { filtersIn.hidden = false; filtersToggle.hidden = true; filtersToggle.setAttribute("aria-expanded", "true"); }
    };
    if (mq.matches) { filtersIn.hidden = true; filtersToggle.setAttribute("aria-expanded", "false"); }
    applyMq();
    filtersToggle.addEventListener("click", () => {
      const open = filtersIn.hidden;
      filtersIn.hidden = !open;
      filtersToggle.setAttribute("aria-expanded", String(open));
    });
    if (mq.addEventListener) mq.addEventListener("change", applyMq);
    syncFiltersToggle();
  }
  const myward = $("myward");
  if (myward) myward.addEventListener("click", () => {
    userEngaged = true;
    const w = (typeof demeProfileWard === "function") ? demeProfileWard() : null;
    if (w == null) return;
    if (parsed) parsed.ward = null;
    $("f-ward").value = String(w);
    applyFilters();
  });
  const useProfile = $("use-profile");
  if (useProfile) useProfile.addEventListener("click", async () => {
    userEngaged = true;
    if (typeof demeSignedOut === "function" && demeSignedOut()) return;
    const ward = VoteStore.getWard(), watchWard = VoteStore.getWatchWard();
    const ints = VoteStore.getInterests();
    /* The profile replaces the ward control while it is active: reset
       the select to All wards so applyFilters unions the profile
       (wards ∪ interests) instead of ANDing it with a single ward,
       and clear any parsed ward piece, like the other controls. */
    if (parsed) parsed.ward = null;
    $("f-ward").value = "";
    profileFilter = { wards: [ward, watchWard].filter(Boolean), interestRefs: null };
    if (ints.length) {
      try {
        const td = await loadJSON(dataPath("threads.json"));
        const refs = new Set();
        (td.threads || []).filter((t) => ints.includes(t.id))
          .forEach((t) => Object.values(t.years || {})
            .forEach((ys) => ys.forEach((r) => refs.add(r))));
        profileFilter.interestRefs = refs;
      } catch (e) { /* the ward part of the filter still applies */ }
    }
    if (!profileFilter.wards.length && !profileFilter.interestRefs) {
      profileFilter = null;
    }
    renderProfileState();
    applyFilters();
  });
  const clearProfile = $("clear-profile");
  if (clearProfile) clearProfile.addEventListener("click", () => {
    profileFilter = null;
    renderProfileState();
    applyFilters();
  });
  const dismissProfile = $("dismiss-profile");
  if (dismissProfile) dismissProfile.addEventListener("click", () => {
    const row = $("profile-row");
    if (row) row.hidden = true;
    try { sessionStorage.setItem("deme.explore.profileDismissed", "1"); }
    catch (e) { /* the row is hidden for this page either way */ }
  });
  await setupProfileRow(params);
  $("searchform").addEventListener("submit", (e) => {
    e.preventDefault(); parseCurrentQuery(); applyFilters();
  });
  applyFilters();
  streamRest();
}
init().catch(() => {
  $("count").textContent = "The archive could not be loaded. Please reload the page.";
});
