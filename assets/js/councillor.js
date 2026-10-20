/* Councillor profile — the simple picture first (who, ward, term, one
   attendance stat), recent votes as a short list, full history paginated
   below. Facts only: no grades, no comparisons. */
"use strict";
renderChrome("councillors.html");

const params = new URLSearchParams(location.search);
const box = document.getElementById("profile");
const PAGE = 25;
const SLICE = 100;
let memberRows = [], shown = 0;
let memberTotal = 0, memberSlug = null, restLoaded = false, restLoading = null;

/* The member file now ships only the first SLICE rows (Wave 2); the
   remainder lives in member/<slug>.more.json and is fetched only when
   the visitor pages close to the end of the slice. Row order and the
   published totals are unchanged. */
async function ensureRest() {
  if (restLoaded || !memberSlug) return;
  if (!restLoading) {
    restLoading = loadJSON(dataPath(`member/${memberSlug}.more.json`))
      .then((d) => { memberRows = memberRows.concat(d.rows || []); })
      .catch(() => { memberTotal = memberRows.length; })
      .then(() => { restLoaded = true; });
  }
  await restLoading;
}

function voteChip(v) {
  if (v === "Yes") return `<span class="voteYes">Yes</span>`;
  if (v === "No") return `<span class="voteNo">No</span>`;
  if (v && v.startsWith("Absent(Interest"))
    return `<span class="voteAbs">Declared an interest</span>`;
  return `<span class="voteAbs">Absent</span>`;
}
function rowHTML(r) {
  return `<li><span><a href="decision.html?ref=${encodeURIComponent(r.ref)}">${esc(r.title || r.ref)}</a>
    <span class="terms"> · ${esc(fmtDate(r.date))}${r.motion ? ` · ${esc(r.motion)}` : ""}${r.result ? ` · ${esc(r.result)}` : ""}${r.stage && r.stage !== "City Council" ? ` · at ${esc(r.stage)}` : ""}</span></span>
    <span>${voteChip(r.vote)}</span></li>`;
}
async function renderMore() {
  /* Fetch the remainder before the visitor runs out of sliced rows. */
  if (!restLoaded && memberTotal > memberRows.length
      && shown + PAGE > memberRows.length - PAGE) {
    await ensureRest();
  }
  /* The pager rewrite below destroys the focused button — remember
     whether it held focus so the new one can take it back. */
  const wasFocused = document.activeElement
    && document.activeElement.id === "more";
  const slice = memberRows.slice(shown, shown + PAGE);
  shown += slice.length;
  document.getElementById("history").insertAdjacentHTML(
    "beforeend", slice.map(rowHTML).join(""));
  const pager = document.getElementById("pager");
  pager.innerHTML = shown < memberTotal
    ? `<button class="btn secondary" id="more">Show more (${fmtNum(memberTotal - shown)} remaining)</button>`
    : "";
  const b = document.getElementById("more");
  if (b) {
    b.addEventListener("click", renderMore);
    if (wasFocused) b.focus();
  } else if (wasFocused) {
    pager.setAttribute("tabindex", "-1");
    pager.focus();
  }
}

async function init() {
  const people = await loadJSON(dataPath("councillors.json"));
  let person = null;
  if (params.get("m")) person = people.find((p) => p.slug === params.get("m"));
  if (!person && params.get("name")) {
    person = people.find((p) => p.name === params.get("name"));
  }
  if (!person) {
    box.innerHTML = `<div class="calm"><h3>Member not found.</h3>
      <p>See the <a href="councillors.html">full list of members</a>.</p></div>`;
    return;
  }
  document.title = `${person.name} — Toronto City Council record | Deme`;
  const role = person.current
    ? (person.mayor ? "Mayor of Toronto"
       : `Councillor · Ward ${person.ward} — ${esc(person.wardName)}`)
    : "Former member of Toronto City Council";
  box.innerHTML = `
    <p class="kicker">${person.current ? "Council today" : "Earlier member"}</p>
    <h1>${esc(person.name)}</h1>
    <p class="lede" style="margin-bottom:.3rem">${role}</p>
    <p class="small">Term${person.terms.length > 1 ? "s" : ""} in the record:
      ${person.terms.map(esc).join(" · ")}</p>
    <div class="statTiles">
      <div class="stat"><span class="num">${person.attendance == null ? "—" : person.attendance + "%"}</span>
        <span class="lab">Attendance — present and voting, out of all
        recorded votes in their record</span></div>
      <div class="stat"><span class="num">${fmtNum(person.votesCast)}</span>
        <span class="lab">Votes cast (yes or no) across their record</span></div>
      <div class="stat"><span class="num">${fmtNum(person.interest)}</span>
        <span class="lab">Times they declared a personal interest and did
        not vote — a duty, not an absence</span></div>
    </div>
    <p class="small" style="max-width:44rem">Attendance counts only recorded
    votes — the name-by-name kind. When a member declares an interest in an
    item, stepping back is required, so those are never counted against
    attendance here.</p>
    <h2 style="margin-top:2.6rem">Recorded votes</h2>
    <hr class="rule">
    <div id="historyWrap"><p class="small">Loading…</p></div>`;

  const wrap = document.getElementById("historyWrap");
  try {
    const data = await loadJSON(dataPath(`member/${person.slug}.json`));
    memberRows = data.rows || [];
    memberTotal = data.total != null ? data.total : memberRows.length;
    memberSlug = person.slug;
    restLoaded = memberTotal <= memberRows.length;
    if (!memberRows.length) {
      wrap.innerHTML = `<div class="notice">This member's recorded votes
        predate the searchable decision archive, which begins in 2018.
        Their votes are counted in the totals above; the item-by-item
        record starts with the 2018 term.</div>`;
      return;
    }
    wrap.innerHTML = `<p class="small">${fmtNum(memberTotal)} recorded
      votes on decisions in the archive, newest first. Every row links to
      the decision itself.</p>
      <ul class="personlist" id="history"></ul><div class="pager" id="pager"></div>`;
    renderMore();
  } catch (e) {
    wrap.innerHTML = `<p class="small">The voting record could not be loaded.</p>`;
  }
}
init().catch(() => {
  box.innerHTML = `<p class="small">The record could not be loaded. Please reload.</p>`;
});
