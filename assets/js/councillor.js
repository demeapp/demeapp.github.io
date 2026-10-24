/* Councillor profile — the simple picture first (who, ward, term, one
   recorded-vote participation stat), the restored dossier panels (about, committees,
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
      ? (simpleOn()
        ? `${fmtNum(memberTotal)} recorded votes on decisions in the archive, newest first. Each row links to the decision.`
        : `${fmtNum(memberTotal)} recorded votes on decisions in the archive, newest first. Every row links to the decision itself.`)
      : (simpleOn()
        ? `${fmtNum(rows.length)} recorded votes marked ${FILTER_LABEL[outcomeFilter]}, out of ${fmtNum(memberTotal)} in this member's record.`
        : `${fmtNum(rows.length)} recorded votes marked ${FILTER_LABEL[outcomeFilter]} — out of ${fmtNum(memberTotal)} in this member’s record.`);
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
  /* Count ALL matches — the dropdown label prints this total, so it
     must be the true count, never a display cap (OE-2). Only the
     rendered list is capped, and it says so. */
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
  }
  return out;
}
/* F-3 (Oct 21): the promise dropdown previews the 3 most recent
   related votes and says so; the full list is one tap away via the
   "Show all" button, rendered from the same array the count came
   from — the label's total and the list can never disagree. */
const promiseRelated = [];
function relatedVoteRow(r) {
  return `<button class="related-vote" type="button"
    data-ref="${esc(r.ref)}"><span>${esc(r.title || r.ref)}
    <span class="rv-ref">${esc(r.ref)} · ${esc(fmtDate(r.date))}</span></span>
    ${voteChip(r.vote)}</button>`;
}
function bindRelatedVotes(scope) {
  scope.querySelectorAll(".related-vote").forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    b.addEventListener("click", () => {
      location.href = `decision.html?ref=${encodeURIComponent(b.dataset.ref)}`;
    });
  });
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
    /* Former members: stored contact details are historical — the
       phone numbers and office addresses from their time in office now
       belong to whoever holds the seat today, so they are not shown as
       live contact routes. */
    const contactPanel = !person.current
      ? `<p class="small">Historical profile — this member is no longer
          in office, and the office contact details from their time in
          office are not shown: the seat's phone number and office now
          belong to their successor.</p>`
      : contact.email || contact.phone
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
        promiseRelated[i] = related;
        return `<article class="promise-card">
          <p class="promise-num">Campaign promise ${i + 1}</p>
          <p>${esc(pr.text)}</p>
          ${pr.source ? `<a class="promise-source" href="${esc(pr.source)}"
            target="_blank" rel="noopener noreferrer">View campaign source ↗<span class="visually-hidden"> (opens in a new tab)</span></a>` : ""}
          ${related.length ? `<details class="related-votes">
            <summary>Related votes in the record (${related.length})</summary>
            <div class="related-list">
            ${related.slice(0, 3).map(relatedVoteRow).join("")}
            </div>
            ${related.length > 3 ? `<p class="small related-note" style="margin:.45rem 0 0" tabindex="-1" aria-live="polite">${simpleOn() ? `Showing 3 of ${related.length} matching votes, newest first.` : `Showing 3 of ${related.length} matching votes — the most recent first.`}</p>
            <button class="related-more" type="button" data-promise="${i}">Show all ${related.length} matching votes</button>` : ""}
          </details>` : ""}
        </article>`;
      }).join("");
      html += `<section style="margin-top:2.4rem" aria-labelledby="promises-h">
        <h2 id="promises-h">Campaign promises</h2><hr class="rule">
        <p class="small" style="max-width:44rem">Promises are carried from the campaign material each member published, with the source kept beside the words. Related votes are matched by topic from this member’s recorded votes — a finding aid, not a verdict on whether a promise was kept.</p>
        <div class="promise-list">${cards}</div></section>`;
    } else {
      html += `<section style="margin-top:2.4rem" aria-labelledby="promises-h">
        <h2 id="promises-h">Campaign promises</h2><hr class="rule">
        <p class="small">No campaign promises on record for this member.</p>
        </section>`;
    }
  }
  /* ---------- lobbying record (public registry exports only) ------ */
  /* By-year breakdown (WS2b display fix, Oct 23): "years" in the
     refreshed lobbying.json carries DATED-year counts only, and each
     member now carries "undated" — the registry communications with
     no date, which sit in the reconciled total but in no year.
     Rendering the years WITH the explicit "Date not reported:
     N communications" line (only when undated > 0) makes
     dated + undated = total reconcile on the page. That resolves
     audit H-02 (Oct 23): the by-year breakdown was previously
     suppressed because the undated share (3,362 of 49,658
     communications, across 55 of 94 members) was invisible, so the
     years alone undercounted against the total.
     The per-communication list comes from record-data/lob/<slug>.json,
     loaded per member here like the other sections below; when that
     file is absent or fails to load, the section renders exactly as
     it did without it — the summary stands on lobbying.json alone.
     The snapshot date is read from the loaded data (lobbying.snapshot)
     in both text modes, never hard-coded. */
  const LOB_CAP = 10;
  let lobComms = [];
  const lobCommRow = (c) => {
    const who = [c.lobbyist, c.organization].filter(Boolean).join(" · ");
    const meta = [c.date ? fmtDate(c.date) : "Date not reported", c.method]
      .filter(Boolean).join(" · ");
    return `<li><span class="h-title">${esc(c.subject || "")}
      <span class="h-meta">${esc(meta)}</span>
      ${who ? `<span class="h-meta">${esc(who)}</span>` : ""}
      ${c.client ? `<span class="h-meta">Client: ${esc(c.client)}</span>` : ""}
      </span></li>`;
  };
  if (lobbying && lobbying.total > 0) {
    try {
      const detail = await loadJSON(dataPath(`lob/${person.slug}.json`));
      lobComms = (detail && detail.communications) || [];
    } catch (e) { lobComms = []; /* the summary stands without the list */ }
    const methods = Object.entries(lobbying.methods || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `<li><span>${esc(k)}</span><b>${fmtNum(n)}</b></li>`).join("");
    const undated = lobbying.undated || 0;
    const years = (lobbying.years || []).filter((y) => y.count > 0);
    const yearsHTML = (years.length || undated > 0) ? `<div><h3>Communications by year</h3>
            ${years.length ? `<ul class="lob-list">${years.map((y) =>
              `<li><span>${esc(y.year)}</span><b>${fmtNum(y.count)}</b></li>`).join("")}</ul>` : ""}
            ${undated > 0 ? `<p class="small" style="margin:.5rem 0 0">Date not reported: ${fmtNum(undated)} communications</p>` : ""}
          </div>` : "";
    const commsHTML = lobComms.length ? `
        <div class="lob-comms">
          <h3>All communications, as filed</h3>
          <ul class="personlist history-rows lob-comms-list">${lobComms.slice(0, LOB_CAP).map(lobCommRow).join("")}</ul>
          ${lobComms.length > LOB_CAP ? `<p class="small lob-comms-note" style="margin:.45rem 0 0" tabindex="-1" aria-live="polite">${simpleOn() ? `Showing ${LOB_CAP} of ${fmtNum(lobComms.length)} communications, newest first.` : `Showing ${LOB_CAP} of ${fmtNum(lobComms.length)} communications — the most recent first.`}</p>
          <button class="related-more lob-more" type="button">Show all ${fmtNum(lobComms.length)} communications</button>` : ""}
        </div>` : "";
    html += `<section class="lobbying" aria-labelledby="lobbying-h">
      <h2 id="lobbying-h" class="visually-hidden">Lobbying Record</h2>
      <details>
        <summary>Lobbying Record
          <span class="pill">${fmtNum(lobbying.total)} communications</span></summary>
        <p class="lob-lede">Lobbyists must file every communication with a member of Council — any contact a registered lobbyist reported naming this member, whether a meeting, a call or an email. It records the lobbyist's activity, not anything the member sought or did, and is never a claim about influence.</p>
        <div class="lob-stats">
          <div class="stat"><span class="num">${fmtNum(lobbying.total)}</span>
            <span class="lab">Communications filed, ${esc(fmtDate(lobbying.first))} to ${esc(fmtDate(lobbying.last))}</span></div>
          <div class="stat"><span class="num">${fmtNum(lobbying.term)}</span>
            <span class="lab">Filed in the current term (2022–2026)</span></div>
          <div class="stat"><span class="num">${fmtNum(lobbying.lobbyists)}</span>
            <span class="lab">Different lobbyists · ${fmtNum(lobbying.clients)} clients ·
            ${fmtNum(lobbying.subjects)} subject matters</span></div>
        </div>
        <div class="lob-cols">
          <div><h3>Top subject matters</h3>
            <ul class="lob-list">${lobbying.top.map((t) =>
              `<li><span>${esc(t.label)}</span><b>${fmtNum(t.count)}</b></li>`).join("")}</ul></div>
          <div>${methods ? `<h3>How contact was made</h3>
            <ul class="lob-list">${methods}</ul>` : ""}
          </div>
          ${yearsHTML}
        </div>
        ${commsHTML}
        <p class="lob-note">${simpleOn()
          ? `These counts come from reports filed in the City of Toronto Lobbyist Registry. They are grouped by the member named in the report. A contact with a member's staff is not counted here. Registry snapshot: ${esc(fmtDate(lobbying.snapshot))}. Source:`
          : `Counts are communications as filed in the City of Toronto Lobbyist Registry, grouped to the member the filing names — a contact with a member’s staff is not counted here. Registry snapshot: ${esc(fmtDate(lobbying.snapshot))}. Source:`}
        <a href="https://open.toronto.ca/dataset/lobbyist-registry/" target="_blank" rel="noopener noreferrer">City of Toronto Lobbyist Registry (Open Data)<span class="visually-hidden"> (opens in a new tab)</span></a>.</p>
      </details></section>`;
  } else if (lobbying) {
    html += `<section class="lobbying" aria-labelledby="lobbying-h">
      <h2 id="lobbying-h">Lobbying Record</h2><hr class="rule">
      <p class="small" style="max-width:44rem">${simpleOn()
        ? `No lobbying contacts for ${esc(person.name)} were found in the City of Toronto Lobbyist Registry filings gathered on ${esc(fmtDate(lobbying.snapshot))}.`
        : `No recorded lobbying communications for ${esc(person.name)} in the City of Toronto Lobbyist Registry filings gathered on ${esc(fmtDate(lobbying.snapshot))}.`}</p></section>`;
  }
  host.innerHTML = html;
  bindRelatedVotes(host);
  host.querySelectorAll(".related-more").forEach((btn) =>
    btn.addEventListener("click", () => {
      const all = promiseRelated[Number(btn.dataset.promise)] || [];
      const details = btn.closest("details.related-votes");
      const list = details && details.querySelector(".related-list");
      if (!list || all.length <= 3) { btn.remove(); return; }
      list.insertAdjacentHTML("beforeend",
        all.slice(3).map(relatedVoteRow).join(""));
      bindRelatedVotes(list);
      const note = details.querySelector(".related-note");
      if (note) {
        note.textContent =
          simpleOn()
            ? `Showing all ${all.length} matching votes, newest first.`
            : `Showing all ${all.length} matching votes — the most recent first.`;
        /* WCAG fix wave (M-3): the button removes itself; move focus to
           the updated note (focusable + live region) instead of body. */
        note.focus();
      }
      btn.remove();
    }));
  /* Lobbying communications expander: same interaction as the
     related-votes "Show all" above — the capped list grows in place
     from the same array the count came from, and the M-3 focus
     behaviour applies identically (button removes itself, focus
     moves to the updated note). */
  host.querySelectorAll(".lob-more").forEach((btn) =>
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".lob-comms");
      const list = wrap && wrap.querySelector(".lob-comms-list");
      if (!list || lobComms.length <= LOB_CAP) { btn.remove(); return; }
      list.insertAdjacentHTML("beforeend",
        lobComms.slice(LOB_CAP).map(lobCommRow).join(""));
      const note = wrap.querySelector(".lob-comms-note");
      if (note) {
        note.textContent =
          simpleOn()
            ? `Showing all ${fmtNum(lobComms.length)} communications, newest first.`
            : `Showing all ${fmtNum(lobComms.length)} communications — the most recent first.`;
        note.focus();
      }
      btn.remove();
    }));
}

/* ---------- declared interests: the official register ----------
   The City Clerk's published register (record-data/declared-
   interests.json) and the Integrity Commissioner's gift disclosures
   (record-data/gift-disclosures.json), lazy-loaded only when a
   member page renders this section — the same per-member loading
   pattern as the lobbying record above. This register is a separate
   record from the recorded-vote interest count in the stat tiles:
   that count comes from votes where the member declared an interest
   and did not vote. A member with no matched register entries gets
   NO register section at all — absence here only means no matched
   records in the published files, never a claim of "no declarations".
   The gifts block is independent of the register section: it renders
   whenever the member has gift disclosures — inside the register
   section when that renders, and standing alone (under its own
   heading, with its own Gift Disclosure Registry source line) when
   it does not. */
async function renderDeclaredInterests(person) {
  const host = document.getElementById("declared-interests");
  if (!host) return;
  let entries = null, entriesLoaded = false;
  try {
    const data = await loadJSON(dataPath("declared-interests.json"));
    entries = (data.members || {})[person.slug] || null;
    entriesLoaded = true;
  } catch (e) { entries = null; /* the record stands without the register */ }
  let gifts = null, giftsLoaded = false;
  try {
    const gdata = await loadJSON(dataPath("gift-disclosures.json"));
    gifts = (gdata.members || {})[person.slug] || null;
    giftsLoaded = true;
  } catch (e) { gifts = null; }
  const hasEntries = !!(entries && entries.length);
  const hasGifts = !!(gifts && gifts.length);
  const hasVoteInterests = (person.interest || 0) > 0;
  /* Wave A display fix (Fix 4): service that ended before the gift
     registry begins (2011) has no gifts record because none was
     published — not-published, not a zero. */
  const giftsEraNA = !hasGifts && !!person.lastSeen && person.lastSeen < "2011-01-01";
  const giftsNaHTML = giftsEraNA ? `<h3 style="margin-top:1.8rem">Gifts and benefits disclosed</h3>
    <p class="small" style="max-width:44rem">${simpleOn()
      ? `No gift list was published while ${esc(person.name)} served — the Gift Disclosure Registry starts in 2011, after their service ended. So there is no gifts record to show. That is not the same as saying they disclosed nothing: no registry existed then.`
      : `No gift registry was published during ${esc(person.name)}'s service — the Gift Disclosure Registry begins in 2011, after their service ended — so there is no gifts record to show. That is not a record of zero disclosures: no registry existed to disclose into.`}</p>` : "";
  if (!hasEntries && !hasGifts && !hasVoteInterests) {
    /* Wave A display fix (Fix 2): both files loaded and hold nothing for
       this member — a verified zero in the published registers. Say so;
       never leave the absence unexplained. On load failure the section
       stays silent, as before: a failure is not a zero. */
    if (entriesLoaded && giftsLoaded) {
      host.innerHTML = `<section style="margin-top:2.4rem" aria-labelledby="declared-interests-h">
    <h2 id="declared-interests-h">Declared interests — the official register</h2><hr class="rule">
    <p class="small" style="max-width:44rem">${simpleOn()
      ? `No declaration for ${esc(person.name)} appears in the City Clerk's published list (2007–2026)${giftsEraNA ? "." : ", and no gifts for them appear in the Gift Disclosure Registry (2011–2025)."} That is what the published record shows — not a gap in this page.`
      : `No declaration by ${esc(person.name)} appears in the City Clerk's published register (2007–2026)${giftsEraNA ? "." : ", and no gift disclosures for them appear in the Gift Disclosure Registry (2011–2025)."} Both published files were checked for this page; the absence is the record, not a gap in it.`}</p>
    ${giftsNaHTML}
    <p class="small" style="max-width:44rem;margin-top:1rem">Source: City Clerk's Office · Registry of Declared Interest (published 2007–2026; the City publishes no declarations dated 2006 or earlier) + Gift Disclosure Registry (published 2011–2025; 2026 not yet published) (Integrity Commissioner) · Open Data refreshed September 26, 2026</p>
  </section>`;
    }
    return;
  }
  const rows = hasEntries ? entries.map((r) => {
    const meta = [fmtDate(r.VerbalDeclarationDate), r.Committee, r.Item]
      .filter(Boolean).join(" · ");
    return `<li><span class="h-title">${esc(r.ItemTitle || r.Item || "")}
      <span class="h-meta">${esc(meta)}</span>
      ${r.VerbalDeclaration ? `<span class="h-meta">Interest as recorded: ${esc(r.VerbalDeclaration)}</span>` : ""}
      ${r.capacityNote ? `<span class="h-meta">${esc(r.capacityNote)}</span>` : ""}
      ${r.WrittenDeclaration ? `<span class="h-meta"><a href="${esc(r.WrittenDeclaration)}" target="_blank" rel="noopener noreferrer">Written declaration (PDF)<span class="visually-hidden"> (opens in a new tab)</span></a></span>` : ""}
      </span></li>`;
  }).join("") : "";
  let giftsBody = "";
  if (hasGifts) {
    const grows = gifts.map((g) => {
      const meta = [g.registryYear, g.date, g.type]
        .filter(Boolean).join(" · ");
      const donor = g.donorSponsor ? `Donor / sponsor: ${esc(g.donorSponsor)} · ` : "";
      return `<li><span class="h-title">${esc(g.details || "")}
        <span class="h-meta">${esc(meta)}</span>
        <span class="h-meta">${donor}Value as published: ${esc(g.valueAsPublished || "")}${g.incompleteOrUnapproved ? " (marked incomplete and/or not approved in the registry, as published)" : ""}</span>
        ${g.valueDetailUrl ? `<span class="h-meta"><a href="${esc(g.valueDetailUrl)}" target="_blank" rel="noopener noreferrer">Disclosure statement (PDF)<span class="visually-hidden"> (opens in a new tab)</span></a></span>` : ""}
        </span></li>`;
    }).join("");
    giftsBody = `<p class="small" style="max-width:44rem">Gifts and benefits this member disclosed, as published in the Integrity Commissioner's Gift Disclosure Registry. Values are as published.</p>
      <ul class="personlist history-rows">${grows}</ul>`;
  }
  const regN = entries ? entries.length : 0;
  const giftN = gifts ? gifts.length : 0;
  const countsLine = `<p class="small" style="max-width:44rem">${simpleOn()
    ? `<strong>Served on this page:</strong> ${fmtNum(regN)} ${regN === 1 ? "entry" : "entries"} from the City Clerk's official list${giftsEraNA ? "" : ` and ${fmtNum(giftN)} gift ${giftN === 1 ? "disclosure" : "disclosures"}`} — two separate lists, counted on their own, never added together.`
    : `<strong>Served on this page:</strong> ${fmtNum(regN)} ${regN === 1 ? "entry" : "entries"} from the official register${giftsEraNA ? "" : ` · ${fmtNum(giftN)} gift ${giftN === 1 ? "disclosure" : "disclosures"}`} — separate records, counted separately, never added together.`}</p>`;
  if (hasEntries || hasVoteInterests) {
    const giftsHTML = hasGifts
      ? `<h3 style="margin-top:1.8rem">Gifts and benefits disclosed</h3>
      ${giftsBody}`
      : giftsNaHTML;
    host.innerHTML = `<section style="margin-top:2.4rem" aria-labelledby="declared-interests-h">
    <h2 id="declared-interests-h">Declared interests — the official register</h2><hr class="rule">
    <p class="small" style="max-width:44rem">${simpleOn()
      ? `This is the City Clerk's official list — the interests ${esc(person.name)} declared on the record, one item at a time. It is not the same as the recorded-vote count above. That count comes from recorded votes where the member declared an interest and did not vote. The two lists count different things, so their totals will not match. A member can declare an interest out loud in the chamber and still not appear in this list. The vote record above may show a declaration that this list does not have.`
      : `The City Clerk's official register — the declarations ${esc(person.name)} made on the record, item by item. It is separate from the recorded-vote count above it, counted from recorded votes where the member declared an interest and did not vote; the two count different things and their totals will not match. <strong>This register is the City Clerk's published file of declarations. A declaration made out loud in the chamber — for example under Article 8 of the Code of Conduct — may not appear in that file, so this list can miss a declaration that the vote record shows.</strong>`}</p>
    ${countsLine}
    ${hasEntries ? `<ul class="personlist history-rows">${rows}</ul>` : `<p class="small">${simpleOn() ? `No declaration for ${esc(person.name)} appears in the City Clerk's published list. The vote count above records declarations made on votes, including ones said out loud in the chamber, that may be missing from this list.` : `No declaration by ${esc(person.name)} appears in the City Clerk's published register file. The recorded-vote count above counts declarations recorded on votes, including declarations made out loud in the chamber, which the published file can miss.`}</p>`}
    ${giftsHTML}
    <p class="small" style="max-width:44rem;margin-top:1rem">Source: City Clerk's Office · Registry of Declared Interest (published 2007–2026; the City publishes no declarations dated 2006 or earlier) + Gift Disclosure Registry (published 2011–2025; 2026 not yet published) (Integrity Commissioner) · Open Data refreshed September 26, 2026</p>
  </section>`;
    return;
  }
  /* Gifts only — no matched register entries: the gifts block stands
     alone in the same page area, under its own heading and its own
     Gift Disclosure Registry source line. It speaks only to the
     gifts record and says nothing about the member's declarations. */
  host.innerHTML = `<section style="margin-top:2.4rem" aria-labelledby="gift-disclosures-h">
    <h2 id="gift-disclosures-h">Gifts and benefits disclosed</h2><hr class="rule">
    ${entriesLoaded ? `<p class="small" style="max-width:44rem">${simpleOn()
      ? `The City Clerk's published list has no declaration for ${esc(person.name)} (2007–2026). The gifts below come from a different list, the Gift Disclosure Registry.`
      : `No declaration by ${esc(person.name)} appears in the City Clerk's published register (2007–2026) — a verified zero in that file. The gifts below are the separate Gift Disclosure Registry record.`}</p>` : ""}
    ${countsLine}
    ${giftsBody}
    <p class="small" style="max-width:44rem;margin-top:1rem">Source: Gift Disclosure Registry (Integrity Commissioner) · published 2011–2025 (no registry was published for 2010 or earlier; 2026 not yet published) · Open Data refreshed September 26, 2026</p>
  </section>`;
}

/* The interest counter reads only vote rows the source flags
   Absent(Interest Declared) — a flag that exists only from June 2023
   (earlier declarations were recorded as ordinary absences). A member
   whose service ended before the flag era has no counter to print:
   the directory's dash, never an unsupported 0. */
const interestBeforeRecord = (person) =>
  !!person.lastSeen && person.lastSeen < "2023-06-01";
const interestFigure = (person) =>
  interestBeforeRecord(person) ? "—" : fmtNum(person.interest);

/* ---------- pay and expenses: as published ----------
   The City Clerk's annual remuneration reports (record-data/
   expenses.json), lazy-loaded only when a member page renders this
   section — the same per-member loading pattern as the declared-
   interests section above. Figures are shown exactly as published,
   one block per published table, under that table's own label; the
   site never adds tables together, and a field the report leaves
   blank is simply not shown (never shown as zero). A member with no
   matched records gets NO section at all — and a year with no record
   has no row, which says nothing about that year's spending.
   The second layer (record-data/expenses-detail.json) is the City
   Clerk's Council Expense Routine Disclosure — constituency services
   and office expenses by category, from 2013 — rendered below the
   annual figures under its own heading and source line. It is a
   separate publication with a narrower scope (office spending only),
   so the two layers are never added together; invoice-level documents
   stay on the City's site and category amounts link out to them. */
const EXPENSE_TABLE_LABEL = {
  "Summary": "Summary table",
  "Attachment 1": "Office budget detail (Attachment 1)",
  "Appendix A": "Remuneration and benefits detail (Appendix A)",
  "Appendix G": "Remuneration and benefits (Appendix G, 2000)",
};
const EXPENSE_FIELDS = [
  ["remuneration", "Salary"],
  ["benefits", "Benefits"],
  ["severance", "Severance"],
  ["fringeBenefits", "Fringe benefits"],
  ["remunerationAndBenefits", "Remuneration and benefits"],
  ["remunerationAndBenefitsPaidByCity", "City-paid total"],
  ["supportStaffSalaries", "Support staff salaries"],
  ["supportStaffSalariesAndBenefits", "Support staff salaries and benefits"],
  ["officeExpenses", "Office expenses"],
  ["expensesFromCouncilGeneralBudget", "Expenses from Council general budget"],
  ["corporateBusinessTravel", "Corporate business travel"],
  ["expensesChargedToCityDivisions", "Expenses charged to City divisions"],
  ["expensesPaidByAgenciesBoardsAndOtherBodies", "Expenses paid by agencies, boards and other bodies"],
  ["expensesPaidByAgenciesCorporationsAndOtherBodies", "Expenses paid by agencies, corporations and other bodies"],
  ["remunerationPaidByAgenciesCorporationsAndOtherBodies", "Paid by agencies, corporations and other bodies"],
  ["remunerationPaidByLocalBoards", "Paid by local boards"],
  ["totalRemunerationAndBenefits", "Total remuneration and benefits"],
  ["totalRemunerationExpenseIndemnityAndBenefits", "Total"],
  ["totalRemunerationAndExpenses", "Total"],
];
const fmtMoney = (n) => (n < 0 ? "-$" : "$") + fmtNum(Math.abs(n));
const DETAIL_HUB = "https://www.toronto.ca/city-government/council/budgets-and-expense-reports/council-expense-routine-disclosure/";
async function renderPayExpenses(person) {
  const host = document.getElementById("pay-expenses");
  if (!host) return;
  let records = null;
  try {
    const data = await loadJSON(dataPath("expenses.json"));
    records = (data.members || {})[person.slug] || null;
  } catch (e) { records = null; /* the record stands without the figures */ }
  let detail = null, detailSource = null;
  try {
    const ddata = await loadJSON(dataPath("expenses-detail.json"));
    detail = (ddata.members || {})[person.slug] || null;
    detailSource = ddata.source || null;
  } catch (e) { detail = null; /* the annual layer stands without the detail */ }
  const hasAnnual = !!(records && records.length);
  const hasDetail = !!(detail && detail.length);
  if (!hasAnnual && !hasDetail) return;

  let annualHTML = "";
  if (hasAnnual) {
    const years = [];
    const byYear = new Map();
    for (const r of records) {
      if (!byYear.has(r.year)) { byYear.set(r.year, []); years.push(r.year); }
      byYear.get(r.year).push(r);
    }
    const blockHTML = (r) => {
      const label = EXPENSE_TABLE_LABEL[r.table] || r.table;
      const meta = [r.period, r.ward != null ? `Ward ${r.ward}` : ""]
        .filter(Boolean).join(" · ");
      const rows = EXPENSE_FIELDS
        .filter(([k]) => r[k] != null)
        .map(([k, lab]) => `<li><span>${esc(lab)}</span><b>${esc(fmtMoney(r[k]))}</b></li>`)
        .join("");
      return `<div style="margin-top:1.1rem">
      <p style="margin:0 0 .4rem"><strong>${esc(label)}</strong>
      ${meta ? `<span class="small">· ${esc(meta)}</span>` : ""}</p>
      ${rows ? `<ul class="lob-list">${rows}</ul>` : ""}
      ${r.correctionNote ? `<p class="small" style="max-width:44rem;margin-top:.5rem">${esc(r.correctionNote)}</p>` : ""}
      ${r.extractionNote ? `<p class="small" style="max-width:44rem;margin-top:.5rem">${esc(r.extractionNote)}</p>` : ""}
      ${r.sourceUrl ? `<p class="small" style="margin-top:.5rem"><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${r.sourceUrl.includes(".pdf") ? "Report (PDF)" : "Source at the City of Toronto"}<span class="visually-hidden"> (opens in a new tab)</span></a></p>` : ""}
    </div>`;
    };
    const maxAnnualYear = Math.max(...years.map((y) => Number(y)));
    annualHTML = years.map((y) =>
      `<details class="pay-year"${Number(y) === maxAnnualYear ? " open" : ""}><summary><h3>${esc(y)}</h3></summary>`
      + byYear.get(y).map(blockHTML).join("") + `</details>`).join("");
  }

  let detailHTML = "";
  if (hasDetail) {
    const catRow = (r, c) => {
      const link = (r.cityCouncillorId != null && c.categoryId != null && c.count > 0)
        ? `${DETAIL_HUB}#TCER2FrontEndEmbedded_tcer2categoryRep/0/${r.cityCouncillorId}/${c.categoryId}`
        : null;
      const amt = link
        ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(fmtMoney(c.amount))}<span class="visually-hidden"> — invoices for this category on the City's site (opens in a new tab)</span></a>`
        : esc(fmtMoney(c.amount));
      return `<li><span>${esc(c.description)}</span><b>${amt}</b></li>`;
    };
    const detailBlock = (r) => {
      const meta = [r.period, r.ward != null ? `Ward ${r.ward}` : ""]
        .filter(Boolean).join(" · ");
      const rows = [
        r.officeExpense != null
          ? `<li><span>Constituency services &amp; office expenses — total for the period</span><b>${esc(fmtMoney(r.officeExpense))}</b></li>`
          : "",
        ...(r.categories || []).map((c) => catRow(r, c)),
      ].join("");
      const personal = (r.personalFunds != null && r.personalFunds !== 0)
        ? `<p style="margin:.7rem 0 .4rem"><strong>Paid from personal funds</strong>
      <span class="small">· the member's own money, as the City reports it</span></p>
      <ul class="lob-list"><li><span>Personal funds — total</span><b>${esc(fmtMoney(r.personalFunds))}</b></li>${(r.personalFundsCategories || []).map((c) => catRow(r, c)).join("")}</ul>`
        : "";
      return `<div style="margin-top:1.1rem">
      <p style="margin:0 0 .4rem"><strong>Office-expense detail (routine disclosure)</strong>
      ${meta ? `<span class="small">· ${esc(meta)}</span>` : ""}</p>
      ${rows ? `<ul class="lob-list">${rows}</ul>` : ""}
      ${personal}
      ${r.nameChangeNote ? `<p class="small" style="max-width:44rem;margin-top:.5rem">${esc(r.nameChangeNote)}</p>` : ""}
      ${r.sourceUrl ? `<p class="small" style="margin-top:.5rem"><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">This period on the City's disclosure site<span class="visually-hidden"> (opens in a new tab)</span></a></p>` : ""}
    </div>`;
    };
    const dyears = [];
    const dByYear = new Map();
    for (const r of detail) {
      if (!dByYear.has(r.year)) { dByYear.set(r.year, []); dyears.push(r.year); }
      dByYear.get(r.year).push(r);
    }
    const maxDetailYear = Math.max(...dyears.map((y) => Number(y)));
    detailHTML = `<h3 style="margin-top:2.2rem">${simpleT("Office-expense detail — routine disclosure", "Office spending detail")}</h3>
    <p class="small" style="max-width:44rem">${simpleT("The City Clerk also publishes each member's constituency services and office expenses in a routine disclosure, posted quarterly from 2013 and broken down by category. It is a separate publication from the annual reports, with a narrower scope — office spending only, not pay, benefits or staff salaries — so its figures stand on their own and are never added to the annual figures. The invoice documents themselves stay on the City's site; a category amount links to its invoices there.", "The City also posts each member's office spending by category. It has been posted every quarter since 2013. This is a different report from the yearly ones. It covers office spending only — not pay or staff. Its numbers stand on their own and are never added to the yearly numbers. The invoices stay on the City's site. A category amount links to its invoices there.")}</p>`
      + dyears.map((y) =>
        `<details class="pay-year"${Number(y) === maxDetailYear ? " open" : ""}><summary><h4>${esc(y)}</h4></summary>`
        + dByYear.get(y).map(detailBlock).join("") + `</details>`).join("");
  }

  const intro = hasAnnual
    ? simpleT("These are the figures from the City Clerk's annual remuneration reports, shown as published. A year's figures can appear in more than one published table; each table is shown under its own label, and the site never adds the tables together. Annual reports are included for 1999–2025. The City published the same annual series back to 1998, but no per-member 1998 report could be located, so 1998 is not included. The City's quarterly routine disclosure of office expenses, published from 2013, is included below the annual figures under its own heading.", "These numbers come from the City Clerk's yearly pay reports. They are shown as published. One year's numbers can show up in more than one table. Each table is shown under its own name. The site never adds the tables together. Yearly reports run from 1999 to 2025. The City also published a yearly report for 1998, but no copy with each member's numbers could be found, so 1998 is not included. The City's office-expense detail, posted every quarter from 2013, is included below, under its own heading.")
    : simpleT("These figures come from the City Clerk's Council Expense Routine Disclosure, shown as published.", "These figures come from the City Clerk's office-expense disclosure. They are shown as published.");
  host.innerHTML = `<section style="margin-top:2.4rem" aria-labelledby="pay-expenses-h">
    <h2 id="pay-expenses-h">Pay and expenses — as published</h2><hr class="rule">
    <p class="small" style="max-width:44rem">${intro}</p>
    ${annualHTML}
    ${detailHTML}
    ${hasAnnual ? `<p class="small" style="max-width:44rem;margin-top:1rem">Source: City Clerk's Office · Annual Remuneration Reports (Budgets &amp; Expense Reports) · Verified October 23, 2026</p>` : ""}
    ${hasDetail ? `<p class="small" style="max-width:44rem;margin-top:.3rem">Source: City Clerk's Office · Council Expense Routine Disclosure (Constituency Services &amp; Office Expenses) · Verified ${esc((detailSource && detailSource.verified) || "")}</p>` : ""}
  </section>`;
}

/* ---------- Improvement 3: "Have your say" ---------------------
   The action block at the foot of the member page: the member's
   public office contact routes (the same profiles.json contact data
   as the dossier panel — never anything the record doesn't carry)
   and a plain-language route to speaking at a committee, linking
   only to the City's official pages. */
const CITY_MEMBERS_URL = "https://www.toronto.ca/city-government/council/members-of-council/";
const CITY_MEETINGS_URL = "https://secure.toronto.ca/council/";
const CITY_SPEAK_URL = "https://www.toronto.ca/city-government/council/council-committee-meetings/participate/";
async function renderHaveYourSay(person) {
  const host = document.getElementById("have-your-say");
  if (!host) return;
  let profile = null;
  try { profile = (await loadJSON(dataPath("profiles.json")))[person.slug] || null; }
  catch (e) { /* the block stands on the City links alone */ }
  const contact = (profile && profile.contact) || {};
  const phoneHref = String(contact.phone || "").replace(/[^0-9+]/g, "");
  const where = person.ward
    ? `Ward ${person.ward} — ${esc(person.wardName)}` : "Toronto";
  /* Former members never get the stored contact panel: those details
     are historical and the numbers now reach the successor's office. */
  const contactPanel = (person.current && (contact.email || contact.phone))
    ? `<div class="contact-lines">
          ${contact.email ? `<span>Email: <a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></span>` : ""}
          ${contact.phone ? `<span>Phone: <a href="tel:${esc(phoneHref)}">${esc(contact.phone)}</a></span>` : ""}
        </div>
        ${contact.email ? `<a class="btn secondary" href="mailto:${esc(contact.email)}">Email the office</a>
        <p class="email-helper">Opens your email app with the office address
        filled in. Deme does not send or read the message.</p>` : ""}`
    : `<p class="small">No public office contact details for this member
        are listed in the record. To reach the office that holds the seat
        today, use the City's official
        <a href="${CITY_MEMBERS_URL}" target="_blank" rel="noopener noreferrer">members of Council directory<span class="visually-hidden"> (opens in a new tab)</span></a>.</p>`;
  const intro = person.current
    ? (simpleOn()
      ? `The record above shows what ${esc(person.name)} decided and how they voted. If you live in ${where}, this person represents you at City Hall. How to reach their office is below. While an item is still being decided, you can also speak to the committee yourself.`
      : `The record above is what ${esc(person.name)} decided and how they voted. If you live in ${where}, this is your representative at City Hall — the office route is below. While an item is still being decided, you can speak to the committee considering it yourself.`)
    : `${esc(person.name)} no longer sits on Council, so the office that
       held this seat has changed hands — the City's
       <a href="${CITY_MEMBERS_URL}" target="_blank" rel="noopener noreferrer">members of Council directory<span class="visually-hidden"> (opens in a new tab)</span></a>
       reaches the office that holds it today. The committee route below
       still applies to the questions this record covers.`;
  host.innerHTML = `<section class="hys" aria-labelledby="hys-h">
    <h2 id="hys-h">Have your say</h2><hr class="rule">
    <p class="lede-line">${intro}</p>
    <div class="hys-grid">
      <section class="profile-panel" aria-labelledby="hys-contact-h">
        <h3 id="hys-contact-h">Reach the office</h3>
        <p class="intro">Public office contact details, as listed in the record.</p>
        ${contactPanel}</section>
      <section class="profile-panel" aria-labelledby="hys-speak-h">
        <h3 id="hys-speak-h">Speak at a committee</h3>
        <p class="intro">Most Council decisions start at a committee —
        and residents can address it directly.</p>
        <ol class="hys-steps">
          <li><span class="hys-num" aria-hidden="true">1</span>
            <p><span class="step-h">Find the item.</span>
            Look it up on the City's
            <a href="${CITY_MEETINGS_URL}" target="_blank" rel="noopener noreferrer">meeting portal<span class="visually-hidden"> (opens in a new tab)</span></a>
            and note which committee is hearing it, and when.</p></li>
          <li><span class="hys-num" aria-hidden="true">2</span>
            <p><span class="step-h">Ask to speak.</span>
            Tell the City Clerk you want to speak on the item — anyone
            can. The City's page on
            <a href="${CITY_SPEAK_URL}" target="_blank" rel="noopener noreferrer">participating in council and committee meetings<span class="visually-hidden"> (opens in a new tab)</span></a>
            sets out how to register — you are asked to register by
            4:30 p.m. the day before the meeting. Written comments can
            be sent instead, and become part of the public record.</p></li>
          <li><span class="hys-num" aria-hidden="true">3</span>
            <p><span class="step-h">Say your piece.</span>
            Public presentations are limited to five minutes. Say who you are, where you live, and what you are asking the committee to do.</p></li>
        </ol>
      </section>
    </div>
  </section>`;
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
  const beforeRecord = interestBeforeRecord(person);
  const total = cast + absent + interest;
  if (!total) return "";
  const pct = (n) => (100 * n / total);
  const pctTxt = (n) => {
    /* One rounding rule everywhere (OE-8): exactly one decimal,
       matching the stat tiles — never a bare "88" beside a tile's
       "88.5". The tiny-value case keeps its honest "<0.1". */
    const p = pct(n);
    return p > 0 && p < 0.05 ? "<0.1" : p.toFixed(1);
  };
  const seg = (n, cls) => n > 0
    ? `<span class="comp-seg ${cls}" style="width:${pct(n).toFixed(2)}%"></span>` : "";
  return `<div class="composition">
    <div class="comp-bar" role="img" aria-label="${simpleOn()
      ? (beforeRecord
        ? `Of ${fmtNum(total)} recorded votes in this member's record: ${fmtNum(cast)} they voted on, ${fmtNum(absent)} they were absent for.`
        : `Of ${fmtNum(total)} recorded votes in this member's record: ${fmtNum(cast)} they voted on, ${fmtNum(absent)} they were absent for, ${fmtNum(interest)} with an interest declared.`)
      : (beforeRecord
        ? `Of ${fmtNum(total)} recorded votes in this member's record: ${fmtNum(cast)} cast, ${fmtNum(absent)} absent.`
        : `Of ${fmtNum(total)} recorded votes in this member's record: ${fmtNum(cast)} cast, ${fmtNum(absent)} absent, ${fmtNum(interest)} with an interest declared.`)}">
      ${seg(cast, "cast")}${seg(absent, "absent")}${seg(interest, "interest")}
    </div>
    <p class="comp-legend">${simpleOn()
      ? (beforeRecord
        ? `Of the ${fmtNum(total)} recorded votes in their record (member totals back to 2006; votes with names from 2018): <strong>${pctTxt(cast)}%</strong> they voted · <strong>${pctTxt(absent)}%</strong> they were absent.`
        : `Of the ${fmtNum(total)} recorded votes in their record (member totals back to 2006; votes with names from 2018): <strong>${pctTxt(cast)}%</strong> they voted · <strong>${pctTxt(absent)}%</strong> they were absent · <strong>${pctTxt(interest)}%</strong> they declared an interest — the record flags these only from June 2023. Declaring an interest is a duty, not a missed vote.`)
      : (beforeRecord
        ? `Of the ${fmtNum(total)} recorded votes in their record (member totals back to 2006; name-by-name rows from 2018): <strong>${pctTxt(cast)}%</strong> cast · <strong>${pctTxt(absent)}%</strong> absent.`
        : `Of the ${fmtNum(total)} recorded votes in their record (member totals back to 2006; name-by-name rows from 2018), counting declared interests in the total: <strong>${pctTxt(cast)}%</strong> cast · <strong>${pctTxt(absent)}%</strong> absent · <strong>${pctTxt(interest)}%</strong> declared an interest (the record flags these only from June 2023) — a duty, not an absence.`)}</p>
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
      ? `<img src="https://demeapp.github.io/assets/headshots/${person.slug}.webp" alt="" width="72" height="72" style="border-radius:50%;object-fit:cover" onerror="this.remove()">`
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
      <div class="rc-stat"><span>${simpleT("Recorded-vote participation", "Recorded votes they took part in")}</span><strong>${fmtAtt(person)}</strong></div>
      <div class="rc-stat"><span>Votes cast</span><strong>${fmtNum(person.votesCast)}</strong></div>
      <div class="rc-stat"><span>Yes</span><strong>${fmtNum(person.yes)}</strong></div>
      <div class="rc-stat"><span>No</span><strong>${fmtNum(person.no)}</strong></div>
      <div class="rc-stat"><span>${simpleT("Interest declared · stepped back", "Declared an interest · did not vote")}</span><strong>${interestFigure(person)}</strong></div>
    </div>
    <h3>${simpleT("Five most recent recorded votes", "Their five newest recorded votes")}</h3>
    ${votes || `<p>${simpleT("No recorded votes in the searchable archive.", "No recorded votes in the archive you can search.")}</p>`}
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
    box.innerHTML = `<div class="calm"><h1>Member not found.</h1>
      <p>See the <a href="councillors.html">full list of members</a>.</p></div>`;
    return;
  }
  currentPerson = person;
  document.title = `${person.name} — Toronto City Council record | Deme`;
  const role = person.current
    ? (person.mayor ? "Mayor of Toronto"
       : `Councillor · Ward ${person.ward} — ${esc(person.wardName)}`)
    : "Former member of Toronto City Council";
  const attBar = person.participation == null ? ""
    : `<span class="participation-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, person.participation))}%"></span></span>`;
  /* Basis note (Phase 2 audit P0-5): members whose participation and
     vote totals rest partly on the pre-2018 aggregate layer carry
     participationBasis:"aggregate" in councillors.json; the note sits
     beside the figures it qualifies. It does not qualify the separate
     interest-declared figure, which is stored-rows only. */
  const basisNote = person.participationBasis === "aggregate"
    ? `<p class="small" style="max-width:44rem">${simpleT("This member's participation and vote totals include their pre-2018 aggregate record, kept as totals rather than stored vote by vote; some or all of those earlier votes are not stored individually.", "This member's participation and vote totals include their record from before 2018, kept as totals, not stored one by one. Some or all of those earlier votes are not stored one by one.")}</p>`
    : "";
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
      <div class="stat"><span class="num">${fmtAtt(person)}</span>
        <span class="lab">${simpleT("Recorded-vote participation — present and voting, out of recorded votes where a vote was theirs to cast", "Recorded votes they took part in — they were there and voted, out of the recorded votes they could vote on")}</span>${attBar}</div>
      <div class="stat"><span class="num">${fmtNum(person.votesCast)}</span>
        <span class="lab">${simpleT("Votes cast (yes or no) across their record", "Votes they cast (yes or no) in their whole record")}</span></div>
      <div class="stat"><span class="num">${interestFigure(person)}</span>
        <span class="lab">${simpleT("Interest declared · stepped back", "Declared an interest · did not vote")}</span></div>
    </div>
    <p class="small" style="max-width:44rem">${simpleT("Recorded-vote participation is the share of recorded votes where the member was present and voting — not a count of meetings attended, and declared interests are never counted against it.", "This number is the share of recorded votes where the member was there and voted. It is not a count of meetings they went to. Declared interests never count against them.")}
    <a href="about.html#how-we-count">How we count</a>${simpleT(" explains each figure on this page.", " explains each number on this page.")}</p>
    ${basisNote}
    ${compositionStrip(person)}
    <p class="small" style="max-width:44rem">${simpleT("The totals count the full record: member totals back to 2006; item-by-item rows from 2018. The “Interest declared · stepped back” figure is narrower: the voting record flags a declared interest only from June 2023, so the figure counts flagged votes from June 2023 on — earlier declarations were recorded as ordinary absences. A dash marks a member whose service ended before June 2023. The figure is not the City’s declarations register; the register entries Deme serves for this member are listed on this page under “Declared interests — the official register”, with their own count.", "The totals cover the full record. Member totals go back to 2006. Rows for each item start in 2018. The “Declared an interest · did not vote” number is narrower. The voting record only marks a declared interest from June 2023. So the number counts marked votes from June 2023 on. Before that, declarations were written down as plain absences. A dash means the member’s service ended before June 2023. This number is not the City’s official list of declared interests. That list is on this page too, under its own heading, with its own count.")}</p>
    <p style="margin-top:1rem"><button class="btn secondary" id="record-card-btn"
      type="button">${simpleT("Print / download record card", "Print or download record card")}</button>
    <button class="btn secondary" id="share-btn" type="button">Copy link</button></p>
    <nav class="profile-contents" id="profile-contents" aria-label="On this page">
      <span class="pc-lab">On this page</span>
      <a data-pc="about" href="#about-member">About</a>
      <a data-pc="promises" href="#promises-h">Promises</a>
      <a data-pc="lobbying" href="#lobbying-h">Lobbying</a>
      <a data-pc="registry" href="#declared-interests">Declared interests</a>
      <a data-pc="pay" href="#pay-expenses">Pay &amp; expenses</a>
      <a data-pc="votes" href="#recorded-votes-h">Recorded votes</a>
      <a data-pc="say" href="#have-your-say">Have your say</a>
    </nav>
    <div id="profile-extra"></div>
    <div id="declared-interests"></div>
    <div id="pay-expenses"></div>
    <h2 style="margin-top:2.6rem" id="recorded-votes-h">Recorded votes</h2>
    <hr class="rule">
    <p class="small">${simpleT("Item by item — the decision archive, 2018–2026.", "One by one — the decision archive, 2018–2026.")}</p>
    <div id="historyWrap"><div class="skel-card" aria-hidden="true">
      <span class="skel-el sm"></span><span class="skel-el title"></span>
      <span class="skel-el"></span><span class="skel-el short"></span></div></div>
    <div id="have-your-say"></div>`;
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
  Promise.allSettled([renderExtras(person), renderDeclaredInterests(person),
    renderPayExpenses(person), renderHaveYourSay(person)])
    .then(pruneProfileContents);
}
/* The contents strip links only to sections this member actually has:
   a link whose section never rendered is removed, so the strip never
   promises a jump that lands nowhere. */
function pruneProfileContents() {
  const nav = document.getElementById("profile-contents");
  if (!nav) return;
  const hostLen = (id) => { const el = document.getElementById(id); return el ? el.innerHTML.trim().length : 0; };
  const checks = {
    about: () => !!document.getElementById("about-member"),
    promises: () => !!document.getElementById("promises-h"),
    lobbying: () => !!document.getElementById("lobbying-h"),
    registry: () => hostLen("declared-interests") > 0,
    pay: () => hostLen("pay-expenses") > 0,
    votes: () => true,
    say: () => hostLen("have-your-say") > 0,
  };
  let kept = 0;
  nav.querySelectorAll("a[data-pc]").forEach((a) => {
    const ok = checks[a.dataset.pc] ? checks[a.dataset.pc]() : true;
    if (ok) kept += 1; else a.remove();
  });
  if (kept < 2) nav.remove();
}
init().catch(() => {
  box.innerHTML = `<p class="small">The record could not be loaded. Please reload.</p>`;
});
