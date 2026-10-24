/* My Record — the visitor's one personal home. It hosts the weigh-in
   (the upcoming Council items, folded in from the old Vote page by the
   owner decision of Oct 20, 2026), and it resolves each saved pick
   against the archive: is the item decided yet? What was the outcome?
   If a recorded vote exists and the visitor set a ward, how did their
   councillor vote on the first recorded vote of the item, next to the
   visitor's own pick? Below the picks, the alignment block sums
   the decided picks up in this browser, from the picks and the
   public record — the tally is computed on each render and is
   never stored or sent. Weighing in requires sign-in: picks save to the
   account (account.js keeps the account copy in step with the
   VoteStore cache this page renders from). Reading never does. */
"use strict";
renderChrome("my-record.html");

/* === ALIGNMENT CORE (pure — no DOM, no storage, no network) ===
   The computation core of the alignment block (ALIGNMENT-FEATURE-SPEC
   §§3–6). These functions are deliberately free of every browser
   dependency so the spec's §10 fixtures run against them in Node with
   no DOM (the fixture runner extracts exactly this marked section).

   comparableVote(detail, memberName, memberTerms): the member's value
   in the first motion whose stage is exactly "City Council" AND in
   which the member has a usable row (Decision S-1 — a committee vote
   is a recommendation, never the decision; Phase 2 audit A-2 — every
   Council-stage motion is consulted, not only the first, so a later
   motion carrying the member's named vote is never masked by an
   earlier one that does not). Name match is exact string equality
   (S-4); an unrecognized value is "none", never coerced. Returns one of:
     {kind:"vote", value:"Yes"|"No"} | {kind:"absent"} |
     {kind:"interest"} | {kind:"none", reason:"no-council-vote"|"no-row"
       |"tally-only"|"not-in-office"}
   ("no-council-vote": no City Council-stage motion in the file, or
    none carrying named rows or a published tally;
    "tally-only": no named Council rows exist and a Council motion
    carries the data's tallyOnly flag (a published result, no
    individual names) — the member may well have voted; the City
    simply did not record who (Phase 2 P0-2);
    "no-row": named Council votes exist but the member is in none of
    them, and their terms cover the item's year;
    "not-in-office": the same, but the member's term buckets in
    councillors.json do not cover the item's year — the only case in
    which an in-office/not-in-office reason may be given. The bucket
    does NOT prove the item predates their first term: gap-term
    members are out of office between terms too.)

   tallyAlignment(picks, ward, people, detailByRef): the §4 tally.
   picks is the VoteStore.allPicks() shape {ref:{choice, ts}}; ward is
   the visitor's ward number; people is councillors.json. detailByRef
   maps a ref to what the page holds for it:
     - missing / null / {unknown:true} / {undecided:true}
         → the pick enters NO count (still awaiting a decision, or
           the detail file failed to load — a network failure is not
           evidence about the record);
     - {hasVote:false} (the index card's flag)
         → decided, bucket B3, no detail needed;
     - {detail:<d/{ref}.json>} or a raw detail object
         → decided; classified by comparableVote.
   Returns {matched, comparable, B1, B2, B3, B4, B5, B6, decided,
   member} where decided = comparable+B1+B2+B3+B4+B5+B6 and member is
   the resolved current councillor's name (null when the ward has
   none). B4 = no-row, B5 = tally-only, B6 = not-in-office (see
   comparableVote). Counts only — no percentage is ever computed
   (S-2), and nothing here is persisted (S-5): the caller keeps the
   result in render scope only.

   alignmentCopy(tally, memberName, ward): the §6 display strings —
   headline (comparable ≥ 5, S-3), progress state, and the not-counted
   explainer lines for the non-zero buckets, in B1–B6 order. */
function comparableVote(detail, memberName, memberTerms) {
  if (!detail || !Array.isArray(detail.motions)) {
    return { kind: "none", reason: "no-council-vote" };
  }
  const councilMotions = detail.motions.filter(
    (m) => m && m.stage === "City Council");
  if (!councilMotions.length) return { kind: "none", reason: "no-council-vote" };
  let sawTallyOnly = false;
  let sawNamedRows = false;
  for (const motion of councilMotions) {
    const votes = Array.isArray(motion.votes) ? motion.votes : [];
    if (!votes.length) {
      /* A tally-only motion (the data's own tallyOnly flag: votes []
         and the tally carried in the result string) means the City
         recorded the result, not the names (P0-2). An empty vote list
         without the flag is no record at all. */
      if (motion.tallyOnly === true) sawTallyOnly = true;
      continue;
    }
    sawNamedRows = true;
    const row = votes.find((v) => Array.isArray(v) && v[0] === memberName);
    if (!row) continue;
    const value = row[1];
    if (value === "Yes" || value === "No") return { kind: "vote", value };
    if (value === "Absent") return { kind: "absent" };
    if (typeof value === "string" && value.startsWith("Absent(Interest")) {
      return { kind: "interest" };
    }
    return { kind: "none", reason: "no-row" };
  }
  if (sawTallyOnly && !sawNamedRows) return { kind: "none", reason: "tally-only" };
  if (!sawNamedRows) return { kind: "none", reason: "no-council-vote" };
  /* Named Council votes exist and the member is in none of them. The
     not-in-office reason is earned, not guessed: it is returned only
     when the member's term buckets do not cover the item's year. */
  if (Array.isArray(memberTerms) && memberTerms.length) {
    const when = (councilMotions[0] && councilMotions[0].when) || "";
    const year = Number(String(when).slice(0, 4));
    if (Number.isFinite(year) && year > 0) {
      const covered = memberTerms.some((t) => {
        const parts = String(t).split("-").map(Number);
        return parts.length === 2 && Number.isFinite(parts[0])
          && Number.isFinite(parts[1]) && year >= parts[0] && year <= parts[1];
      });
      if (!covered) return { kind: "none", reason: "not-in-office" };
    }
  }
  return { kind: "none", reason: "no-row" };
}

function tallyAlignment(picks, ward, people, detailByRef) {
  const out = { matched: 0, comparable: 0, B1: 0, B2: 0, B3: 0, B4: 0,
    B5: 0, B6: 0, decided: 0, member: null };
  const member = (Array.isArray(people) && ward != null)
    ? people.find((p) => p && p.current && p.ward === ward) || null
    : null;
  if (!member) return out;
  out.member = member.name;
  for (const ref of Object.keys(picks || {})) {
    const raw = detailByRef ? detailByRef[ref] : undefined;
    if (!raw || typeof raw !== "object" || raw.unknown || raw.undecided) {
      continue; /* undecided or unknown — enters no count (§4) */
    }
    let detail = null, hasVote;
    if ("detail" in raw || "hasVote" in raw || "card" in raw) {
      detail = raw.detail || null;
      hasVote = raw.hasVote !== undefined ? raw.hasVote
        : (raw.card ? raw.card.hasVote : undefined);
    } else {
      detail = raw; /* a raw detail object */
    }
    if (hasVote === false) { out.B3 += 1; continue; }
    const pick = picks[ref];
    const choice = typeof pick === "string" ? pick : (pick && pick.choice);
    const cv = comparableVote(detail, member.name, member.terms);
    if (cv.kind === "vote") {
      out.comparable += 1;
      if ((choice === "support" && cv.value === "Yes")
        || (choice === "oppose" && cv.value === "No")) out.matched += 1;
    } else if (cv.kind === "absent") out.B1 += 1;
    else if (cv.kind === "interest") out.B2 += 1;
    else if (cv.reason === "no-council-vote") out.B3 += 1;
    else if (cv.reason === "tally-only") out.B5 += 1;
    else if (cv.reason === "not-in-office") out.B6 += 1;
    else out.B4 += 1;
  }
  out.decided = out.comparable + out.B1 + out.B2 + out.B3
    + out.B4 + out.B5 + out.B6;
  return out;
}

function alignmentCopy(tally, memberName, ward) {
  const none = { headline: null, progress: null, explainer: [] };
  if (!tally || !memberName) return none;
  if (!(tally.decided >= 1 || tally.comparable >= 1)) return none;
  const explainer = [];
  if (tally.B1) explainer.push(
    `${tally.B1} where ${memberName} was absent — there was no vote to compare.`);
  if (tally.B2) explainer.push(simpleOn()
    ? `${tally.B2} where ${memberName} declared an interest and did not vote. Stepping back when there is a conflict is a duty, not a position. These are never counted for or against them.`
    : `${tally.B2} where ${memberName} declared an interest and did not vote — stepping back on a conflict is a duty, not a position, so these are never counted for or against.`);
  if (tally.B3) explainer.push(simpleOn()
    ? `${tally.B3} decided without a recorded vote at City Council. Most Council decisions are not taken name-by-name.`
    : `${tally.B3} decided without a recorded vote at City Council — most Council decisions are not taken name-by-name.`);
  if (tally.B4) explainer.push(simpleOn()
    ? `${tally.B4} where the recorded Council vote does not list ${memberName}. No vote of theirs is recorded on the item.`
    : `${tally.B4} where the recorded Council vote does not list ${memberName} — no vote of theirs is recorded on the item.`);
  if (tally.B5) explainer.push(simpleOn()
    ? `${tally.B5} where the City published only the tally. No names were recorded, so there is no vote to compare.`
    : `${tally.B5} where the City published the result as a tally only — no individual names were recorded, so there is no vote to compare.`);
  if (tally.B6) explainer.push(
    `${tally.B6} where ${memberName} has no recorded vote on the item — it was decided when they were not in office.`);
  if (tally.comparable >= 5) {
    return { explainer,
      progress: null,
      headline: {
        num: `${tally.matched} of ${tally.comparable}`,
        lab: simpleOn()
          ? `decided picks where ${memberName} voted the same way you did. ${memberName} is your Ward ${ward} representative. Each pick is compared with the first recorded vote they cast at City Council on that item. Counted here, on this device, from your picks and the public record. It is a record, not a score. What you do with it is up to you.`
          : `decided picks where ${memberName} voted the same way you did. ${memberName} is your Ward ${ward} representative, and each pick is compared with the first recorded vote they cast at City Council on that item. Counted here, on this device, from your picks and the public record — a record, not a score; what you do with it is up to you.`,
      } };
  }
  return { explainer, headline: null,
    progress: simpleOn()
      ? `How you line up with ${memberName} will be summed up here once more of your decided picks have a recorded Council vote from them. So far ${tally.comparable} of the 5 needed are counted. Every pick is already lined up against the record below.`
      : `How you line up with ${memberName} will be summed up here once more of your decided picks have a recorded Council vote from them — so far ${tally.comparable} of the 5 needed are counted. Every pick is already lined up against the record below.` };
}
/* === END ALIGNMENT CORE === */

const interestsBox = document.getElementById("interests");
const continuityBox = document.getElementById("continuity");
const alertsBox = document.getElementById("profile-alerts");
const picksBox = document.getElementById("picks");
const agreeBox = document.getElementById("agreement");
const upcomingBox = document.getElementById("upcoming");
const watchesBox = document.getElementById("watches");
let people = [];
let wardNames = new Map();
let threadThreads = [];

async function findCard(ref) {
  const years = [ref.slice(0, 4), "2026", "2025", "2024", "2023", "2022",
    "2021", "2020", "2019", "2018"].filter((v, i, a) => a.indexOf(v) === i);
  for (const y of years) {
    try {
      const cards = await loadJSON(dataPath(`index-${y}.json`));
      const hit = cards.find((c) => c.ref === ref);
      if (hit) return hit;
    } catch (e) { /* next */ }
  }
  return null;
}
/* The ward this page personalizes from. Owner decision (Oct 20,
   2026): a ward belongs to the account profile — it is set when
   the account is created and edited in the account form above,
   never in a device-level editor on this page. The account layer
   mirrors the profile row into VoteStore, so a signed-in visitor's
   VoteStore ward IS their profile ward. Signed out, this page has
   no ward: no councillor lines, no alignment, no rep snapshot —
   the directory's postal-code lookup is the signed-out route to a
   councillor. While accounts are not enabled at all, the
   on-device profile remains the whole product and this simply
   reads it, as before. */
function profileWard() {
  if (window.DemeAccount && window.DemeAccount.enabled()
      && !window.DemeAccount.isSignedIn()) return null;
  return VoteStore.getWard();
}
function myCouncillor() {
  const w = profileWard();
  if (!w) return null;
  return people.find((p) => p.current && p.ward === w) || null;
}

/* Topic chips: the 11 threads, toggles save the full set on every tap.
   Once topics are chosen, the block rests as a one-line summary —
   the same compact summary state the finders use when a ward is
   set — until Change reopens the editor. */
let topicsEditing = false;
function renderInterests() {
  if (!interestsBox) return;
  const ints = VoteStore.getInterests();
  const summaryBox = document.getElementById("topics-summary");
  const doneRow = document.getElementById("topics-done");
  if (ints.length && !topicsEditing) {
    const names = ints.map((id) => {
      const t = threadThreads.find((x) => x.id === id);
      return t ? t.label : id;
    });
    if (summaryBox) {
      summaryBox.innerHTML = `<p class="wf-set"><span><strong>Following:</strong>
        ${esc(names.join(", "))}</span>
        <button class="wf-listtoggle" type="button" id="topics-change">Change</button></p>`;
      summaryBox.querySelector("#topics-change").addEventListener("click", () => {
        topicsEditing = true;
        renderInterests();
      });
    }
    interestsBox.innerHTML = "";
    interestsBox.style.display = "none";
    if (doneRow) doneRow.hidden = true;
    renderProfileChrome();
    return;
  }
  if (summaryBox) summaryBox.innerHTML = "";
  interestsBox.style.display = "";
  interestsBox.innerHTML = threadThreads.map((t) =>
    `<button type="button" class="chip" data-id="${esc(t.id)}" aria-pressed="${ints.includes(t.id)}">${esc(t.label)}</button>`).join("");
  if (doneRow) doneRow.hidden = !ints.length;
  renderProfileChrome();
}

/* Profile summary + topics/alerts visibility (owner decisions,
   Oct 20, 2026): the ward editors that used to live here are
   gone — a ward is set when the account is created and changed
   in the account form above, which is the profile's one edit
   path. This block only ever READS state.
   Signed in, it states the profile facts: home ward, watched
   ward, topics count, Council alerts state (the alerts segment
   reads the account layer's opt-in — false signed out, omitted
   while a signed-in row is still loading; see
   DemeAccount.alertsOptIn).
   Signed out, there is no explainer section any more: the
   topics/alerts block below renders only when signed in, where
   it actually works, and all that remains here is one line
   pointing to the directory's postal-code lookup.
   While accounts are not enabled at all, the on-device profile
   remains the whole product: the explainer and the editors stay
   visible, as before. */
function accountSignedInNow() {
  return Boolean(window.DemeAccount
    && typeof window.DemeAccount.isSignedIn === "function"
    && window.DemeAccount.isSignedIn());
}
function accountsLive() {
  return Boolean(window.DemeAccount
    && typeof window.DemeAccount.enabled === "function"
    && window.DemeAccount.enabled());
}
function setSetupVisible(visible) {
  const setup = document.getElementById("profile-setup");
  if (setup) setup.hidden = !visible;
}
function renderProfileChrome() {
  const summary = document.getElementById("profile-summary");
  if (!summary) return;
  summary.hidden = false;
  if (!accountSignedInNow()) {
    if (accountsLive()) {
      setSetupVisible(false);
      summary.innerHTML = `<p class="small" style="margin:0">Just
        looking for your representative?
        <a href="councillors.html#ward-lookup">Find them by postal
        code in the directory</a>.</p>`;
      return;
    }
    setSetupVisible(true);
    summary.innerHTML = `<h2 style="font-size:1.25rem">Your profile</h2>
      <p style="max-width:44rem;margin:0">Your ward is part of your
      account profile — it's set when you create your account, so
      your representative's votes can be lined up against your picks.
      Looking for your representative right now?
      <a href="councillors.html#ward-lookup">Find them by postal
      code in the directory</a>.</p>`;
    return;
  }
  setSetupVisible(true);
  const ward = VoteStore.getWard();
  const parts = [];
  if (ward != null) {
    const wi = WardFinder.info(people, ward);
    parts.push(`<strong>Home ward: Ward ${ward}${wi.name ? ` — ${esc(wi.name)}` : ""}</strong>${wi.councillor ? ` · Councillor ${esc(wi.councillor)}` : ""}`);
  } else {
    parts.push(`<strong>No home ward set</strong>`);
  }
  const watch = VoteStore.getWatchWard();
  if (watch != null) {
    const wwi = WardFinder.info(people, watch);
    parts.push(`Watching Ward ${watch}${wwi.name ? ` — ${esc(wwi.name)}` : ""}`);
  }
  const ints = VoteStore.getInterests();
  parts.push(ints.length
    ? `${ints.length} topic${ints.length === 1 ? "" : "s"} followed`
    : "No topics followed");
  let alertsVal = false;
  if (window.DemeAccount && window.DemeAccount.enabled()
    && typeof window.DemeAccount.alertsOptIn === "function") {
    alertsVal = window.DemeAccount.alertsOptIn();
  }
  if (alertsVal != null) {
    parts.push(`Council alerts ${alertsVal ? "on" : "off"}`);
  }
  summary.innerHTML = `<h2 style="font-size:1.25rem">Your profile</h2>
    <p class="wf-set"><span>${parts.join(" · ")}</span></p>
    <p class="small" style="margin:.3rem 0 0">Your wards were set when
    you created your account — change them any time in
    <a href="#account-zone">your account</a> above.</p>`;
}
window.DemeRecord = { refreshProfileSummary: renderProfileChrome,
  refreshWeighIn: renderUpcoming, refreshPicks: renderPicks,
  refreshWatches: renderWatches };

/* Continuity, same snapshot discipline as Home: no snapshot + a known
   current rep primes the snapshot silently; a snapshot naming someone
   else shows the change notice until the visitor acknowledges it. */
function renderContinuity() {
  if (!continuityBox) return;
  const c = myCouncillor();
  if (!c) { continuityBox.innerHTML = ""; return; }
  const snap = VoteStore.getWardRep();
  if (!snap) {
    VoteStore.setWardRep(c.slug, c.name);
    continuityBox.innerHTML = "";
    return;
  }
  if (snap.slug === c.slug) { continuityBox.innerHTML = ""; return; }
  continuityBox.innerHTML = `<div class="notice"><h3>Your representative changed</h3>
    <p>When the new Council took office, Ward ${c.ward}'s seat changed
    hands. ${esc(snap.name)} was the councillor on record when you set
    your ward; ${esc(c.name)} represents Ward ${c.ward} now.</p>
    <p><a href="councillor.html?m=${encodeURIComponent(c.slug)}">See ${esc(c.name)}'s record →</a>
    <button class="btn secondary small" type="button" id="continuity-gotit">Got it</button></p></div>`;
  document.getElementById("continuity-gotit").addEventListener("click", () => {
    VoteStore.setWardRep(c.slug, c.name);
    continuityBox.innerHTML = "";
  });
}

/* Council alerts — account opt-in only (owner decision, Oct 20,
   2026): the separate sign-up form route is retired. Alerts are
   opted into when the account is created, or in the account
   settings. When Deme accounts are active (account.js,
   config-gated), the account layer renders this box. This
   fallback renders only while accounts are not enabled at all;
   it describes the same account route and offers no form. */
function renderAlerts() {
  if (!alertsBox) return;
  if (window.DemeAccount && window.DemeAccount.enabled()) {
    window.DemeAccount.renderAlerts(alertsBox);
    return;
  }
  alertsBox.innerHTML = `<h3>Council alerts by email</h3>
    <p>Get an email when items on your wards or topics reach a City Council agenda. Council alerts are part of a free Deme account: you opt in when you create your account, and the digest follows the wards and topics on your profile. Digests haven't started yet; they begin with the new Council term — one digest per Council agenda, never one email per item, reviewed by a person before it goes out. Nothing is sent until digests begin.</p>`;
}

/* ---------------- weigh in (folded in from the old Vote page) ----
   The Support/Oppose action requires sign-in (owner decision,
   Oct 20, 2026): signed-out visitors see the value-pitch gate, and
   any pick already on this device stays visible but read-only.
   A gate tap remembers the item; when sign-in completes, the
   account layer asks this page to re-render (refreshWeighIn) and
   the visitor lands back on the same item. Signed-in picks write
   to the local cache first, then to the account; a failed account
   write is said out loud, never hidden. */
const PENDING_WEIGH_KEY = "deme.pendingWeighIn";
let upcomingItems = [];
let upcomingLoaded = false;
function accountSignedIn() {
  return Boolean(window.DemeAccount
    && typeof window.DemeAccount.isSignedIn === "function"
    && window.DemeAccount.isSignedIn());
}
function takePendingWeighIn() {
  try {
    const v = sessionStorage.getItem(PENDING_WEIGH_KEY);
    if (v) sessionStorage.removeItem(PENDING_WEIGH_KEY);
    return v;
  } catch (e) { return null; }
}
function weighInHTML(u) {
  const pick = (typeof VoteStore.getPick === "function")
    ? VoteStore.getPick(u.ref) : null;
  const picked = pick ? pick.choice : null;
  if (!accountSignedIn()) {
    return `<div class="weighin" id="w-${CSS.escape(u.ref)}">
      ${picked ? `<p class="savedNote">Your pick on this device:
        <strong>${picked === "support" ? "Support" : "Oppose"}</strong>.
        Sign in to save picks to your account and to change them.</p>` : ""}
      <div class="pick-gate">
        <h3>Sign in to weigh in</h3>
        <p>Sign in to weigh in — your picks save to your account, and we'll notify you when your voting card is ready: how the vote went, how your representative voted, and where you stand.</p>
        <p style="margin:.6rem 0 0"><button class="btn gate-signin"
          type="button" data-ref="${esc(u.ref)}">Sign in or create
          your free account</button></p>
      </div>
    </div>`;
  }
  return `<div class="weighin" id="w-${CSS.escape(u.ref)}">
    <div class="choices" role="group" aria-label="Your position on ${esc(u.title)}">
      <button class="choice support" data-ref="${esc(u.ref)}" data-choice="support"
        aria-pressed="${picked === "support"}">Support</button>
      <button class="choice oppose" data-ref="${esc(u.ref)}" data-choice="oppose"
        aria-pressed="${picked === "oppose"}">Oppose</button>
    </div>
    <p class="savedNote" aria-live="polite">${picked
      ? `Your pick: <strong>${picked === "support" ? "Support" : "Oppose"}</strong> —
         saved to your account. Tap the other side to change it, any
         time before the meeting.`
      : "No pick yet — tap Support or Oppose to save your pick to your account."}</p>
    ${watchHTML(u)}
  </div>`;
}
/* Watching (owner decision, Oct 21, 2026 — "close the loop"):
   a signed-in visitor can watch an item whether or not they
   picked a side; when Council decides it, the resolver sends
   one outcome email and the watch appears below with its
   result. The toggle's state reads the account layer's watch
   cache; a watch whose account write hasn't landed yet says so
   on its note line (DemeAccount.isStaleWatch), never silently. */
function watchHTML(u) {
  const acct = window.DemeAccount;
  if (!acct || typeof acct.isWatching !== "function") return "";
  const watching = acct.isWatching(u.ref);
  const stale = watching && typeof acct.isStaleWatch === "function"
    && acct.isStaleWatch(u.ref);
  const note = watching
    ? (stale
      ? "You're watching this item — saved on this device; the "
        + "account copy didn't go through just now and will be "
        + "retried at your next sign-in."
      : "You're watching this item — we'll email you once, when "
        + "Council decides it. Your watch is listed below.")
    : "Watch this item and we'll email you once, when Council "
      + "decides it — the outcome, and your pick beside it if "
      + "you weighed in. No other mail.";
  return `<div class="watchrow">
    <button class="choice watchbtn" type="button" data-ref="${esc(u.ref)}"
      aria-pressed="${watching}">${watching ? "Watching" : "Watch this item"}</button>
    <p class="savedNote watch-note" aria-live="polite">${note}</p>
  </div>`;
}
function renderUpcoming() {
  if (!upcomingBox) return;
  if (!upcomingItems.length) {
    upcomingBox.innerHTML = `<div class="calm">
      <p class="calm-head">No Council votes are scheduled in the published agenda right now.</p>
      <p>When the City publishes the next Council agenda, its items will be listed here with briefs — ready to weigh in on before the vote.</p>
      <p style="margin-bottom:.4rem">Toronto's municipal election is
      <strong>October 26, 2026</strong>; the new Council takes office in
      November, and its first agendas follow. In the meantime, the full
      record is open:</p>
      <p><a class="btn secondary small" href="explore.html">Browse past decisions</a></p>
    </div>`;
    return;
  }
  upcomingBox.innerHTML = upcomingItems.map((u) => `
    <article class="card" style="margin-bottom:1rem">
      <div class="meta"><span>${esc(fmtDate(u.date))}</span>
        <span>${esc(u.body)}</span><span class="pill ink">Coming up</span></div>
      <h3>${esc(u.title)}</h3>
      ${u.brief ? `<p>${esc(u.brief)}</p>` : ""}
      ${weighInHTML(u)}
    </article>`).join("");
  bindWeighIns();
  let targetRef = takePendingWeighIn();
  if (!targetRef && location.hash && location.hash.length > 1
      && !/weigh-in/.test(location.hash)) {
    try { targetRef = decodeURIComponent(location.hash.slice(1)); }
    catch (e) { targetRef = null; }
  }
  if (targetRef) {
    const target = document.getElementById(`w-${CSS.escape(targetRef)}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.classList.add("is-pending");
    }
  }
}
function bindWeighIns() {
  if (!upcomingBox || upcomingBox.dataset.bound) return;
  upcomingBox.dataset.bound = "1";
  upcomingBox.addEventListener("click", async (e) => {
    const watchBtn = e.target.closest(".watchbtn");
    if (watchBtn) {
      if (!accountSignedIn() || !window.DemeAccount
          || typeof window.DemeAccount.syncWatch !== "function") return;
      const ref = watchBtn.dataset.ref;
      const item = upcomingItems.find((u) => u.ref === ref);
      if (!item) return;
      const hadFocusW = document.activeElement === watchBtn;
      const on = !window.DemeAccount.isWatching(ref);
      const synced = await window.DemeAccount.syncWatch(
        ref, on, item.title);
      /* Re-render the whole weigh-in block, exactly as a pick
         change does, so the toggle and its note line agree. */
      const wrap = document.getElementById(`w-${CSS.escape(ref)}`);
      if (wrap) {
        const fresh = document.createElement("div");
        fresh.innerHTML = weighInHTML(item);
        const note = fresh.querySelector(".watch-note");
        if (note && !synced && on) {
          note.textContent = "You're watching this item on this "
            + "device — the account copy didn't go through just "
            + "now, and it will be retried at your next sign-in. "
            + "The outcome email follows the account copy.";
        }
        if (note && !synced && !on) {
          note.textContent = "That unwatch is saved on this "
            + "device — the account copy didn't go through just "
            + "now, and it will be retried at your next sign-in.";
        }
        const newWrap = fresh.firstElementChild;
        wrap.replaceWith(newWrap);
        if (hadFocusW) {
          const eq = newWrap.querySelector(".watchbtn");
          if (eq) eq.focus();
        }
      }
      renderWatches();
      return;
    }
    const gateBtn = e.target.closest(".gate-signin");
    if (gateBtn) {
      try {
        sessionStorage.setItem(PENDING_WEIGH_KEY, gateBtn.dataset.ref);
      } catch (e2) {}
      const zoneEl = document.getElementById("account-zone");
      if (zoneEl) {
        zoneEl.scrollIntoView({ block: "start" });
        const field = zoneEl.querySelector("input");
        if (field) field.focus({ preventScroll: true });
      }
      return;
    }
    const btn = e.target.closest(".choice");
    if (!btn || !accountSignedIn()) return;
    const ref = btn.dataset.ref, choice = btn.dataset.choice;
    /* The re-render below replaces the weigh-in block, destroying
       this button — if it held keyboard focus, give it to its
       replacement. */
    const hadFocus = document.activeElement === btn;
    const current = VoteStore.getPick(ref);
    const clearing = Boolean(current && current.choice === choice);
    if (clearing) VoteStore.clearPick(ref);
    else VoteStore.setPick(ref, choice);
    let synced = true;
    if (window.DemeAccount
        && typeof window.DemeAccount.syncPick === "function") {
      synced = await window.DemeAccount.syncPick(ref, clearing ? null : choice);
    }
    const wrap = document.getElementById(`w-${CSS.escape(ref)}`);
    const item = upcomingItems.find((u) => u.ref === ref);
    if (wrap && item) {
      const fresh = document.createElement("div");
      fresh.innerHTML = weighInHTML(item);
      const note = fresh.querySelector(".savedNote");
      if (note) {
        note.classList.add("pop");
        if (!synced) {
          note.innerHTML += " The account copy didn't go through just "
            + "now — this pick is saved on this device, and the "
            + "difference will be offered at your next sign-in.";
        }
      }
      const newWrap = fresh.firstElementChild;
      wrap.replaceWith(newWrap);
      if (hadFocus) {
        const eq = newWrap.querySelector(`.choice[data-choice="${choice}"]`);
        if (eq) eq.focus();
      }
    }
    renderPicks();
  });
}
async function loadUpcoming() {
  if (upcomingLoaded) { renderUpcoming(); return; }
  upcomingLoaded = true;
  try {
    const up = await loadJSON(dataPath("upcoming.json"));
    /* Defence in depth: the weigh-in shows City Council business
       only. The exporter enforces this upstream; the page enforces
       it again so no payload can put a board or committee item in
       front of a visitor as a Council vote. */
    upcomingItems = (up.items || []).filter((u) => u.body === "City Council");
  } catch (e) { upcomingItems = []; }
  renderUpcoming();
}

async function renderPicks() {
  const picks = VoteStore.allPicks();
  const refs = Object.keys(picks).sort(
    (a, b) => (picks[a].ts < picks[b].ts ? 1 : -1));
  if (!refs.length) {
    picksBox.innerHTML = `<div class="calm"><p class="calm-head">No picks yet.</p>
      <p>When you weigh in on an upcoming Council item, your position saves here. After the meeting, this page lines your pick up against what Council did. <a href="#weigh-in">See what's coming
      up →</a></p></div>`;
    agreeBox.innerHTML = "";
    return;
  }
  const councillor = myCouncillor();
  /* Resolve every pick's card once, and — only when a councillor exists
     to compare against — the detail files for decided picks that carry
     a recorded vote. These are the same loadJSON() calls this page has
     always made for the per-pick cards; the alignment tally below is
     computed from their results and adds zero fetches (spec §9). A
     detail file that fails to load marks the pick unknown: it enters
     no count at all. */
  const cards = {};
  const detailByRef = {};
  for (const ref of refs) {
    const card = await findCard(ref);
    cards[ref] = card;
    if (!card || !councillor) continue;
    if (!card.hasVote) {
      detailByRef[ref] = { hasVote: false, detail: null };
      continue;
    }
    try {
      detailByRef[ref] = { hasVote: true,
        detail: await loadJSON(dataPath(`d/${encodeURIComponent(ref)}.json`)) };
    } catch (e) { detailByRef[ref] = { unknown: true }; }
  }
  /* The tally lives only in this render pass — never stored (§9). */
  const tally = councillor
    ? tallyAlignment(picks, councillor.ward, people, detailByRef)
    : null;
  const blocks = [];
  for (const ref of refs) {
    const pick = picks[ref];
    const card = cards[ref];
    const pickLabel = pick.choice === "support" ? "Support" : "Oppose";
    if (!card) {
      blocks.push(`<article class="card" style="margin-bottom:1rem">
        <div class="meta"><span>Item ${esc(ref)}</span>
          <span class="pill plain">Waiting for the decision</span></div>
        <p style="margin:.2rem 0 0">Your pick: <strong>${pickLabel}</strong>.
        This item hasn't been decided in the published record yet — check
        back after the meeting.</p></article>`);
      continue;
    }
    let councillorLine = "";
    const entry = detailByRef[ref];
    if (councillor && entry && entry.hasVote && entry.detail) {
      const cv = comparableVote(entry.detail, councillor.name, councillor.terms);
      if (cv.kind === "vote") {
        const aligned = (pick.choice === "support" && cv.value === "Yes") ||
                        (pick.choice === "oppose" && cv.value === "No");
        councillorLine = `<p style="margin:.4rem 0 0">On the first recorded
          vote ${esc(councillor.name)} cast at City Council on this item,
          they voted <strong>${esc(cv.value)}</strong> — ${aligned
            ? "the same way you picked." : "differently from your pick."}</p>`;
      } else if (cv.kind === "absent") {
        councillorLine = `<p style="margin:.4rem 0 0">On the first recorded
          Council motion on this item that lists ${esc(councillor.name)},
          they were absent, so there is nothing to line your pick up
          against.</p>`;
      } else if (cv.kind === "interest") {
        councillorLine = `<p style="margin:.4rem 0 0">${esc(councillor.name)}
          declared an interest in this item and did not vote.</p>`;
      }
      /* kind "none" (B3–B6): no per-pick line — the reason surfaces
         only in the aggregate explainer below (spec §6.5). */
    }
    blocks.push(`<article class="card" style="margin-bottom:1rem">
      <div class="meta"><span>${esc(fmtDate(card.date))}</span>
        <span>${esc(card.body)}</span>
        <span class="pill">${esc(card.statusLabel)}</span></div>
      <h3><a href="decision.html?ref=${encodeURIComponent(ref)}">${esc(card.title)}</a></h3>
      <p style="margin:.2rem 0 0">Your pick: <strong>${pickLabel}</strong>.</p>
      ${councillorLine}</article>`);
  }
  picksBox.innerHTML = blocks.join("");
  /* Alignment block (§6): headline at comparable ≥ 5, the progress
     state below that, nothing when nothing is decided — plus the
     not-counted explainer whenever a bucket is non-zero. With no
     councillor (no ward set, or a vacant seat) the block renders
     nothing, exactly as the per-pick cards omit councillor lines. */
  if (!councillor || !tally) { agreeBox.innerHTML = ""; return; }
  const copy = alignmentCopy(tally, councillor.name, councillor.ward);
  let html = "";
  if (copy.headline) {
    html += `<div class="stat"><span class="num">${esc(copy.headline.num)}</span>
      <span class="lab">${esc(copy.headline.lab)}</span></div>`;
  } else if (copy.progress) {
    html += `<div class="stat"><span class="lab">${esc(copy.progress)}</span></div>`;
  }
  if (copy.explainer.length) {
    html += `<details class="recordExpander alignment-why">
      <summary>Why some picks aren't counted</summary>
      ${copy.explainer.map((line) =>
        `<p class="small">${esc(line)}</p>`).join("")}
      </details>`;
  }
  agreeBox.innerHTML = html;
}

/* ---------------- items you're watching ----------------
   A watch's live status is resolved from the same published
   archive the picks use: no card yet means Council hasn't
   decided the item in the published record; a card means it
   has, and the card (plus the per-decision file, for the
   recorded-vote counts) says how. This mirrors the resolver's
   own test server-side, so the list and the outcome email can
   never disagree about whether an item is decided. The email
   state shown here reads the row's notify_state, which only
   the resolver writes. */
let watchesRenderSeq = 0;
async function renderWatches() {
  if (!watchesBox) return;
  /* Render passes overlap (boot, sign-in bootstrap, a toggle):
     each pass awaits archive fetches, so a slow earlier pass
     could otherwise paint its stale snapshot over a newer one.
     Only the latest pass may paint. */
  const seq = ++watchesRenderSeq;
  const acct = window.DemeAccount;
  if (!acct || typeof acct.enabled !== "function" || !acct.enabled()) {
    watchesBox.innerHTML = "";
    return;
  }
  if (!accountSignedIn()) {
    watchesBox.innerHTML = `<div class="calm"><p class="calm-head">Watching is part of a free account.</p>
      <p>Sign in above to watch any upcoming Council item. When Council decides it, we email you the outcome once — with your pick beside it if you weighed in. Reading the record never needs an account.</p></div>`;
    return;
  }
  const watches = (acct.getWatches() || []).slice().sort(
    (a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (!watches.length) {
    watchesBox.innerHTML = `<div class="calm"><p class="calm-head">You're not watching anything yet.</p>
      <p>Tap <strong>Watch this item</strong> on anything coming
      up at Council, and it will be listed here — waiting first,
      then with its outcome once Council decides.</p></div>`;
    return;
  }
  const blocks = [];
  for (const w of watches) {
    const ref = w.item_ref;
    const pick = (typeof VoteStore.getPick === "function")
      ? VoteStore.getPick(ref) : null;
    const pickLine = pick
      ? `<p style="margin:.2rem 0 0">Your pick: <strong>${
          pick.choice === "support" ? "Support" : "Oppose"}</strong>.</p>`
      : "";
    const unwatch = `<p style="margin:.6rem 0 0"><button class="btn
      secondary small" type="button" data-unwatch="${esc(ref)}">Stop
      watching</button></p>`;
    const card = await findCard(ref);
    if (!card) {
      blocks.push(`<article class="card" style="margin-bottom:1rem">
        <div class="meta"><span>Item ${esc(ref)}</span>
          <span class="pill plain">Awaiting decision</span></div>
        <h3>${esc(w.item_title || "Council item")}</h3>
        ${pickLine}
        <p class="small" style="margin:.4rem 0 0">Watched
          ${esc(fmtDate(String(w.created_at || "").slice(0, 10)))}.
          We'll email you once, when Council decides it.</p>
        ${unwatch}</article>`);
      continue;
    }
    let voteLine = "";
    if (card.hasVote) {
      try {
        const detail = await loadJSON(
          dataPath(`d/${encodeURIComponent(ref)}.json`));
        const motion = detail && Array.isArray(detail.motions)
          ? detail.motions.find((m) => m && m.stage === "City Council")
          : null;
        if (motion) {
          voteLine = `<p style="margin:.4rem 0 0">Recorded vote at
            City Council: <strong>${motion.yes} in favour,
            ${motion.no} opposed</strong>.</p>`;
        }
      } catch (e) { /* the card's outcome line still stands */ }
    }
    const emailed = w.notify_state === "sent" && w.notified_at
      ? `<p class="small" style="margin:.4rem 0 0">We emailed you
          this outcome on
          ${esc(fmtDate(String(w.notified_at).slice(0, 10)))}.</p>`
      : "";
    blocks.push(`<article class="card" style="margin-bottom:1rem">
      <div class="meta"><span>${esc(fmtDate(card.date))}</span>
        <span>${esc(card.body)}</span>
        <span class="pill">${esc(card.statusLabel)}</span></div>
      <h3><a href="decision.html?ref=${encodeURIComponent(ref)}">${
        esc(card.title)}</a></h3>
      ${voteLine}
      ${pickLine}
      ${emailed}
      ${unwatch}</article>`);
  }
  if (seq !== watchesRenderSeq) return;
  watchesBox.innerHTML = blocks.join("");
}
if (watchesBox) {
  watchesBox.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-unwatch]");
    if (!btn || !accountSignedIn() || !window.DemeAccount
        || typeof window.DemeAccount.syncWatch !== "function") return;
    await window.DemeAccount.syncWatch(btn.dataset.unwatch, false);
    renderWatches();
    renderUpcoming();
  });
}

async function init() {
  people = await loadJSON(dataPath("councillors.json"));
  wardNames = new Map(people.filter((p) => p.current && !p.mayor)
    .map((p) => [p.ward, p.wardName]));
  try {
    const td = await loadJSON(dataPath("threads-summary.json"));
    threadThreads = td.threads || [];
  } catch (e) { threadThreads = []; }
  renderProfileChrome();
  renderContinuity();
  renderInterests();
  renderAlerts();
  if (interestsBox) interestsBox.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    btn.setAttribute("aria-pressed",
      btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
    VoteStore.setInterests([...interestsBox.querySelectorAll(
      '.chip[aria-pressed="true"]')].map((b) => b.dataset.id));
    const doneRow = document.getElementById("topics-done");
    if (doneRow) doneRow.hidden = !VoteStore.getInterests().length;
  });
  const topicsDoneBtn = document.getElementById("topics-done-btn");
  if (topicsDoneBtn) topicsDoneBtn.addEventListener("click", () => {
    topicsEditing = false;
    renderInterests();
  });
  document.getElementById("export").addEventListener("click", () => {
    const blob = new Blob(
      [JSON.stringify(VoteStore.exportAll(), null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "deme-my-record.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("reset").addEventListener("click", () => {
    if (confirm("Erase all your picks, your ward and your preferences from this browser? (Picks saved to your account are not erased by this — deleting the account itself removes those.)")) {
      VoteStore.resetAll();
      topicsEditing = false;
      renderContinuity();
      renderProfileChrome();
      renderInterests();
      renderPicks();
    }
  });
  renderPicks();
  renderWatches();
  loadUpcoming();
}
init().catch(() => {
  picksBox.innerHTML = `<p class="small">Your record could not be loaded.</p>`;
});
