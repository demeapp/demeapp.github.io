/* Compare Councillors — restored from the earlier build. Two members'
   recorded votes, joined on motion: agreement share plus the list of
   decisions where they took different positions. Yes/No votes only;
   absences and declared interests never count either way. */
"use strict";
renderChrome("councillors.html");

const selA = document.getElementById("compare-a");
const selB = document.getElementById("compare-b");
const out = document.getElementById("compare-out");
const fileCache = new Map();
let people = [];
let splitsShown = 0;
let splitRows = [];
let pair = [null, null];
const SPLIT_PAGE = 25;

async function memberFile(slug) {
  if (fileCache.has(slug)) return fileCache.get(slug);
  let rows = [];
  try {
    const d = await loadJSON(dataPath(`member/${slug}.json`));
    rows = (d && d.rows) || [];
    const total = d && d.total != null ? d.total : rows.length;
    if (total > rows.length) {
      try {
        const more = await loadJSON(dataPath(`member/${slug}.more.json`));
        rows = rows.concat((more && more.rows) || []);
      } catch (e) { /* compare on the slice we have */ }
    }
  } catch (e) { rows = []; }
  fileCache.set(slug, rows);
  return rows;
}

function voteMap(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (r.vote !== "Yes" && r.vote !== "No") return;
    map.set(`${r.ref}|${r.motion || ""}`, { vote: r.vote, row: r });
  });
  return map;
}

function personSummary(p, shared) {
  const role = p.mayor ? "Mayor of Toronto"
    : p.current ? `Councillor · Ward ${p.ward} — ${esc(p.wardName)}`
    : "Former member of Toronto City Council";
  return `<div class="compare-person">${avatarHTML(p)}
    <div><h3><a href="councillor.html?m=${encodeURIComponent(p.slug)}">${esc(p.name)}</a></h3>
    <p>${esc(role)}</p>
    <p>${fmtNum(shared)} shared recorded votes in this comparison</p></div></div>`;
}

async function render() {
  const a = people.find((p) => p.slug === selA.value);
  const b = people.find((p) => p.slug === selB.value);
  if (!a || !b) {
    out.innerHTML = `<p class="small">Pick two members to see their shared record.</p>`;
    return;
  }
  if (a.slug === b.slug) {
    out.innerHTML = `<p class="small">Those are the same member — pick two different members to compare.</p>`;
    return;
  }
  out.innerHTML = `<p class="small">Lining up the shared record…</p>`;
  pair = [a, b];
  const [rowsA, rowsB] = await Promise.all([memberFile(a.slug), memberFile(b.slug)]);
  const mapA = voteMap(rowsA), mapB = voteMap(rowsB);
  let agreed = 0;
  splitRows = [];
  mapA.forEach((va, key) => {
    const vb = mapB.get(key);
    if (!vb) return;
    if (va.vote === vb.vote) agreed += 1;
    else splitRows.push({ a: va, b: vb });
  });
  const shared = agreed + splitRows.length;
  splitRows.sort((x, y) => (x.a.row.date < y.a.row.date ? 1 : -1));
  splitsShown = 0;
  const pct = shared ? Math.round(agreed / shared * 100) : null;
  out.innerHTML = `
    <div class="compare-summary">
      ${personSummary(a, shared)}
      <div class="compare-agree">
        <div><strong>${pct == null ? "—" : pct + "%"}</strong>
        <span>${shared
          ? `voted the same way on ${fmtNum(agreed)} of ${fmtNum(shared)} shared recorded votes`
          : "no shared recorded votes in the archive"}</span></div>
      </div>
      ${personSummary(b, shared)}
    </div>
    <h2>Different recorded positions</h2>
    <hr class="rule">
    <p class="small">${splitRows.length
      ? `${fmtNum(splitRows.length)} shared motions where they voted differently, newest first.`
      : "They took the same position on every shared recorded vote in the archive."}</p>
    <div id="split-list"></div>
    <div class="pager" id="split-pager"></div>`;
  renderSplits();
}

function renderSplits() {
  const list = document.getElementById("split-list");
  const pager = document.getElementById("split-pager");
  if (!list || !pager) return;
  const wasFocused = document.activeElement
    && document.activeElement.id === "split-more";
  const slice = splitRows.slice(splitsShown, splitsShown + SPLIT_PAGE);
  splitsShown += slice.length;
  list.insertAdjacentHTML("beforeend", slice.map(({ a, b }) => {
    const r = a.row;
    const meta = [fmtDate(r.date), r.motion,
      r.stage && r.stage !== "City Council" ? `at ${r.stage}` : ""]
      .filter(Boolean).join(" · ");
    return `<div class="split-row">
      <span><a href="decision.html?ref=${encodeURIComponent(r.ref)}">${esc(r.title || r.ref)}</a>
        <span class="s-meta">${esc(meta)}</span></span>
      <span class="s-votes">
        <span class="small">${esc(pair[0].name.split(" ").slice(-1)[0])}</span>${voteChipShared(a.vote)}
        <span class="small">${esc(pair[1].name.split(" ").slice(-1)[0])}</span>${voteChipShared(b.vote)}
      </span></div>`;
  }).join(""));
  pager.innerHTML = splitsShown < splitRows.length
    ? `<button class="btn secondary" id="split-more">Show more (${fmtNum(splitRows.length - splitsShown)} remaining)</button>`
    : "";
  const btn = document.getElementById("split-more");
  if (btn) {
    btn.addEventListener("click", renderSplits);
    if (wasFocused) btn.focus();
  } else if (wasFocused) {
    pager.setAttribute("tabindex", "-1");
    pager.focus();
  }
}
function voteChipShared(v) {
  return v === "Yes" ? `<span class="voteYes">Yes</span>` : `<span class="voteNo">No</span>`;
}

function fillSelect(sel, keepFirstLabel) {
  const cur = people.filter((p) => p.current);
  const old = people.filter((p) => !p.current);
  const opt = (p) => `<option value="${esc(p.slug)}">${esc(p.name)}${p.mayor ? " — Mayor" : p.current ? ` — Ward ${p.ward}` : ""}</option>`;
  sel.innerHTML = `<option value="">${keepFirstLabel}</option>
    <optgroup label="Council today">${cur.map(opt).join("")}</optgroup>
    <optgroup label="Earlier members">${old.map(opt).join("")}</optgroup>`;
}

loadJSON(dataPath("councillors.json")).then((rows) => {
  people = rows || [];
  fillSelect(selA, "Choose a member");
  fillSelect(selB, "Choose a second member");
  const mayor = people.find((p) => p.mayor);
  const params = new URLSearchParams(location.search);
  const qa = params.get("a"), qb = params.get("b");
  if (qa && people.some((p) => p.slug === qa)) selA.value = qa;
  else if (mayor) selA.value = mayor.slug;
  if (qb && people.some((p) => p.slug === qb)) selB.value = qb;
  selA.addEventListener("change", render);
  selB.addEventListener("change", render);
  render();
}).catch(() => {
  out.innerHTML = `<p class="small">The member list could not be loaded. Please reload.</p>`;
});
