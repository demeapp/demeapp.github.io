/* Legislature layer member profile (Ontario / Canada expansion,
   Oct 27, 2026). Renders the Toronto profile's section pattern —
   head, summary stats, service, committees, contact, declared
   interests, pay & expenses, lobbying, recorded votes — from the
   layer data files. Facts only: no grades. The page declares its
   layer through window.DEME_LAYER_PROFILE. */
"use strict";
const PCFG = window.DEME_LAYER_PROFILE;
renderChrome(PCFG.directoryPage);

const params = new URLSearchParams(location.search);
const memberId = params.get(PCFG.idParam);
const box = document.getElementById("profile");
const PAGE = 25;
const VOTE_SLICE = 150;
let person = null, divisions = null;
let voteRows = [], voteShown = 0, voteTotal = 0, voteFilter = "all";
let restLoaded = false, restLoading = null;

const money = (n) => n == null ? "—"
  : "$" + Number(n).toLocaleString("en-CA",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const pctText = (v) => v == null ? "—" : `${Number(v).toFixed(1)}%`;

function layerAvatar(person, size = "") {
  const img = person.photo && PCFG.photoDir
    ? `<img src="${PCFG.photoDir}${encodeURIComponent(person.id || person.slug)}.webp"
        alt="" loading="lazy" decoding="async" onerror="demeAvatarError(this)">`
    : "";
  return `<span class="avatar ${size}" aria-hidden="true"><span>${esc(initialsOf(person.name))}</span>${img}</span>`;
}

/* ---------------- recorded votes ---------------- */
const VOTE_FILTERS = PCFG.layer === "canada"
  ? { all: "All", Yea: "Yea", Nay: "Nay", Paired: "Paired" }
  : { all: "All", Aye: "Aye", Nay: "Nay" };

function voteChip(v) {
  if (v === "Yea" || v === "Aye") return `<span class="voteYes">${v}</span>`;
  if (v === "Nay") return `<span class="voteNo">Nay</span>`;
  if (v === "Paired") return `<span class="votePair">Paired</span>`;
  return `<span class="voteAbs">${esc(v)} — as published</span>`;
}

function rowHTML(r) {
  const div = divisions[r[0]];
  if (PCFG.layer === "canada") {
    const meta = [fmtDate(div.date), div.result,
      div.bill ? `Bill ${div.bill}` : ""].filter(Boolean).join(" · ");
    return `<li>
      <span class="h-title">${esc(`Division ${div.session} #${div.number} — ${div.subject}`)}
        <span class="h-meta">${esc(meta)}</span></span>
      <span class="h-badge">${voteChip(r[1])}</span></li>`;
  }
  const meta = [div.date, div.outcome,
    `Ayes ${fmtNum(div.ayes)} – Nays ${fmtNum(div.nays)}`]
    .filter(Boolean).join(" · ");
  const title = div.billUrl
    ? `<a href="${esc(div.billUrl)}">${esc(div.title)}</a>`
    : esc(div.title);
  return `<li>
    <span class="h-title">${title}
      <span class="h-meta">${esc(meta)}</span></span>
    <span class="h-badge">${voteChip(r[1])}</span></li>`;
}

async function ensureRest() {
  if (restLoaded || PCFG.layer !== "canada") return;
  if (!restLoading) {
    restLoading = loadJSON(`${PCFG.dataDir}member/${memberId}.more.json`)
      .then((d) => { voteRows = voteRows.concat(d.rows || []); })
      .catch(() => { voteTotal = voteRows.length; })
      .then(() => { restLoaded = true; });
  }
  await restLoading;
}

function activeVoteRows() {
  return voteFilter === "all" ? voteRows
    : voteRows.filter((r) => r[1] === voteFilter);
}

async function renderMoreVotes() {
  if (voteFilter === "all" && !restLoaded && voteTotal > voteRows.length
      && voteShown + PAGE > voteRows.length - PAGE) {
    await ensureRest();
  }
  const rows = activeVoteRows();
  const total = voteFilter === "all" ? voteTotal : rows.length;
  const slice = rows.slice(voteShown, voteShown + PAGE);
  voteShown += slice.length;
  document.getElementById("history").insertAdjacentHTML(
    "beforeend", slice.map(rowHTML).join(""));
  const status = document.getElementById("hist-status");
  if (status) {
    status.textContent = voteFilter === "all"
      ? `${fmtNum(voteTotal)} recorded votes in this member's record, newest first.`
      : `${fmtNum(rows.length)} recorded votes marked ${VOTE_FILTERS[voteFilter]}, out of ${fmtNum(voteTotal)} in this member's record.`;
  }
  const pager = document.getElementById("pager");
  pager.innerHTML = voteShown < total
    ? `<button class="btn secondary" id="more">Show more (${fmtNum(total - voteShown)} remaining)</button>`
    : "";
  const b = document.getElementById("more");
  if (b) b.addEventListener("click", renderMoreVotes);
}

async function setVoteFilter(f) {
  if (f === voteFilter) return;
  voteFilter = f;
  document.querySelectorAll(".fchip").forEach((c) =>
    c.setAttribute("aria-pressed", String(c.dataset.f === f)));
  if (f !== "all") await ensureRest();
  voteShown = 0;
  document.getElementById("history").innerHTML = "";
  renderMoreVotes();
}

/* ---------------- sections ---------------- */
function termsSection(p) {
  if (!p.terms || !p.terms.length) return "";
  const rows = p.terms.map((t) => {
    if (PCFG.layer === "canada") {
      return `<li><strong>${ordinal(t.parliament)} Parliament</strong> — ${esc(t.riding || "")}${t.party ? ` (${esc(t.party)})` : ""} · ${esc(t.from)} – ${esc(t.to || "present")}</li>`;
    }
    return `<li><strong>${ordinal(t.parliament)} Parliament</strong> · ${esc(t.from)} – ${esc(t.to)}</li>`;
  }).join("");
  return `<section style="margin-top:2.4rem" aria-labelledby="terms-h">
    <h2 id="terms-h">Service in the record</h2><hr class="rule">
    <ul>${rows}</ul></section>`;
}

function rolesSection(p) {
  if (PCFG.layer === "canada" && p.roles && p.roles.length) {
    const rows = p.roles.map((r) =>
      `<li>${esc(r.title)} · ${esc(r.from || "")}${r.to ? ` – ${esc(r.to)}` : " – present"}</li>`).join("");
    return `<section style="margin-top:2.4rem" aria-labelledby="roles-h">
      <h2 id="roles-h">Parliamentary roles</h2><hr class="rule">
      <ul>${rows}</ul></section>`;
  }
  if (PCFG.layer === "ontario" && p.career) {
    return `<section style="margin-top:2.4rem" aria-labelledby="career-h">
      <h2 id="career-h">Career — from the Assembly profile</h2><hr class="rule">
      <div class="doc-text">${esc(p.career)}</div>
      <p class="small">The member's career record as published on their
      Legislative Assembly profile, gathered October 20, 2026.</p></section>`;
  }
  return "";
}

function panelsSection(p) {
  const hasCommittees = p.committees && p.committees.length;
  const hasContact = !!p.contact;
  if (!hasCommittees && !hasContact) return "";
  let committees = "";
  if (hasCommittees) {
    committees = `<section class="profile-panel" aria-labelledby="committees-h">
      <h3 id="committees-h">Committees</h3>
      <ul>${p.committees.map((c) =>
        `<li>${esc(c.name)}${c.role && c.role !== "Member" ? ` — ${esc(c.role)}` : ""}</li>`).join("")}</ul>
      ${p.committeesLabel ? `<p class="intro">Committees here are ${esc(p.committeesLabel)}.</p>` : ""}
      </section>`;
  }
  let contact = "";
  if (hasContact) {
    const c = p.contact;
    const lines = [];
    if (PCFG.layer === "canada") {
      if (c.email) lines.push(`<li>Email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`);
      if (c.phone) lines.push(`<li>Phone: ${esc(c.phone)}</li>`);
      if (c.profileUrl) lines.push(`<li><a href="${esc(c.profileUrl)}">Member's page at ourcommons.ca</a></li>`);
    } else {
      if (c.email) lines.push(`<li>Email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`);
      if (c.constituency) lines.push(`<li>Constituency office: ${esc(c.constituency)}</li>`);
      if (c.legislative) lines.push(`<li>Legislative office: ${esc(c.legislative)}</li>`);
      if (c.profileUrl) lines.push(`<li><a href="${esc(c.profileUrl)}">Member's page at ola.org</a></li>`);
    }
    contact = `<section class="profile-panel" aria-labelledby="contact-h">
      <h3 id="contact-h">Contact</h3>
      <ul>${lines.join("")}</ul></section>`;
  }
  return `<div class="profile-grid" style="margin-top:2.4rem">${committees}${contact}</div>`;
}

function docDetails(summary, text, url, linkLabel) {
  return `<details><summary>${esc(summary)}</summary>
    ${text ? `<div class="doc-text">${esc(text)}</div>` : ""}
    ${url ? `<p class="small"><a href="${esc(url)}">${esc(linkLabel)}</a></p>` : ""}
    </details>`;
}

function interestsSection(p) {
  if (PCFG.layer === "canada") {
    const ints = p.interests || { summaries: [], other: [] };
    const total = ints.summaries.length + ints.other.length;
    let body = "";
    if (!total) {
      body = `<p>No documents for this member in the Commissioner's
        public registry as gathered for this archive.</p>`;
    } else {
      if (ints.summaries.length) {
        body += `<div class="doc-list">${ints.summaries.map((d, i) =>
          docDetails(
            `Disclosure summary ${ints.summaries.length > 1 ? `${i + 1} of ${ints.summaries.length}` : ""} — ${(d.desc || "").slice(0, 90)}…`,
            d.text || d.desc, d.url,
            "Registry page (ethicscanada.ca)")).join("")}</div>`;
      }
      const byType = {};
      for (const d of ints.other) (byType[d.type] ||= []).push(d);
      for (const [type, docs] of Object.entries(byType)) {
        body += `<h3 style="margin-top:1.6rem">${esc(type)} (${docs.length})</h3>
          <div class="doc-list">${docs.map((d) =>
            docDetails(`${type} — ${(d.desc || "").slice(0, 90)}…`,
              d.text || d.desc, d.url,
              "Registry page (ethicscanada.ca)")).join("")}</div>`;
      }
    }
    return `<section style="margin-top:2.4rem" aria-labelledby="interests-h">
      <h2 id="interests-h">Declared interests — the ethics registry</h2><hr class="rule">
      <p class="small" style="max-width:44rem">Documents this member has
      filed with the Conflict of Interest and Ethics Commissioner, from
      the Commissioner's public registry. The count is of registry
      documents — a disclosure summary is the member's periodic filing
      under the Conflict of Interest Code — not a count of individual
      interests.</p>${body}</section>`;
  }
  const ints = p.interests || { count: 0, years: [], statements: [] };
  const stmts = ints.statements.map((s) =>
    docDetails(`${s.year} statement`, s.text, null, "")).join("");
  const textYears = new Set(ints.statements.map((s) => s.year));
  const missingYears = (ints.years || []).filter((y) => !textYears.has(y));
  const missingNote = missingYears.length
    ? `<p class="small" style="max-width:44rem">Statement texts are
      shown for ${[...textYears].sort().join(", ")}. The statements for
      ${missingYears.join(", ")} are counted from the Commissioner's
      index; their texts were not gathered for this archive.</p>`
    : "";
  return `<section style="margin-top:2.4rem" aria-labelledby="interests-h">
    <h2 id="interests-h">Disclosure statements — Integrity Commissioner</h2><hr class="rule">
    <p><strong>Disclosure statements on file: ${fmtNum(ints.count)} (annual statements, 2005–present)</strong></p>
    <p class="small" style="max-width:44rem">Each statement is the
    member's annual filing to the Integrity Commissioner — income
    sources, assets, liabilities, and gifts and benefits over $200, as
    published. The published statements carry no dollar amounts, and
    they are snapshots by year, not a register of dated declarations.</p>
    ${missingNote}
    ${ints.count ? `<div class="doc-list">${stmts}</div>`
      : `<p>No disclosure statements on file for this member in the series gathered (2005–2025).</p>`}
    </section>`;
}


function expensesSection(p) {
  if (PCFG.layer === "canada") {
    const rows = (p.expenses || []).slice().reverse();
    if (!rows.length) return "";
    const trs = rows.map((r) => `<tr>
      <td>${esc(r.q)}</td><td class="num">${money(r.salaries)}</td>
      <td class="num">${money(r.travel)}</td>
      <td class="num">${money(r.hospitality)}</td>
      <td class="num">${money(r.contracts)}</td>
      <td class="num">${money(r.total)}</td>
      <td><a href="${esc(r.url)}">House page</a></td></tr>`).join("");
    return `<section style="margin-top:2.4rem" aria-labelledby="pay-h">
      <h2 id="pay-h">Pay and expenses — as published</h2><hr class="rule">
      <p class="small" style="max-width:44rem">The member's office
      expenditures, as published by the House of Commons each quarter.
      “Salaries” is the pay of the member's staff, not the member's own
      salary: a member's parliamentary salary is a single statutory
      rate and is not part of these office figures.</p>
      <table class="layer-table"><thead><tr>
        <th>Quarter</th><th class="num">Salaries</th>
        <th class="num">Travel</th><th class="num">Hospitality</th>
        <th class="num">Contracts</th><th class="num">Total</th>
        <th>Source</th></tr></thead><tbody>${trs}</tbody></table>
      </section>`;
  }
  const exp = p.expenses || { payments: [], annual: [] };
  if (!exp.payments.length && !exp.annual.length) return "";
  let body = "";
  if (exp.payments.length) {
    const byPeriod = {};
    for (const r of exp.payments) (byPeriod[r.period] ||= []).push(r);
    body += Object.entries(byPeriod).map(([period, rows]) => {
      const items = rows.map((r) => {
        const cats = [["Travel", r.travel], ["Accommodation", r.accommodation],
          ["Meals", r.meals], ["Hospitality", r.hospitality]]
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k} ${money(v)}`).join(" · ");
        return `<li><strong>${money(r.total)}</strong> — ${esc(r.purpose || "Expense")}
          ${r.location ? ` · ${esc(r.location)}` : ""}${cats ? `<br><span class="small">${esc(cats)}</span>` : ""}</li>`;
      }).join("");
      return `<details class="pay-year"><summary><h3>${esc(period)}</h3></summary>
        <ul>${items}</ul></details>`;
    }).join("");
  }
  if (exp.annual.length) {
    const byFy = {};
    for (const r of exp.annual) {
      const fy = (byFy[r.fy] ||= { office: 0, travel: 0, low: false });
      if (r.section === "office_and_support_staff") fy.office += r.total || 0;
      else if (r.section === "travel_and_toronto_accommodation") fy.travel += r.total || 0;
      if (r.confidence === "low") fy.low = true;
    }
    const trs = Object.entries(byFy).sort().map(([fy, v]) => `<tr>
      <td>${esc(fy)}</td><td class="num">${money(v.office)}</td>
      <td class="num">${money(v.travel)}</td>
      <td class="num">${money(v.office + v.travel)}</td>
      <td>${v.low ? "Read from a scanned document" : ""}</td></tr>`).join("");
    body += `<h3 style="margin-top:1.8rem">Annual totals, as published</h3>
      <table class="layer-table"><thead><tr><th>Fiscal year</th>
      <th class="num">Office &amp; support staff</th>
      <th class="num">Travel &amp; Toronto accommodation</th>
      <th class="num">Year total</th><th></th></tr></thead>
      <tbody>${trs}</tbody></table>`;
  }
  return `<section style="margin-top:2.4rem" aria-labelledby="pay-h">
    <h2 id="pay-h">Pay and expenses — as published</h2><hr class="rule">
    <p class="small" style="max-width:44rem">Expenses as published by
    the Legislative Assembly: payments as disclosed from April 2024,
    and the Assembly's annual totals for earlier years. Ministers'
    expenses are published in a separate provincial system and are not
    included here.</p>${body}</section>`;
}

function lobbyingSection(p) {
  if (PCFG.layer === "canada") {
    const lob = p.lobbying;
    if (!lob) return "";
    const years = Object.entries(lob.byYear)
      .map(([y, n]) => `<span>${esc(y)}: <strong>${fmtNum(n)}</strong></span>`).join("");
    const listOf = (pairs) => `<ul>${pairs.map(([k, n]) =>
      `<li>${esc(k)} — ${fmtNum(n)}</li>`).join("")}</ul>`;
    return `<section style="margin-top:2.4rem" aria-labelledby="lobbying-h">
      <h2 id="lobbying-h">Lobbying record</h2><hr class="rule">
      <p class="small" style="max-width:44rem">Communication reports
      filed by registered lobbyists with the Office of the Commissioner
      of Lobbying, naming this member as the designated public office
      holder contacted — <strong>${fmtNum(lob.total)}</strong> reports,
      ${esc(lob.first)} – ${esc(lob.last)}. A report records a
      communication as reported by the lobbyist, in the registry's own
      terms.</p>
      <div class="by-year">${years}</div>
      <div class="profile-grid" style="margin-top:1.4rem">
        <section class="profile-panel"><h3>Top subject matters</h3>${listOf(lob.topSubjects)}</section>
        <section class="profile-panel"><h3>Top organizations</h3>${listOf(lob.topOrgs)}</section>
      </div>
      <details id="lob-details" style="margin-top:1.2rem">
        <summary><strong>All communications, as filed (${fmtNum(lob.total)})</strong></summary>
        <div id="lob-list"><p class="small">Loading…</p></div>
        <div class="pager" id="lob-pager"></div>
      </details></section>`;
  }
  const lob = p.lobbying;
  if (!lob) return "";
  const rows = lob.sample.map((x) => `<tr>
    <td>${esc(x.lobbyist)}</td>
    <td>${esc(x.organization || "")}${x.client ? `<br><span class="small">for ${esc(x.client)}</span>` : ""}</td>
    <td>${esc(x.type || "")}</td><td>${esc(x.amended || "")}</td>
    <td>${esc(x.regNo || "")}</td></tr>`).join("");
  return `<section style="margin-top:2.4rem" aria-labelledby="lobbying-h">
    <h2 id="lobbying-h">Lobbying registrations</h2><hr class="rule">
    <p class="small" style="max-width:44rem">Ontario's lobbyist registry
    publishes registrations — a lobbyist's statement of intent to lobby
    an office. It does not publish records of contacts, meetings, or
    communications, and no such Ontario record exists to show.</p>
    <p>Active registrations naming this member's office:
    <strong>${fmtNum(lob.total)}</strong> (registry search, October 2026;
    office searched: “${esc(lob.office)}”). A registration is an intent
    to lobby — it is not evidence that any contact took place.</p>
    <h3 style="margin-top:1.4rem">Sample — first page of the search results</h3>
    <table class="layer-table"><thead><tr><th>Lobbyist</th>
    <th>Organization / client</th><th>Type</th><th>Last amended</th>
    <th>Registration</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
}

let lobComms = null, lobShown = 0, lobLoading = false;
async function renderMoreLob() {
  if (lobLoading) return;
  lobLoading = true;
  try {
  if (!lobComms) {
    try {
      const d = await loadJSON(`${PCFG.dataDir}lob/${memberId}.json`);
      lobComms = d.communications || [];
    } catch (e) {
      document.getElementById("lob-list").innerHTML =
        `<p class="small">The communications list could not be loaded.</p>`;
      return;
    }
  }
  } finally { lobLoading = false; }
  const slice = lobComms.slice(lobShown, lobShown + 200);
  lobShown += slice.length;
  const html = slice.map((c) => `<li>
    <span class="h-title">${esc(c.lobbyist)}${c.org ? ` — ${esc(c.org)}` : ""}
      <span class="h-meta">${[fmtDate(c.date), c.title, c.subjects]
        .filter(Boolean).map(esc).join(" · ")}</span></span></li>`).join("");
  const list = document.getElementById("lob-list");
  if (lobShown <= 200) list.innerHTML = `<ul class="personlist history-rows">${html}</ul>`;
  else list.querySelector("ul").insertAdjacentHTML("beforeend", html);
  const pager = document.getElementById("lob-pager");
  pager.innerHTML = lobShown < lobComms.length
    ? `<button class="btn secondary" id="lob-more">Show more (${fmtNum(lobComms.length - lobShown)} remaining)</button>`
    : "";
  const b = document.getElementById("lob-more");
  if (b) b.addEventListener("click", renderMoreLob);
}

/* ---------------- main render ---------------- */
async function renderProfile() {
  if (!memberId) {
    box.innerHTML = `<p class="small">No member was named in the link.
      <a href="${PCFG.directoryPage}">Back to the directory</a>.</p>`;
    return;
  }
  try {
    person = await loadJSON(`${PCFG.dataDir}member/${memberId}.json`);
    divisions = await loadJSON(`${PCFG.dataDir}divisions.json`);
  } catch (e) {
    box.innerHTML = `<p class="small">That member's record could not be
      loaded. <a href="${PCFG.directoryPage}">Back to the directory</a>.</p>`;
    return;
  }
  const p = person;
  document.title = `${p.name} — Deme`;
  const house = PCFG.layer === "canada" ? "House of Commons"
    : "Legislative Assembly of Ontario";
  const role = PCFG.layer === "canada"
    ? `MP · ${esc(p.riding)}${p.province ? `, ${esc(p.province)}` : ""}`
    : `MPP · ${esc(p.riding)}`;
  const tenureLine = p.current
    ? (PCFG.layer === "canada" && p.parliaments > 1
        ? `${p.parliaments} parliaments · since ${p.firstYear}`
        : `Since ${p.firstYear}`)
    : `Served ${p.firstYear}–${p.lastYear}`;
  const st = p.stats;
  const interestsTile = PCFG.layer === "canada"
    ? `<div class="stat"><span class="num">${fmtNum(st.interestsDocuments)}</span>
        <span class="lab">Ethics registry documents on file</span></div>`
    : `<div class="stat"><span class="num">${fmtNum(st.pdsStatements)}</span>
        <span class="lab">Disclosure statements on file (annual statements, 2005–present)</span></div>`;
  const participationNote = PCFG.layer === "canada"
    ? `Recorded-vote participation is the share of recorded divisions in this member's service where the member cast a vote — not a count of sittings attended. Divisions where the member was paired count as non-votes.${st.yeaNayValue ? ` In ${fmtNum(st.yeaNayValue)} division${st.yeaNayValue > 1 ? "s" : ""} in this record the published ballot value is the literal text “Yea/Nay”, a quirk of the source record; those ballots are not counted as votes cast and are shown below exactly as published.` : ""}`
    : `Recorded-vote participation is the share of recorded divisions in this member's service where the member cast a vote — not a count of sittings attended. Ontario publishes no pairing record: a member not listed in a division did not vote in it, for any reason.`;
  const sections = [
    ["terms", "Service", "#terms-h"],
    ["roles", PCFG.layer === "canada" ? "Roles" : "Career",
     PCFG.layer === "canada" ? "#roles-h" : "#career-h"],
    ["committees", "Committees & contact", "#committees-h"],
    ["interests", PCFG.layer === "canada" ? "Declared interests" : "Disclosure", "#interests-h"],
    ["pay", "Pay & expenses", "#pay-h"],
    ["lobbying", "Lobbying", "#lobbying-h"],
    ["votes", "Recorded votes", "#recorded-votes-h"]];
  const rendered = {
    terms: termsSection(p), roles: rolesSection(p),
    committees: panelsSection(p), interests: interestsSection(p),
    pay: expensesSection(p), lobbying: lobbyingSection(p), votes: "1"};
  const contents = sections.filter(([k]) => rendered[k])
    .map(([, label, href]) => `<a href="${href}">${label}</a>`).join("");
  voteRows = p.votes.rows || [];
  voteTotal = p.votes.total || voteRows.length;
  restLoaded = voteTotal <= voteRows.length;
  box.innerHTML = `
    <p class="kicker">${house} — ${p.current ? "current member" : "earlier member"}</p>
    <div class="profile-head">${layerAvatar(p, "lg")}
      <div>
        <h1>${esc(p.name)}</h1>
        <p class="lede" style="margin-bottom:.3rem">${role}</p>
        <p class="party-line">${esc(p.party || "")}</p>
        <p class="small">${esc(tenureLine)}</p>
      </div>
    </div>
    <div class="statTiles">
      <div class="stat"><span class="num">${pctText(st.participation)}</span>
        <span class="lab">Recorded-vote participation — cast a vote, out of the recorded divisions in this member's service</span></div>
      <div class="stat"><span class="num">${fmtNum(st.votesCast)}</span>
        <span class="lab">Votes cast (${PCFG.layer === "canada" ? "yea or nay" : "aye or nay"}) across their record</span></div>
      ${interestsTile}
    </div>
    <p class="small" style="max-width:44rem">${participationNote}</p>
    <nav class="profile-contents" aria-label="On this page">
      <span class="pc-lab">On this page</span>${contents}
    </nav>
    ${rendered.terms}${rendered.roles}${rendered.committees}
    ${rendered.interests}${rendered.pay}${rendered.lobbying}
    <h2 style="margin-top:2.6rem" id="recorded-votes-h">Recorded votes</h2>
    <hr class="rule">
    <div id="historyWrap"></div>
    <div class="coverage-note">${PCFG.layer === "canada"
      ? `<strong>Coverage.</strong> Recorded votes in this archive run from October 18, 2004 to October 8, 2026; the three most recent divisions (45-1 #179–181) are not yet included.`
      : `<strong>Coverage.</strong> This layer is the archive as gathered on October 20, 2026; recorded votes run from August 10, 2022 to the June 2, 2026 sitting.`}
    </div>`;
  const wrap = document.getElementById("historyWrap");
  if (!voteTotal) {
    wrap.innerHTML = `<div class="notice">No recorded votes for this
      member in the archive yet — their record begins with the divisions
      captured after they took office.</div>`;
  } else {
    wrap.innerHTML = `<div class="history-chips" role="group" aria-label="Filter by outcome">
        <span class="hc-lab">Show:</span>
        ${Object.entries(VOTE_FILTERS).map(([f, label]) =>
          `<button class="fchip" type="button" data-f="${f}" aria-pressed="${f === "all"}">${label}</button>`).join("")}
      </div>
      <p class="small" id="hist-status"></p>
      <ul class="personlist history-rows" id="history"></ul><div class="pager" id="pager"></div>`;
    wrap.querySelectorAll(".fchip").forEach((c) =>
      c.addEventListener("click", () => setVoteFilter(c.dataset.f)));
    renderMoreVotes();
  }
  const lobDetails = document.getElementById("lob-details");
  if (lobDetails) {
    lobDetails.addEventListener("toggle", () => {
      if (lobDetails.open && !lobComms) renderMoreLob();
    });
  }
}
renderProfile();
