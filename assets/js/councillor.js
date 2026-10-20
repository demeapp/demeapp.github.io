/* Councillor profile — the simple picture first (who, ward, term, one
   attendance stat), the restored dossier panels (about, committees,
   contact, campaign promises), the lobbying record, then the full
   recorded-vote history, filterable and paginated. Facts only: no
   grades, no rankings. */
"use strict";
renderChrome("councillors.html");

const params = new URLSearchParams(location.search);
const box = document.getElementById("profile");
const PAGE = 25;
const SLICE = 100;
let memberRows = [], shown = 0;
let memberTotal = 0, memberSlug = null, restLoaded = false, restLoading = null;
let outcomeFilter = "all";
let currentPerson = null;

/* The member file ships only the first SLICE rows (Wave 2); the
   remainder lives in member/<slug>.more.json and is fetched only when
   the visitor pages close to the end of the slice — or when an
   outcome filter is chosen, since a filter must see every row to
   stay honest. Row order and the published totals are unchanged. */
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
    return `<span class="voteInt">Declared an interest</span>`;
  return `<span class="voteAbs">Absent</span>`;
}
const FILTER_MATCH = {
  all: () => true,
  yes: (r) => r.vote === "Yes",
  no: (r) => r.vote === "No",
  absent: (r) => r.vote === "Absent",
  interest: (r) => r.vote && r.vote.startsWith("Absent(Interest"),
};
const FILTER_LABEL = {
  all: "All", yes: "Yes", no: "No",
  absent: "Absent", interest: "Interest declared",
};
function activeRows() {
  return outcomeFilter === "all"
    ? memberRows : memberRows.filter(FILTER_MATCH[outcomeFilter]);
}
function rowHTML(r) {
  const meta = [fmtDate(r.date), r.motion, r.result,
    r.stage && r.stage !== "City Council" ? `at ${r.stage}` : ""]
    .filter(Boolean).join(" · ");
  return `<li>
    <span class="h-title"><a href="decision.html?ref=${encodeURIComponent(r.ref)}">${esc(r.title || r.ref)}</a>
      <span class="h-meta">${esc(meta)}</span></span>
    <span class="h-badge">${voteChip(r.vote)}</span></li>`;
}
async function renderMore() {
  /* Fetch the remainder before the visitor runs out of sliced rows. */
  if (outcomeFilter === "all" && !restLoaded && memberTotal > memberRows.length
      && shown + PAGE > memberRows.length - PAGE) {
    await ensureRest();
  }
  /* The pager rewrite below destroys the focused button — remember
     whether it held focus so the new one can take it back. */
  const wasFocused = document.activeElement
    && document.activeElement.id === "more";
  const rows = activeRows();
  const total = outcomeFilter === "all" ? memberTotal : rows.length;
  const slice = rows.slice(shown, shown + PAGE);
  shown += slice.length;
  document.getElementById("history").insertAdjacentHTML(
    "beforeend", slice.map(rowHTML).join(""));
  const status = document.getElementById("hist-status");
  if (status) {
    status.textContent = outcomeFilter === "all"
      ? `${fmtNum(memberTotal)} recorded votes on decisions in the archive, newest first. Every row links to the decision itself.`
      : `${fmtNum(rows.length)} recorded votes marked ${FILTER_LABEL[outcomeFilter]} — out of ${fmtNum(memberTotal)} in this member’s record.`;
  }
  const pager = document.getElementById("pager");
  pager.innerHTML = shown < total
    ? `<button class="btn secondary" id="more">Show more (${fmtNum(total - shown)} remaining)</button>`
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
async function setFilter(f) {
  if (f === outcomeFilter) return;
  outcomeFilter = f;
  document.querySelectorAll(".fchip").forEach((c) =>
    c.setAttribute("aria-pressed", String(c.dataset.f === f)));
  if (f !== "all") await ensureRest();
  shown = 0;
  document.getElementById("history").innerHTML = "";
  renderMore();
}

/* ---------- restored dossier: about, committees, contact, promises --
   Carried from the earlier build's published member dossiers
   (data/profiles.json). Promises keep their campaign sources; a
   source link is shown only where it still resolves. Related votes
   are matched by topic keywords against this member's recorded
   votes, the earlier build's method. */
function promiseCategories(text) {
  const value = String(text || "").toLowerCase();
  const groups = [
    { promise: ["housing", "home", "rent", "tenant", "shelter", "homeless"], item: ["housing", "affordable housing", "rent", "tenant", "shelter", "homeless"] },
    { promise: ["transit", "ttc", "subway", "lrt", "bus", "streetcar"], item: ["transit", "ttc", "subway", "lrt", "bus", "streetcar"] },
    { promise: ["budget", "tax", "fiscal", "spending"], item: ["budget", "tax", "fiscal"] },
    { promise: ["road safety", "traffic safety", "vision zero", "pedestrian", "cycling", "bike"], item: ["road safety", "vision zero", "pedestrian", "cycling", "bike", "traffic"] },
    { promise: ["police", "gun violence", "crime", "public safety"], item: ["police", "gun", "violence", "crime", "public safety"] },
    { promise: ["park", "recreation", "community centre", "sports"], item: ["park", "recreation", "community centre", "sports"] },
    { promise: ["climate", "environment", "emission", "green"], item: ["climate", "environment", "emission", "green"] },
    { promise: ["youth", "children", "child care", "childcare", "school"], item: ["youth", "children", "child care", "childcare", "school"] },
    { promise: ["job", "employment", "business", "economic development"], item: ["job", "employment", "business", "economic development"] },
  ];
  return groups
    .filter((g) => g.promise.some((t) => value.indexOf(t) !== -1))
    .reduce((all, g) => all.concat(g.item), []);
}
function relatedVotes(promiseText) {
  const terms = [...new Set(promiseCategories(promiseText))];
  if (!terms.length) return [];
  const seen = new Set();
  const out = [];
  for (const r of memberRows) {
    const title = String(r.title || "").toLowerCase();
    if (!terms.some((t) => title.indexOf(t) !== -1)) continue;
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    out.push(r);
    if (out.length >= 3) break;
  }
  return out;
}
function shortBio(text) {
  const parts = String(text || "").match(/[^.!?]+[.!?]+/g) || [String(text || "")];
  return parts.slice(0, 3).join(" ").trim();
}
async function renderExtras(person) {
  const host = document.getElementById("profile-extra");
  if (!host) return;
  let profile = null, lobbying = null;
  try { profile = (await loadJSON(dataPath("profiles.json")))[person.slug] || null; }
  catch (e) { /* the record stands without the dossier */ }
  try { lobbying = (await loadJSON(dataPath("lobbying.json")))[person.slug] || null; }
  catch (e) { /* same */ }
  let html = "";
  if (profile) {
    if (profile.bio) {
      html += `<section style="margin-top:2.4rem" aria-labelledby="about-member">
        <h2 id="about-member">About ${esc(person.name)}</h2><hr class="rule">
        <p style="max-width:44rem">${esc(shortBio(profile.bio))}</p></section>`;
    }
    const committees = (profile.committees || []).length
      ? `<ul class="committee-list">${profile.committees.map((c) =>
          `<li>${esc(c)}</li>`).join("")}</ul>`
      : `<p class="small">No standing committee or board assignments are
          listed in this profile.</p>`;
    const contact = profile.contact || {};
    const phoneHref = String(contact.phone || "").replace(/[^0-9+]/g, "");
    const contactPanel = contact.email || contact.phone
      ? `<div class="contact-lines">
          ${contact.email ? `<span>Email: <a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></span>` : ""}
          ${contact.phone ? `<span>Phone: <a href="tel:${esc(phoneHref)}">${esc(contact.phone)}</a></span>` : ""}
        </div>
        ${contact.email ? `<a class="btn secondary" href="mailto:${esc(contact.email)}">Email the office</a>
        <p class="email-helper">Opens your email app with the office address
        filled in. Deme does not send or read the message.</p>` : ""}`
      : `<p class="small">No public office contact details are listed in
          this profile.</p>`;
    html += `<div class="profile-grid">
      <section class="profile-panel" aria-labelledby="committees-h">
        <h3 id="committees-h">Committees &amp; boards</h3>
        <p class="intro">Standing assignments in this member profile.</p>
        ${committees}</section>
      <section class="profile-panel" aria-labelledby="contact-h">
        <h3 id="contact-h">Contact</h3>
        <p class="intro">Public office contact details.</p>
        ${contactPanel}</section>
    </div>`;
    const promises = profile.promises || [];
    if (promises.length) {
      if (memberRows.length && memberTotal > memberRows.length) {
        await ensureRest();
      }
      const cards = promises.map((pr, i) => {
        const related = relatedVotes(pr.text);
        return `<article class="promise-card">
          <p class="promise-num">Campaign promise ${i + 1}</p>
          <p>${esc(pr.text)}</p>
          ${pr.source ? `<a class="promise-source" href="${esc(pr.source)}"
            target="_blank" rel="noopener noreferrer">View campaign source ↗</a>` : ""}
          ${related.length ? `<details class="related-votes">
            <summary>Related votes in the record (${related.length})</summary>
            <div class="related-list">
            ${related.map((r) => `<button class="related-vote" type="button"
              data-ref="${esc(r.ref)}"><span>${esc(r.title || r.ref)}
              <span class="rv-ref">${esc(r.ref)} · ${esc(fmtDate(r.date))}</span></span>
              ${voteChip(r.vote)}</button>`).join("")}
            </div>
          </details>` : ""}
        </article>`;
      }).join("");
      html += `<section style="margin-top:2.4rem" aria-labelledby="promises-h">
        <h2 id="promises-h">Campaign promises</h2><hr class="rule">
        <p class="small" style="max-width:44rem">Promises are carried from
        the campaign material each member published, with the source kept
        beside the words. Related votes are matched by topic from this
        member’s recorded votes — a finding aid, not a verdict on whether
        a promise was kept.</p>
        <div class="promise-list">${cards}</div></section>`;
    } else {
      html += `<section style="margin-top:2.4rem" aria-labelledby="promises-h">
        <h2 id="promises-h">Campaign promises</h2><hr class="rule">
        <p class="small">No campaign promises on record for this member.</p>
        </section>`;
    }
  }
  /* ---------- lobbying record (public registry exports only) ------ */
  if (lobbying && lobbying.total > 0) {
    const methods = Object.entries(lobbying.methods || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `<li><span>${esc(k)}</span><b>${fmtNum(n)}</b></li>`).join("");
    const maxYear = Math.max(...lobbying.years.map((y) => y.count), 1);
    html += `<section class="lobbying" aria-labelledby="lobbying-h">
      <h2 id="lobbying-h" class="visually-hidden">Lobbying record</h2>
      <details>
        <summary>Lobbying contact
          <span class="pill">${fmtNum(lobbying.total)} communications</span></summary>
        <p class="lob-lede">Lobbyists must file every communication with a
        member of Council. This is the filed record for ${esc(person.name)} —
        shown beside the voting record, never as a claim about influence:
        Deme reports the record and leaves conclusions to readers.</p>
        <div class="lob-stats">
          <div class="stat"><span class="num">${fmtNum(lobbying.total)}</span>
            <span class="lab">Communications filed, ${esc(lobbying.first)} to ${esc(lobbying.last)}</span></div>
          <div class="stat"><span class="num">${fmtNum(lobbying.term)}</span>
            <span class="lab">Filed in the current term (2022–2026)</span></div>
          <div class="stat"><span class="num">${fmtNum(lobbying.lobbyists)}</span>
            <span class="lab">Different lobbyists · ${fmtNum(lobbying.clients)} clients ·
            ${fmtNum(lobbying.subjects)} subject matters</span></div>
        </div>
        <div class="lob-cols">
          <div><h4>Top subject matters</h4>
            <ul class="lob-list">${lobbying.top.map((t) =>
              `<li><span>${esc(t.label)}</span><b>${fmtNum(t.count)}</b></li>`).join("")}</ul></div>
          <div><h4>Communications by year</h4>
            <div class="lob-years">${lobbying.years.map((y) =>
              `<div class="lob-year"><span>${y.year}</span>
                <span class="bar"><span style="width:${Math.max(3, Math.round(y.count / maxYear * 100))}%"></span></span>
                <b>${fmtNum(y.count)}</b></div>`).join("")}</div>
            ${methods ? `<h4 style="margin-top:1.1rem">How contact was made</h4>
            <ul class="lob-list">${methods}</ul>` : ""}
          </div>
        </div>
        <p class="lob-note">Counts are communications as filed by lobbyists
        in the City of Toronto Lobbyist Registry, grouped to the member the
        filing names — a contact with a member’s staff is not counted here.
        Registry snapshot: October 8, 2026. Source:
        <a href="https://open.toronto.ca/dataset/lobbyist-registry/" target="_blank" rel="noopener noreferrer">City of Toronto Lobbyist Registry (Open Data)</a>.</p>
      </details></section>`;
  } else if (lobbying) {
    html += `<section class="lobbying" aria-labelledby="lobbying-h">
      <h2 id="lobbying-h">Lobbying contact</h2><hr class="rule">
      <p class="small" style="max-width:44rem">No recorded lobbying
      communications for ${esc(person.name)} in the City of Toronto Lobbyist
      Registry filings gathered on October 8, 2026.</p></section>`;
  }
  host.innerHTML = html;
  host.querySelectorAll(".related-vote").forEach((b) =>
    b.addEventListener("click", () => {
      location.href = `decision.html?ref=${encodeURIComponent(b.dataset.ref)}`;
    }));
}

/* ---------- W1: recorded-vote composition strip ----------
   One slim stacked bar under the stat tiles: of every recorded vote
   in this member's record, the share they cast (yes or no), the
   share they were absent for, and the share where they declared an
   interest. Computed inline from the councillors.json person object
   the page already loads — the same three published counts as the
   tiles (verified reference: enhancements-prep/member-composition.json;
   the member/<slug> row files undercount pre-2018 service and are
   never the source). Presentation of published facts only: unranked,
   ungraded, in the site's neutral colours. */
function compositionStrip(person) {
  const cast = person.votesCast || 0, absent = person.absent || 0,
    interest = person.interest || 0;
  const total = cast + absent + interest;
  if (!total) return "";
  const pct = (n) => (100 * n / total);
  const pctTxt = (n) => {
    const p = pct(n);
    return p > 0 && p < 0.05 ? "<0.1" : (Math.round(p * 10) / 10).toString();
  };
  const seg = (n, cls) => n > 0
    ? `<span class="comp-seg ${cls}" style="width:${pct(n).toFixed(2)}%"></span>` : "";
  return `<div class="composition">
    <div class="comp-bar" role="img" aria-label="Of ${fmtNum(total)} recorded
      votes in this member's record: ${fmtNum(cast)} cast, ${fmtNum(absent)}
      absent, ${fmtNum(interest)} with an interest declared.">
      ${seg(cast, "cast")}${seg(absent, "absent")}${seg(interest, "interest")}
    </div>
    <p class="comp-legend">Of the ${fmtNum(total)} recorded votes in their
      record: <strong>${pctTxt(cast)}%</strong> cast ·
      <strong>${pctTxt(absent)}%</strong> absent ·
      <strong>${pctTxt(interest)}%</strong> declared an interest — a duty,
      not an absence.</p>
  </div>`;
}

/* ---------- record card: preview dialog, download, print ----------
   The earlier build's shareable card, rebranded: Column-D mark, navy
   and green, the member's own numbers and five most recent votes. */
function cardVotes() {
  const seen = new Set();
  const out = [];
  for (const r of memberRows) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    out.push(r);
    if (out.length >= 5) break;
  }
  return out;
}
const chipPlain = (v) => v === "Yes" ? "Yes" : v === "No" ? "No"
  : (v && v.startsWith("Absent(Interest")) ? "Declared an interest" : "Absent";
function recordCardHTML(person, standalone) {
  const role = person.current
    ? (person.mayor ? "Mayor of Toronto"
       : `Councillor · Ward ${person.ward} — ${person.wardName}`)
    : "Former member of Toronto City Council";
  const photo = PHOTO_SLUGS.has(person.slug)
    ? (standalone
      ? `<img src="https://demeapp.github.io/assets/headshots/${person.slug}.jpg" alt="" width="72" height="72" style="border-radius:50%;object-fit:cover">`
      : avatarHTML(person))
    : avatarHTML(person);
  const votes = cardVotes().map((r) => standalone
    ? `<div class="rc-vote"><div><span class="rc-date">${esc(fmtDate(r.date))}</span><span class="rc-ref">${esc(r.ref)}</span></div><div>${esc(r.title || r.ref)}</div><div><strong>${esc(chipPlain(r.vote))}</strong></div></div>`
    : `<div class="rc-vote"><div><span class="rc-date">${esc(fmtDate(r.date))}</span><span class="rc-ref">${esc(r.ref)}</span></div><div>${esc(r.title || r.ref)}</div><div>${voteChip(r.vote)}</div></div>`
  ).join("");
  return `<div class="record-card-doc">
    <div class="rc-brand">${COLUMN_MARK} Deme · Toronto City Council</div>
    <div class="rc-rule"></div>
    <div class="rc-person">${photo}<div>
      <h2>${esc(person.name)}</h2>
      <p class="rc-ward">${esc(role)} · Voting record card</p></div></div>
    <div class="rc-stats">
      <div class="rc-stat"><span>Attendance</span><strong>${person.attendance == null ? "—" : person.attendance + "%"}</strong></div>
      <div class="rc-stat"><span>Votes cast</span><strong>${fmtNum(person.votesCast)}</strong></div>
      <div class="rc-stat"><span>Yes</span><strong>${fmtNum(person.yes)}</strong></div>
      <div class="rc-stat"><span>No</span><strong>${fmtNum(person.no)}</strong></div>
      <div class="rc-stat"><span>Declared interests</span><strong>${fmtNum(person.interest)}</strong></div>
    </div>
    <h3>Five most recent recorded votes</h3>
    ${votes || '<p>No recorded votes in the searchable archive.</p>'}
    <p class="rc-foot">Source: City of Toronto Council records, via Deme
    (demeapp.github.io) · Record current to October 19, 2026 · Prepared
    ${new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}</p>
  </div>`;
}
const CARD_CSS = `
  body{font-family:Arial,Helvetica,sans-serif;margin:2rem;color:#0A1424}
  .record-card-doc{max-width:44rem;margin:0 auto}
  .rc-brand{display:flex;align-items:center;gap:.55rem;font-weight:800;color:#0E2A47}
  .rc-rule{height:5px;background:#2FBF8F;border-radius:3px;margin:1rem 0 1.4rem}
  .rc-person{display:flex;gap:1.2rem;align-items:center}
  .rc-person h2{margin:0;font-size:2rem}
  .rc-ward{color:#52627A;font-weight:700;margin:.3rem 0 0}
  .rc-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#D7DEE8;border:1px solid #D7DEE8;margin:1.4rem 0}
  .rc-stat{background:#F4F7FA;padding:.8rem .7rem}
  .rc-stat span{display:block;color:#52627A;font-size:.72rem}
  .rc-stat strong{display:block;margin-top:.2rem;font-size:1.25rem}
  .rc-vote{display:grid;grid-template-columns:6.2rem 1fr auto;gap:.8rem;padding:.6rem 0;border-top:1px solid #E3EAF1;font-size:.9rem}
  .rc-date,.rc-ref{color:#52627A;font-size:.78rem}
  .rc-ref{display:block}
  .rc-foot{margin-top:1.4rem;padding-top:.8rem;border-top:2px solid #0E2A47;color:#52627A;font-size:.78rem}
  .avatar{display:none}`;
function openRecordCard(person) {
  let dlg = document.getElementById("record-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "record-dialog";
    dlg.className = "record-dialog";
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `${recordCardHTML(person, false)}
    <div class="record-actions">
      <button class="btn" id="rc-download" type="button">Download record card</button>
      <button class="btn secondary" id="rc-print" type="button">Print record card</button>
      <button class="btn secondary" id="rc-close" type="button">Close</button>
    </div>`;
  dlg.querySelector("#rc-close").addEventListener("click", () => dlg.close());
  dlg.querySelector("#rc-download").addEventListener("click", () => {
    const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(person.name)} — Voting Record Card · Deme</title>
<style>${CARD_CSS}</style></head><body>${recordCardHTML(person, true)}</body></html>`;
    const url = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${person.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}-voting-record.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  dlg.querySelector("#rc-print").addEventListener("click", () => {
    let pc = document.getElementById("print-card");
    if (!pc) {
      pc = document.createElement("div");
      pc.id = "print-card";
      document.body.appendChild(pc);
    }
    pc.innerHTML = recordCardHTML(person, false);
    document.body.classList.add("printing-card");
    const done = () => {
      document.body.classList.remove("printing-card");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
    setTimeout(done, 1000);
  });
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
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
  currentPerson = person;
  document.title = `${person.name} — Toronto City Council record | Deme`;
  const role = person.current
    ? (person.mayor ? "Mayor of Toronto"
       : `Councillor · Ward ${person.ward} — ${esc(person.wardName)}`)
    : "Former member of Toronto City Council";
  const attBar = person.attendance == null ? ""
    : `<span class="attendance-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, person.attendance))}%"></span></span>`;
  box.innerHTML = `
    <p class="kicker">${person.current ? "Council today" : "Earlier member"}</p>
    <div class="profile-head">${avatarHTML(person, "lg")}
      <div>
        <h1>${esc(person.name)}</h1>
        <p class="lede" style="margin-bottom:.3rem">${role}</p>
        <p class="small">Term${person.terms.length > 1 ? "s" : ""} in the record:
          ${person.terms.map((t) => esc(fmtTerm(t))).join(" · ")}</p>
      </div>
    </div>
    <div class="statTiles">
      <div class="stat"><span class="num">${person.attendance == null ? "—" : person.attendance + "%"}</span>
        <span class="lab">Attendance — present and voting, out of all
        recorded votes in their record</span>${attBar}</div>
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
    ${compositionStrip(person)}
    <p style="margin-top:1rem"><button class="btn secondary" id="record-card-btn"
      type="button">Print / download record card</button>
    <button class="btn secondary" id="share-btn" type="button">Copy link</button></p>
    <div id="profile-extra"></div>
    <h2 style="margin-top:2.6rem">Recorded votes</h2>
    <hr class="rule">
    <div id="historyWrap"><div class="skel-card" aria-hidden="true">
      <span class="skel-el sm"></span><span class="skel-el title"></span>
      <span class="skel-el"></span><span class="skel-el short"></span></div></div>`;
  document.getElementById("record-card-btn")
    .addEventListener("click", () => openRecordCard(person));
  setupShareButton(document.getElementById("share-btn"));

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
    } else {
      wrap.innerHTML = `<div class="history-chips" role="group" aria-label="Filter by outcome">
          <span class="hc-lab">Show:</span>
          ${Object.keys(FILTER_LABEL).map((f) => `<button class="fchip" type="button"
            data-f="${f}" aria-pressed="${f === "all"}">${FILTER_LABEL[f]}</button>`).join("")}
        </div>
        <p class="small" id="hist-status"></p>
        <ul class="personlist history-rows" id="history"></ul><div class="pager" id="pager"></div>`;
      wrap.querySelectorAll(".fchip").forEach((c) =>
        c.addEventListener("click", () => setFilter(c.dataset.f)));
      renderMore();
    }
  } catch (e) {
    wrap.innerHTML = `<p class="small">The voting record could not be loaded.</p>`;
  }
  renderExtras(person);
}
init().catch(() => {
  box.innerHTML = `<p class="small">The record could not be loaded. Please reload.</p>`;
});
