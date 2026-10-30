/* Legislature layer directory (Ontario / Canada expansion, Oct 27, 2026).
   Mirrors the Toronto representatives directory: a finder, a grid of
   current-member cards carrying the four summary stats, and an
   "earlier members" list. The page declares its layer through
   window.DEME_LAYER_PAGE = { layer, dataDir, profilePage, idParam,
   roleLine(person), tenure(person), interestsStat(person) }.
   Facts only: no grades, no rankings. */
"use strict";
const LCFG = window.DEME_LAYER_PAGE;
renderChrome(LCFG.directoryPage);

let layerAll = [];
let layerFilter = "";
let layerSort = "riding";

function layerAvatar(person, size = "") {
  const img = person.photo && LCFG.photoDir
    ? `<img src="${LCFG.photoDir}${encodeURIComponent(person.id || person.slug)}.webp"
        alt="" loading="lazy" decoding="async" onerror="demeAvatarError(this)">`
    : "";
  return `<span class="avatar ${size}" aria-hidden="true"><span>${esc(initialsOf(person.name))}</span>${img}</span>`;
}

function layerTenure(p) {
  if (p.firstYear == null) return "—";
  if (p.current) {
    return LCFG.tenureCurrent ? LCFG.tenureCurrent(p)
      : `Since ${p.firstYear}`;
  }
  return p.lastYear && p.lastYear !== p.firstYear
    ? `${p.firstYear}–${p.lastYear}` : `${p.firstYear}`;
}

function layerStatsHTML(p) {
  /* Participation is carried by the C7 card module, not the stats
     grid (v62) — the grid keeps votes cast, tenure, interests. */
  return `<div class="member-stats" aria-label="Record summary">
    <div><span>Votes cast</span><strong>${fmtNum(p.votesCast)}</strong></div>
    <div><span>${simpleT("Tenure", "How long they have served")}</span><strong>${esc(layerTenure(p))}</strong></div>
    <div><span>${esc(LCFG.interestsLabel)}</span><strong>${fmtNum(LCFG.interestsValue(p))}</strong></div>
  </div>`;
}

function layerCard(p) {
  /* Card redesign (Oct 30, 2026): party as a pill, ONE hero
     participation figure with count + span, one slim bar, and a
     quiet two-item footer (tenure + documents on file). The stats
     grid remains only as the fallback when the participation file
     has no entry for this member. No figure changes. */
  const entry = layerPart ? layerPart.members[p.id || p.slug] : null;
  const docN = LCFG.interestsValue(p);
  const docItem = docN == null ? ""
    : `<b>${fmtNum(docN)}</b> ${LCFG.layer === "canada"
      ? (docN === 1 ? "ethics registry document" : "ethics registry documents")
      : (docN === 1 ? "disclosure statement" : "disclosure statements")}`;
  const record = entry
    ? `${participationCardModule(entry,
        { layer: LCFG.layer, current: !!p.current, incoming: false,
          currentLabel: partCurrentLabel(layerPart, LCFG.layer) })}
       ${repCardFooterHTML([esc(layerTenure(p)), docItem])}`
    : layerStatsHTML(p);
  return `<article class="person">
    <div class="person-top">${layerAvatar(p)}
      <div>
        <h3><a href="${LCFG.profilePage}?${LCFG.idParam}=${encodeURIComponent(p.id || p.slug)}">${esc(p.name)}</a></h3>
        <p class="ward">${esc(LCFG.roleLine(p))}</p>
        ${p.party ? `<span class="party-pill">${esc(p.party)}</span>` : ""}
      </div>
    </div>
    ${record}
  </article>`;
}

function layerEarlierRow(p) {
  const terms = LCFG.earlierTerms ? LCFG.earlierTerms(p)
    : LCFG.roleNoun ? `${LCFG.roleNoun} · ${layerTenure(p)}`
    : layerTenure(p);
  return `<li>${layerAvatar(p)}
    <div class="em-main">
      <p class="em-name"><a href="${LCFG.profilePage}?${LCFG.idParam}=${encodeURIComponent(p.id || p.slug)}">${esc(p.name)}</a></p>
      <p class="em-terms">${esc(terms)}</p>
      <p class="em-wards"><span>${esc(p.riding || "")}${p.party ? ` · ${esc(p.party)}` : ""}</span></p>
      <div class="em-stats">
        <div><span>Votes cast</span><strong>${fmtNum(p.votesCast)}</strong></div>
        <div><span>${esc(LCFG.interestsLabel)}</span><strong>${fmtNum(LCFG.interestsValue(p))}</strong></div>
      </div>
      ${participationCardModule(layerPart ? layerPart.members[p.id || p.slug] : null,
        { layer: LCFG.layer, current: false, incoming: false,
          currentLabel: partCurrentLabel(layerPart, LCFG.layer) })}
    </div>
  </li>`;
}

/* Accent and punctuation folding (audit F-04, Oct 30, 2026): the
   same normalisation the cross-layer people search applies
   (people-search.js, DemePeople.psNorm), ported into this filter —
   a name typed without its accents ("gelinas" for Gélinas) still
   finds the member, and a name typed without its punctuation
   ("dentremont") meets the squashed name. Folding only widens the
   match: any query that matched before still matches. */
const layerFoldText = (s) => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const layerSquashText = (s) => layerFoldText(s).replace(/[^a-z0-9]+/g, "");
function layerMatches(p, q) {
  if (!q) return true;
  const hay = layerFoldText(`${p.name} ${p.riding || ""} ${p.party || ""} ${p.province || ""}`);
  const nameSq = layerSquashText(p.name);
  return q.split(/\s+/).filter(Boolean).every((w) => {
    if (hay.includes(layerFoldText(w))) return true;
    const ws = layerSquashText(w);
    return Boolean(ws) && nameSq.includes(ws);
  });
}

function renderLayerDirectory() {
  const current = layerAll.filter((p) => p.current);
  const earlier = layerAll.filter((p) => !p.current);
  const sortFn = layerSort === "name"
    ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => (a.riding || "").localeCompare(b.riding || "")
        || a.name.localeCompare(b.name);
  const shownCurrent = current.filter((p) => layerMatches(p, layerFilter))
    .sort(sortFn);
  document.getElementById("current").innerHTML = shownCurrent.length
    ? shownCurrent.map(layerCard).join("")
    : `<p class="small">No current members match that search.</p>`;
  const result = document.getElementById("finder-result");
  if (result) {
    result.textContent = layerFilter
      ? `${shownCurrent.length} of ${current.length} current members match.`
      : "";
  }
  const eq = document.getElementById("eq");
  const eqVal = eq ? eq.value : "";
  /* Earlier members sort MOST RECENT FIRST (Amendment 3, Oct 28,
     2026): by the last year of each member's service (lastYear,
     falling back to firstYear), name A–Z as the tiebreak. */
  const shownEarlier = earlier.filter((p) => layerMatches(p, eqVal))
    .sort((a, b) => ((b.lastYear ?? b.firstYear ?? 0) - (a.lastYear ?? a.firstYear ?? 0))
      || a.name.localeCompare(b.name));
  document.getElementById("earlier").innerHTML = shownEarlier.length
    ? shownEarlier.map(layerEarlierRow).join("")
    : `<p class="small">No earlier members match that search.</p>`;
  const countEl = document.getElementById("earlier-count");
  if (countEl) countEl.textContent = earlier.length;
  const noteEl = document.getElementById("earlier-count-note");
  if (noteEl) noteEl.textContent = `(${earlier.length} members)`;
}

/* v58: career participation data (verified exporter output); if it
   fails to load the directory renders exactly as before. */
let layerPart = null;
async function initLayerDirectory() {
  try {
    layerAll = await loadJSON(`${LCFG.dataDir}members.json`);
  } catch (e) {
    document.getElementById("current").innerHTML =
      `<p class="small">The directory could not be loaded. Please try again.</p>`;
    return;
  }
  layerPart = await loadJSON(`${LCFG.dataDir}participation.json`).catch(() => null);
  renderLayerDirectory();
  const q = document.getElementById("q");
  if (q) q.addEventListener("input", () => {
    layerFilter = q.value.trim();
    renderLayerDirectory();
  });
  const eq = document.getElementById("eq");
  if (eq) eq.addEventListener("input", renderLayerDirectory);
  const sort = document.getElementById("dir-sort");
  if (sort) sort.addEventListener("change", () => {
    layerSort = sort.value;
    renderLayerDirectory();
  });
}
initLayerDirectory();
