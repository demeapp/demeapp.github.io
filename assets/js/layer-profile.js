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
  if (PCFG.layer === "canada") {
    // Federal tenure entries are stints (a riding/party span that can
    // cross Parliaments), so they are labelled by riding and dates —
    // never by a single Parliament — newest first, human dates.
    const rows = p.terms.slice().reverse().map((t) =>
      `<li><strong>${esc(t.riding || "")}</strong>${t.party ? ` (${esc(t.party)})` : ""} · ${fmtDate(t.from)} – ${t.to ? fmtDate(t.to) : "present"}</li>`).join("");
    return `<section style="margin-top:2.4rem" aria-labelledby="terms-h">
    <h2 id="terms-h">Service in the record</h2><hr class="rule">
    ${p.parliaments > 1 ? `<p class="small">Service spanning ${p.parliaments} parliaments.</p>` : ""}
    <ul>${rows}</ul></section>`;
  }
  const rows = p.terms.map((t) =>
    `<li><strong>${ordinal(t.parliament)} Parliament</strong> · ${esc(t.from)} – ${esc(t.to)}</li>`).join("");
  return `<section style="margin-top:2.4rem" aria-labelledby="terms-h">
    <h2 id="terms-h">Service in the record</h2><hr class="rule">
    <ul>${rows}</ul></section>`;
}

function rolesSection(p) {
  if (PCFG.layer === "canada" && p.roles && p.roles.length) {
    const rows = p.roles.map((r) =>
      `<li>${esc(r.title)} · ${r.from ? fmtDate(r.from) : ""}${r.to ? ` – ${fmtDate(r.to)}` : " – present"}</li>`).join("");
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
  return `<div class="profile-grid" id="panels-h" style="margin-top:2.4rem">${committees}${contact}</div>`;
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
    // The registry extract concatenates a summary's fragments with
    // no separator at all — section headers, list items and sentences
    // run together ("AssetsShares of:- Bank of Nova Scotia-
    // Enbridge…") — so the collapsed label reads as one block. Only
    // this label is normalized: whitespace collapsed and the missing
    // separators restored. The document text shown on expansion is
    // untouched. Word joins are not split where they are really one
    // name: Mc/Mac/Le prefixes (McGill, MacKinnon, LeBlanc), lettered
    // names like B2Gold, and "iShares".
    const snippet = (s) => {
      s = String(s || "").replace(/\s+/g, " ").trim();
      s = s.replace(/([:;,.])(?=[A-Za-z])/g, "$1 ")
           .replace(/:(?=-)/g, ": ")
           .replace(/([A-Za-z])- (?=[A-Z])/g, "$1 - ");
      let out = "";
      for (let i = 0; i < s.length; i++) {
        out += s[i];
        const c = s[i], n = s[i + 1] || "";
        if (!/[A-Z]/.test(n)) continue;
        if (/[a-z]/.test(c)) {
          const frag = (out.match(/[A-Za-z]+$/) || [""])[0];
          if (frag === "Mc" || frag === "Mac" || frag === "Le") continue;
          if (c === "i" && s.startsWith("Shares", i + 1)) continue;
          out += " ";
        } else if (/[0-9]/.test(c)) {
          const run = (out.match(/[A-Za-z0-9]+$/) || [""])[0];
          if (/^[0-9]+$/.test(run)) out += " ";
        }
      }
      s = out;
      return s.length > 90 ? `${s.slice(0, 90)}…` : s;
    };
    /* F-1 (audit, Oct 27, 2026): a document's registry description
       can be empty — every Sponsored Travel and Gifts document is —
       and the label used to be built from that field alone, so 646
       documents on 168 profiles rendered as a bare "Type — ". The
       identifying details live in the document's own metadata, which
       is never rendered today. Build the label from the metadata
       when the description is empty: destination and dates for
       travel; nature and source for gifts; the metadata description
       for the rest. A document with no metadata at all is labelled
       from the disclosure date its own text carries. Labels that
       STILL collide inside one type group are separated by that
       same date, then by their order in the registry listing — no
       label is ever left blank, and no document's text, count or
       order changes. */
    const cleanMeta = (v) => String(v || "")
      .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
    const metaGet = (d, ...names) => {
      const meta = d.meta || {};
      for (const k of Object.keys(meta)) {
        if (names.includes(cleanMeta(k).toLowerCase())) {
          const v = cleanMeta(meta[k]);
          if (v) return v;
        }
      }
      return "";
    };
    const disclosedOn = (d) => {
      const m = /Disclosed on ([A-Z][a-z]+ \d{1,2}, \d{4})/
        .exec(d.text || "");
      return m ? m[1] : "";
    };
    const docLabel = (d) => {
      const desc = snippet(d.desc);
      if (desc) return `${d.type} — ${desc}`;
      if (d.type === "Sponsored Travel") {
        const dest = metaGet(d, "destination(s)");
        const dates = metaGet(d, "dates");
        const sponsor = metaGet(d, "sponsor of the trip");
        const head = [dest, dates ? `· ${dates}` : ""]
          .filter(Boolean).join(" ");
        const label = [head, sponsor ? `sponsored by ${sponsor}` : ""]
          .filter(Boolean).join(" — ");
        if (label) return `Sponsored Travel — ${label}`;
      }
      if (d.type === "Gifts (Code)" || d.type === "Gifts (Act)") {
        const nature = metaGet(d, "nature");
        const source = metaGet(d, "source");
        const received = metaGet(d, "gift received date");
        const label = [nature, source ? `from ${source}` : "",
          received ? `received ${received}` : ""]
          .filter(Boolean).join(" · ");
        if (label) return `${d.type} — ${label}`;
      }
      const metaDesc = snippet(metaGet(d, "description"));
      if (metaDesc) return `${d.type} — ${metaDesc}`;
      const on = disclosedOn(d);
      if (on) return `${d.type} — disclosed ${on}`;
      return d.type;
    };
    /* Separate any labels still identical inside one group: first
       by the document's own disclosed-on date, then — for filings
       that share even that — by their place in the registry
       listing, which is the one thing that always differs. */
    const dedupeLabels = (docs, labels) => {
      const seen = new Map();
      labels.forEach((l, i) => {
        if (!seen.has(l)) { seen.set(l, i); return; }
        const on = disclosedOn(docs[i]);
        labels[i] = on && !labels.includes(`${l} · disclosed ${on}`)
          ? `${l} · disclosed ${on}` : `${l} · ${i + 1} of ${docs.length} in this list`;
      });
      return labels;
    };
    if (!total) {
      body = `<p>No documents for this member in the Commissioner's
        public registry as gathered for this archive.</p>`;
    } else {
      if (ints.summaries.length) {
        /* F-2 (audit, Oct 27, 2026): summaries carry no filing date
           in the registry extract, and members with several summaries
           hold the SAME summary repeated in the extract — identical
           description, text and registry page — so a content snippet
           cannot tell them apart, and pretending otherwise would
           invent a difference. Identical repeats are labelled by
           their order in the registry listing, with one note saying
           plainly that the listings are identical. Where summaries
           genuinely differ, each label starts where their texts
           stop agreeing, skipping the shared opening sections. */
        const descs = ints.summaries.map((d) => String(d.desc || "")
          .replace(/\s+/g, " ").trim());
        const n = ints.summaries.length;
        /* "Identical" must be true of the whole listing, not just
           its description (Gate 3, Rule 5): description, text and
           registry page all equal, or the summaries take the
           differing-labels path below. */
        const texts = ints.summaries.map((d) => String(d.text || "")
          .replace(/\s+/g, " ").trim());
        const allSame = n > 1
          && descs.every((x) => x === descs[0])
          && texts.every((x) => x === texts[0])
          && ints.summaries.every((d) =>
            (d.url || "") === (ints.summaries[0].url || ""));
        let labels;
        if (n === 1) {
          labels = [`Disclosure summary — ${snippet(descs[0])}`];
        } else if (allSame) {
          labels = ints.summaries.map((_, i) =>
            `Disclosure summary ${i + 1} of ${n}`);
        } else {
          let cp = 0;
          const minLen = Math.min(...descs.map((x) => x.length));
          while (cp < minLen
              && descs.every((x) => x[cp] === descs[0][cp])) cp++;
          labels = ints.summaries.map((d, i) => {
            let rest = descs[i].slice(cp).replace(/^[\s:;,.—-]+/, "");
            const cut = rest.indexOf(" ", 40);
            if (rest.length > 90) {
              rest = `${rest.slice(0, cut > 40 ? cut : 90)}…`;
            }
            return rest
              ? `Disclosure summary ${i + 1} of ${n} — ${rest}`
              : `Disclosure summary ${i + 1} of ${n}`;
          });
          labels = dedupeLabels(ints.summaries, labels);
        }
        body += `<div class="doc-list">${ints.summaries.map((d, i) =>
          docDetails(labels[i], d.text || d.desc, d.url,
            "Registry page (ethicscanada.ca)")).join("")}</div>`;
        if (allSame) {
          body += `<p class="small" style="max-width:44rem">The
            Commissioner's public registry lists this disclosure
            summary ${n} times for this member, word for word the
            same each time; they are shown in the registry's
            order.</p>`;
        } else if (n > 1) {
          body += `<p class="small" style="max-width:44rem">These
            summaries are numbered in the order the Commissioner's
            registry lists them.</p>`;
        }
      }
      const byType = {};
      for (const d of ints.other) (byType[d.type] ||= []).push(d);
      for (const [type, docs] of Object.entries(byType)) {
        const labels = dedupeLabels(docs, docs.map(docLabel));
        body += `<h3 style="margin-top:1.6rem">${esc(type)} (${docs.length})</h3>
          <div class="doc-list">${docs.map((d, i) =>
            docDetails(labels[i],
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
  /* O-2 (audit, Oct 27, 2026): nine members filed twice in one year
     and showed two identical "YYYY statement" rows. Every statement's
     own text carries its as-of date ("As of March 10, 2018", the
     first line of the filing), so the label takes that date — the
     two 2018 filings read as what they are. O-3: statements list
     newest first, like every vote list on the site. Sorting is by
     year, then as-of date; the count and the texts do not change. */
  const MONTHS = { January: 0, February: 1, March: 2, April: 3,
    May: 4, June: 5, July: 6, August: 7, September: 8, October: 9,
    November: 10, December: 11 };
  const asOf = (s) => {
    /* Cleaned statements (disclosure-cleanup wave, Oct 28, 2026)
       carry their as-of date as data; the text regex below remains
       for any statement the cleaner has not reached. */
    if (s.asOf) {
      const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(s.asOf);
      if (m) return { label: s.asOf,
        time: (Number(m[3]) * 100 + MONTHS[m[1]]) * 100 + Number(m[2]) };
    }
    const m = /As of ([A-Z][a-z]+) (\d{1,2}),? (\d{4})/
      .exec(s.text || "");
    if (!m) return null;
    return { label: `${m[1]} ${Number(m[2])}, ${m[3]}`,
      time: (Number(m[3]) * 100 + MONTHS[m[1]]) * 100 + Number(m[2]) };
  };
  const sortedStmts = ints.statements.slice().sort((a, b) => {
    const ta = asOf(a), tb = asOf(b);
    return (b.year - a.year)
      || ((tb ? tb.time : 0) - (ta ? ta.time : 0));
  });
  /* A cleaned statement renders as its labelled fields — Income,
     Assets, Liabilities, Gifts and Personal Benefits, Offices and
     Directorships, then the Spouse / Minor Children groups — with
     the Integrity Commissioner credited on the statement itself.
     Field wording is the filing's own, verbatim. A statement
     without parsed groups falls back to its cleaned text. */
  const stmtBody = (s) => {
    if (!s.groups) return null;
    const parts = [];
    for (const g of s.groups) {
      if (g.heading) {
        parts.push(`<h4 class="pds-group">${esc(g.heading)}</h4>`);
      }
      for (const f of g.fields) {
        parts.push(`<div class="pds-field"><h4>${esc(f.label)}</h4><p>${esc(f.text)}</p></div>`);
      }
    }
    parts.push(`<p class="small pds-src">Source: Office of the Integrity Commissioner of Ontario — Members' Public Disclosure Statements.</p>`);
    return `<div class="pds">${parts.join("")}</div>`;
  };
  const stmts = sortedStmts.map((s) => {
    const a = asOf(s);
    const label = `${s.year} statement${a ? ` — as of ${a.label}` : ""}`;
    const body = stmtBody(s);
    if (body) return `<details><summary>${esc(label)}</summary>${body}</details>`;
    return docDetails(label, s.text, null, "");
  }).join("");
  const textYears = new Set(ints.statements.map((s) => s.year));
  const missingYears = (ints.years || []).filter((y) => !textYears.has(y));
  /* O-1 (audit, Oct 27, 2026): when NO texts were gathered, the old
     note rendered "Statement texts are shown for ." above an empty
     list. The no-texts case now says the true state in full and the
     empty list does not render (below). */
  const missingNote = !missingYears.length ? ""
    : ints.statements.length
    ? `<p class="small" style="max-width:44rem">Statement texts are
      shown for ${[...textYears].sort((a, b) => a - b).join(", ")}. The statements for
      ${missingYears.join(", ")} are counted from the Commissioner's
      index; their texts were not gathered for this archive.</p>`
    : `<p class="small" style="max-width:44rem">No statement texts
      were gathered for this archive. The count above comes from the
      Commissioner's published index, which counts
      ${fmtNum(ints.count)} ${ints.count === 1 ? "statement" : "statements"}
      for this member (statement years: ${missingYears.join(", ")}).</p>`;
  return `<section style="margin-top:2.4rem" aria-labelledby="interests-h">
    <h2 id="interests-h">Disclosure statements — Integrity Commissioner</h2><hr class="rule">
    <p><strong>Disclosure statements on file: ${fmtNum(ints.count)} (annual statements, 2005–present)</strong></p>
    <p class="small" style="max-width:44rem">Each statement is the
    member's annual filing to the Integrity Commissioner — income
    sources, assets, liabilities, and gifts and benefits over $200, as
    published. Ontario has no separate gift registry: gifts and
    personal benefits are declared inside these annual statements, and
    each statement shown below can be read in full. The published
    statements carry no dollar amounts, and they are snapshots by
    year, not a register of dated declarations.</p>
    ${missingNote}
    ${ints.statements.length ? `<div class="doc-list">${stmts}</div>`
      : ints.count ? ""
      : `<p>No disclosure statements on file for this member in the series gathered (2005–2025).</p>`}
    </section>`;
}


function expensesSection(p) {
  if (PCFG.layer === "canada") {
    const rows = (p.expenses || []).slice().reverse();
    if (!rows.length) return `<section style="margin-top:2.4rem" aria-labelledby="pay-h">
      <h2 id="pay-h">Pay and expenses — as published</h2><hr class="rule">
      <p class="small" style="max-width:44rem">No office-expenditure
      reports for this member in the published quarters held
      (2020–21 Q2 – 2026–27 Q1).</p></section>`;
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
  if (!exp.payments.length && !exp.annual.length)
    return `<section style="margin-top:2.4rem" aria-labelledby="pay-h">
      <h2 id="pay-h">Pay and expenses — as published</h2><hr class="rule">
      <p class="small" style="max-width:44rem">No expenses for this
      member in the published record held (payments as disclosed from
      April 2024; annual totals back to 2015–16). Ministers' expenses
      are published in a separate provincial system.</p></section>`;
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
    if (!lob) return `<section style="margin-top:2.4rem" aria-labelledby="lobbying-h">
      <h2 id="lobbying-h">Lobbying record</h2><hr class="rule">
      <p class="small" style="max-width:44rem">No communication reports
      naming this member in the registry extract (2008 – October 23,
      2026). Lobbyist registrations themselves name the institutions
      being lobbied, not individual members, so no per-member
      registration count exists to show.</p></section>`;
    const years = Object.entries(lob.byYear)
      .map(([y, n]) => `<span>${esc(y)}: <strong>${fmtNum(n)}</strong></span>`).join("");
    const listOf = (pairs) => `<ul>${pairs.map(([k, n]) =>
      `<li>${esc(k)} — ${fmtNum(n)}</li>`).join("")}</ul>`;
    // A member's reports can carry no subject strings at all in the
    // extract (113 of 931 lobbying profiles): the panel then takes
    // the N9 absence line naming the coverage instead of rendering
    // an empty box. Top organizations gets the same guard.
    const topPanel = (title, pairs, emptyLine) =>
      `<section class="profile-panel"><h3>${title}</h3>${
        pairs && pairs.length ? listOf(pairs)
          : `<p class="small">${emptyLine}</p>`}</section>`;
    return `<section style="margin-top:2.4rem" aria-labelledby="lobbying-h">
      <h2 id="lobbying-h">Lobbying record</h2><hr class="rule">
      <p class="small" style="max-width:44rem">Communication reports
      filed by registered lobbyists with the Office of the Commissioner
      of Lobbying, naming this member as the designated public office
      holder contacted — <strong>${fmtNum(lob.total)}</strong> reports,
      ${esc(lob.first)} – ${esc(lob.last)}. A report records a
      communication as reported by the lobbyist, in the registry's own
      terms. Lobbyist registrations themselves name the institutions
      being lobbied, not individual members, so no per-member
      registration count exists to show — the communication reports
      below are the per-member lobbying record.</p>
      <div class="by-year">${years}</div>
      <div class="profile-grid" style="margin-top:1.4rem">
        ${topPanel("Top subject matters", lob.topSubjects,
          "No subject matters are recorded for this member's reports in the registry extract (2008 – October 23, 2026).")}
        ${topPanel("Top organizations", lob.topOrgs,
          "No organizations are recorded for this member's reports in the registry extract (2008 – October 23, 2026).")}
      </div>
      <details id="lob-details" style="margin-top:1.2rem">
        <summary><strong>All communications, as filed (${fmtNum(lob.total)})</strong></summary>
        <div id="lob-list"><p class="small">Loading…</p></div>
        <div class="pager" id="lob-pager"></div>
      </details></section>`;
  }
  const lob = p.lobbying;
  if (!lob) return `<section style="margin-top:2.4rem" aria-labelledby="lobbying-h">
    <h2 id="lobbying-h">Lobbying registrations</h2><hr class="rule">
    <p class="small" style="max-width:44rem">${p.current
      ? `This member's office was not among the ridings searched in the
        October 2026 registry search, so no registration picture is
        shown. Ontario publishes registrations — statements of intent
        to lobby — not records of contacts or meetings.`
      : `The October 2026 registry search covered current members'
        offices only, so no registration picture was gathered for this
        earlier member. Ontario publishes registrations — statements of
        intent to lobby — not records of contacts or meetings.`}</p></section>`;
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
  /* v58: career + term participation block (data from the verified
     participation exporter; a failed load simply omits the block). */
  const partData = await loadJSON(`${PCFG.dataDir}participation.json`).catch(() => null);
  const partBlock = participationBlockHTML(
    partData ? partData.members[memberId] : null, PCFG.layer, "divisions");
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
    ["committees", "Committees & contact", "#panels-h"],
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
    ${partBlock}
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
      : `<strong>Coverage.</strong> This layer is the archive as gathered on October 20, 2026 and extended on October 27, 2026; recorded votes run from July 19, 2018 to the June 2, 2026 sitting. The 2018–2022 divisions were extracted from the Assembly's published House documents — they are not part of its official searchable record, which begins in 2022, and that span may miss a small number of divisions.`}
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
