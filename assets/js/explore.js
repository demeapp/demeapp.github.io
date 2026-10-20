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
};
const PAGE = 25;
let rows = [], councillors = [], filtered = [], shown = 0;
let parsed = null; // parseAsk result for the current query text, or null
let profileFilter = null; // "Use my profile" filter, or null when off
let profileSummaryBase = ""; // profile-row summary without " — filter on"
const briefCache = new Map(); // ref -> card (filled from year shards)
const $ = (id) => document.getElementById(id);

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
  const storedWard = (typeof VoteStore !== "undefined") ? VoteStore.getWard() : null;

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

function applyFilters() {
  const eff = effectiveFilters();
  /* A profile filter with no wards and no interest refs is treated as
     off — the predicate below is a no-op whenever profileFilter is off. */
  const profileActive = Boolean(profileFilter
    && (profileFilter.wards.length || profileFilter.interestRefs));
  filtered = rows.filter((r) =>
    matches(r, eff.freeTokens) &&
    askRowMatchesTopics(r, eff.topicGroups) &&
    (eff.yearFrom == null || (Number(r.year) >= eff.yearFrom && Number(r.year) <= eff.yearTo)) &&
    (!eff.body || r.body === eff.body) &&
    (!eff.statusCodes || eff.statusCodes.includes(r.status)) &&
    (eff.wardNum == null || (r.w && r.w.includes(eff.wardNum))) &&
    (!eff.voteOnly || r.hv === 1) &&
    (!eff.closeOnly || (r.hv === 1 && r.mg != null && r.mg <= 2)) &&
    (!profileActive
      || (r.w && r.w.some((w) => profileFilter.wards.includes(w)))
      || (profileFilter.interestRefs && profileFilter.interestRefs.has(r.ref))));
  filtered.sort((a, b) => (a.date < b.date ? 1 : -1));
  shown = 0;
  $("results").innerHTML = "";
  memberHit(eff);
  renderInterpretation(eff);
  renderMyWardChip(eff);
  renderMore();
}

function memberHit(eff) {
  const box = $("memberhit");
  if (eff.member) {
    box.innerHTML = `<div class="notice">Looking for the person? See
       <a href="councillor.html?m=${encodeURIComponent(eff.member.slug)}">
       ${esc(eff.member.name)}'s voting record →</a></div>`;
    return;
  }
  /* Base behaviour, unchanged: a bare name in the search box. */
  const qTokens = tokens($("q").value);
  if (!qTokens.length) { box.innerHTML = ""; return; }
  const q = qTokens.join(" ");
  const hit = councillors.find((c) => c.name.toLowerCase().includes(q));
  box.innerHTML = hit
    ? `<div class="notice">Looking for the person? See
       <a href="councillor.html?m=${encodeURIComponent(hit.slug)}">
       ${esc(hit.name)}'s voting record →</a></div>`
    : "";
}

function renderInterpretation(eff) {
  const box = $("interpretation");
  if (!box) return;
  const raw = $("q").value.trim();
  const parsedActive = Boolean(parsed && (parsed.member || parsed.statusGroup
    || parsed.voteOnly || parsed.closeOnly || parsed.yearFrom != null
    || parsed.ward != null || parsed.topicTokens.length));
  if (parsed && !parsedActive) {
    /* Nothing was recognized. If the raw text looks like a question,
       say so plainly and let the plain search stand on its own. */
    const lower = raw.toLowerCase();
    const looksQuestion = /^(how|what|when|did|who|which)\b/.test(lower) || lower.endsWith("?");
    if (raw && looksQuestion) {
      box.hidden = false;
      box.innerHTML = `<span>I couldn't break that question down — here are
        the plain results for “${esc(raw)}”.</span>`;
    } else {
      box.hidden = true; box.innerHTML = "";
    }
    return;
  }
  if (!parsedActive) { box.hidden = true; box.innerHTML = ""; return; }

  const parts = [];
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
  if (eff.closeOnly) parts.push("close recorded votes (margin of two or fewer)");
  else if (eff.voteOnly) parts.push("with a recorded vote");
  if (eff.statusLabel && parsed && parsed.statusGroup) {
    parts.push(`Outcome: ${esc(eff.statusLabel)}`);
  }
  if (eff.member) {
    parts.push(`${esc(eff.member.name)}'s own votes are on their record page — open any result to see exactly how every member voted.`);
  }
  box.hidden = false;
  box.innerHTML = `<span>${parts.join(" · ")} — set by your question.
    Change anything with the filters, or </span>
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

/* "Your Deme" profile offer: shown only with a stored profile, no
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
  if (params.has("q") || params.has("year") || params.has("vote")) return;
  if (profileDismissed()) return;
  const labels = {};
  try {
    const d = await loadJSON(dataPath("threads-summary.json"));
    (d.threads || []).forEach((t) => { labels[t.id] = t.label; });
  } catch (e) { /* labels fall back to the thread ids themselves */ }
  const ward = VoteStore.getWard(), watchWard = VoteStore.getWatchWard();
  const ints = VoteStore.getInterests();
  let summary = "Your Deme profile:";
  if (ward != null) summary += ` Ward ${ward}`;
  if (watchWard != null) summary += (ward != null ? " + Ward " : " Ward ") + watchWard;
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
async function renderMore() {
  /* The pager rewrite below destroys the focused button — remember
     whether it held focus so its replacement can take it back. */
  const wasFocused = document.activeElement
    && document.activeElement.id === "more";
  const slice = filtered.slice(shown, shown + PAGE);
  shown += slice.length;
  await hydrate(slice);
  const html = slice.map((r) => {
    const full = briefCache.get(r.ref);
    if (full) return decisionCard(full);
    /* Shard unavailable: never guess at a title — show the item itself. */
    return `<article class="card">
      <div class="meta"><span>${esc(fmtDate(r.date))}</span>
        <span>${esc(r.body)}</span>
        <span class="pill">${esc(STATUS_LABELS[r.status] || "Decided")}</span></div>
      <h3><a href="decision.html?ref=${encodeURIComponent(r.ref)}">Item ${esc(r.ref)}</a></h3>
      <p class="more"><a href="decision.html?ref=${encodeURIComponent(r.ref)}">Details →</a></p>
    </article>`;
  }).join("");
  $("results").insertAdjacentHTML("beforeend", html);
  $("count").textContent = filtered.length
    ? `${fmtNum(filtered.length)} decision${filtered.length === 1 ? "" : "s"} found`
    : "No decisions match. Try fewer words, or clear a filter.";
  $("pager").innerHTML = shown < filtered.length
    ? `<button class="btn secondary" id="more">Show more (${fmtNum(filtered.length - shown)} remaining)</button>`
    : "";
  const more = $("more");
  if (more) {
    more.addEventListener("click", renderMore);
    if (wasFocused) more.focus();
  } else if (wasFocused) {
    $("pager").setAttribute("tabindex", "-1");
    $("pager").focus();
  }
}

function fillSelect(el, values, allLabel) {
  el.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("");
}
function parseCurrentQuery() {
  const q = $("q").value;
  parsed = q.trim()
    ? parseAsk(q, { members: councillors, storedWard: VoteStore.getWard() })
    : null;
}
async function init() {
  const [search, people] = await Promise.all([
    loadJSON(dataPath("search.json")), loadJSON(dataPath("councillors.json")),
  ]);
  rows = search; councillors = people;
  const years = [...new Set(rows.map((r) => r.year))].sort().reverse();
  fillSelect($("f-year"), years.map((y) => [y, y]), "All years");
  const bodyCounts = new Map();
  rows.forEach((r) => bodyCounts.set(r.body, (bodyCounts.get(r.body) || 0) + 1));
  const bodies = [...bodyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  fillSelect($("f-body"), bodies.map(([b, n]) => [b, `${b} (${fmtNum(n)})`]), "All bodies");
  const statuses = [...new Set(rows.map((r) => r.status))].sort();
  fillSelect($("f-status"),
    statuses.map((s) => [s, STATUS_LABELS[s] || s]), "All outcomes");
  fillSelect($("f-ward"),
    Array.from({ length: 25 }, (_, i) => {
      const n = i + 1;
      const c = councillors.find((x) => x.current && !x.mayor && x.ward === n);
      return [String(n), c ? `Ward ${n} — ${c.wardName}` : `Ward ${n}`];
    }),
    "All wards");

  const params = new URLSearchParams(location.search);
  if (params.get("q")) $("q").value = params.get("q");
  if (params.get("year")) $("f-year").value = params.get("year");
  if (params.get("vote") === "1") $("f-vote").checked = true;
  parseCurrentQuery();

  let debounce;
  $("q").addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { parseCurrentQuery(); applyFilters(); }, 220);
  });
  /* Manual control changes clear the conflicting parsed pieces. */
  $("f-year").addEventListener("change", () => {
    if (parsed) { parsed.yearFrom = null; parsed.yearTo = null; }
    applyFilters();
  });
  $("f-status").addEventListener("change", () => {
    if (parsed) parsed.statusGroup = null;
    applyFilters();
  });
  $("f-ward").addEventListener("change", () => {
    if (profileFilter) { profileFilter = null; renderProfileState(); }
    if (parsed) parsed.ward = null;
    applyFilters();
  });
  $("f-vote").addEventListener("change", () => {
    if (parsed) { parsed.voteOnly = false; parsed.closeOnly = false; }
    applyFilters();
  });
  $("f-body").addEventListener("change", applyFilters);
  const myward = $("myward");
  if (myward) myward.addEventListener("click", () => {
    const w = VoteStore.getWard();
    if (w == null) return;
    if (parsed) parsed.ward = null;
    $("f-ward").value = String(w);
    applyFilters();
  });
  const useProfile = $("use-profile");
  if (useProfile) useProfile.addEventListener("click", async () => {
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
}
init().catch(() => {
  $("count").textContent = "The archive could not be loaded. Please reload the page.";
});
