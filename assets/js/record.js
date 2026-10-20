/* My Record — the visitor's one personal home. It hosts the weigh-in
   (the upcoming Council items, folded in from the old Vote page by the
   owner decision of Oct 20, 2026), and it resolves each saved pick
   against the archive: is the item decided yet? What was the outcome?
   If a recorded vote exists and the visitor set a ward, how did their
   councillor vote on the first recorded vote of the item, next to the
   visitor's own pick? Weighing in requires sign-in: picks save to the
   account (account.js keeps the account copy in step with the
   VoteStore cache this page renders from). Reading never does. */
"use strict";
renderChrome("my-record.html");

const interestsBox = document.getElementById("interests");
const continuityBox = document.getElementById("continuity");
const alertsBox = document.getElementById("profile-alerts");
const picksBox = document.getElementById("picks");
const agreeBox = document.getElementById("agreement");
const upcomingBox = document.getElementById("upcoming");
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
function myCouncillor() {
  const w = VoteStore.getWard();
  if (!w) return null;
  return people.find((p) => p.current && p.ward === w) || null;
}
/* Ward picking is postal-code-first (WardFinder): the finder owns
   the input, the confirm/picker states, its summary state when a
   ward is set (ward name + councillor + Change), and its built-in
   list fallback. Both finders re-mount on any change so what they
   show is always the stored truth. Each finder carries its own
   postal-code privacy note (the card-level explainer was removed
   with the postal-area profile field, Oct 20, 2026). */
function mountFinders() {
  const primaryEl = document.getElementById("ward-finder-primary");
  if (primaryEl) {
    WardFinder.mount(primaryEl, {
      idPrefix: "rec1",
      people,
      label: "Find your ward by postal code",
      current: VoteStore.getWard(),
      exclude: null,
      noneLabel: "No ward set",
      onChoose(n) {
        VoteStore.setWard(n);
        /* The watched ward can never be the primary ward — if the new
           primary is the watched one, the watch simply ends. */
        if (VoteStore.getWatchWard() != null
          && VoteStore.getWatchWard() === VoteStore.getWard()) {
          VoteStore.setWatchWard(null);
        }
        renderContinuity();
        mountFinders();
        renderPicks();
      },
    });
  }
  const watchEl = document.getElementById("ward-finder-watch");
  if (watchEl) {
    WardFinder.mount(watchEl, {
      idPrefix: "rec2",
      people,
      label: "Also watch a second ward",
      current: VoteStore.getWatchWard(),
      exclude: VoteStore.getWard(),
      noneLabel: "No second ward",
      inputLabel: "Postal code of the area to watch",
      onChoose(n) {
        VoteStore.setWatchWard(n === VoteStore.getWard() ? null : n);
        mountFinders();
      },
    });
  }
  renderProfileChrome();
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

/* Profile chrome (owner direction, Oct 20): the Your Deme setup
   blocks are a setup/edit surface, not permanent furniture. Until
   a home ward exists on this device, the full setup shows exactly
   as before. Once one does, the setup rests as a compact summary —
   home ward, watched ward, topics count, Council alerts state —
   and Edit profile reopens the full form in place; every control
   in it saves exactly as it always has (each on the spot), and the
   form's Done rests the card as the summary again. This only ever
   shows or hides the two regions and reads stored state — it
   writes nothing, and the account panel leads the card. The
   alerts segment reads the account layer's opt-in when accounts
   are enabled (false signed out; omitted while a signed-in row
   is still loading, then filled in when the account layer next
   refreshes — see DemeAccount.alertsOptIn). */
let profileEditing = false;
function renderProfileChrome() {
  const setup = document.getElementById("profile-setup");
  const summary = document.getElementById("profile-summary");
  if (!setup || !summary) return;
  const doneRow = document.getElementById("profile-done");
  const ward = VoteStore.getWard();
  if (ward == null) profileEditing = false;
  if (ward != null && !profileEditing) {
    const wi = WardFinder.info(people, ward);
    const parts = [`<strong>Ward ${ward}${wi.name ? ` — ${esc(wi.name)}` : ""}</strong>`];
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
    summary.innerHTML = `<h2 style="font-size:1.25rem">Your Deme</h2>
      <p class="wf-set"><span>${parts.join(" · ")}</span>
      <button class="wf-listtoggle" type="button" id="profile-edit">Edit profile</button></p>`;
    summary.querySelector("#profile-edit").addEventListener("click", () => {
      profileEditing = true;
      renderProfileChrome();
    });
    summary.hidden = false;
    setup.hidden = true;
    if (doneRow) doneRow.hidden = true;
    return;
  }
  summary.hidden = true;
  summary.innerHTML = "";
  setup.hidden = false;
  if (doneRow) doneRow.hidden = !(ward != null && profileEditing);
}
window.DemeRecord = { refreshProfileSummary: renderProfileChrome,
  refreshWeighIn: renderUpcoming, refreshPicks: renderPicks };

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
  continuityBox.innerHTML = `<div class="notice"><h3>Your councillor changed</h3>
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

/* Council alerts opt-in (BUILD 3) — the link IS the sign-up action;
   while DEME_ALERTS_FORM_URL is empty, only the "open soon" line shows.
   When Deme accounts are active (account.js, config-gated), the
   account layer renders this box instead: for a signed-in visitor
   the account IS the alerts identity and supersedes the form. */
function renderAlerts() {
  if (!alertsBox) return;
  if (window.DemeAccount && window.DemeAccount.enabled()) {
    window.DemeAccount.renderAlerts(alertsBox);
    return;
  }
  alertsBox.innerHTML = `<h3>Council alerts by email</h3>
    <p>Get an email when items on your wards or topics reach a City
    Council agenda. Sign-ups are open now — digests haven't started
    yet, and they begin with the new Council term. When they start, it
    will be one digest per Council agenda, never one email per item,
    and a person reviews every digest before it goes out.</p>
    ${DEME_ALERTS_FORM_URL
      ? `<p><a class="btn bronze" href="${esc(DEME_ALERTS_FORM_URL)}" target="_blank" rel="noopener">Sign up for Council alerts</a></p>
         <p class="small">The sign-up form will ask for your email
         address, your wards and your topics. Nothing is sent until
         digests begin. Unsubscribe at any time.</p>`
      : `<p class="small">Sign-ups are not open right now. When they
         open, alerts will follow the wards and topics in Your Deme.</p>`}`;
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
        <p>Sign in to weigh in — your picks save to your account, and
        we'll notify you when your voting card is ready: how the vote
        went, how your councillor voted, and where you stand — on any
        device.</p>
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
  </div>`;
}
function renderUpcoming() {
  if (!upcomingBox) return;
  if (!upcomingItems.length) {
    upcomingBox.innerHTML = `<div class="calm">
      <h3>No Council votes are scheduled in the published agenda right now.</h3>
      <p>The City publishes each Council agenda ahead of the meeting. When
      the next one appears, its items will be listed here with briefs —
      ready to weigh in on before the vote, not after.</p>
      <p style="margin-bottom:.4rem">Toronto's municipal election is
      <strong>October 26, 2026</strong>; the new Council takes office in
      November, and its first agendas follow. In the meantime, the full
      record is open:</p>
      <p><a class="btn secondary small" href="explore.html">Explore past decisions</a></p>
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
    picksBox.innerHTML = `<div class="calm"><h3>No picks yet.</h3>
      <p>When you weigh in on an upcoming Council item, your position is
      saved here. After the meeting, this page lines your pick up against
      what Council actually did. <a href="#weigh-in">See what's coming
      up →</a></p></div>`;
    agreeBox.innerHTML = "";
    return;
  }
  const councillor = myCouncillor();
  let comparable = 0, matched = 0;
  const blocks = [];
  for (const ref of refs) {
    const pick = picks[ref];
    const card = await findCard(ref);
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
    if (card.hasVote && councillor) {
      try {
        const d = await loadJSON(dataPath(`d/${encodeURIComponent(ref)}.json`));
        const first = d.motions && d.motions[0];
        const mine = first && first.votes.find(([n]) => n === councillor.name);
        if (mine) {
          comparable += 1;
          const aligned = (pick.choice === "support" && mine[1] === "Yes") ||
                          (pick.choice === "oppose" && mine[1] === "No");
          if (aligned) matched += 1;
          councillorLine = `<p style="margin:.4rem 0 0">On the first recorded
            vote on this item, ${esc(councillor.name)} voted
            <strong>${esc(mine[1])}</strong> — ${aligned
              ? "the same way you picked." : "differently from your pick."}</p>`;
        }
      } catch (e) { /* vote detail unavailable */ }
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
  agreeBox.innerHTML = comparable
    ? `<div class="stat"><span class="num">${matched} of ${comparable}</span>
       <span class="lab">decided picks where your councillor's first recorded
       vote matched the position you took. A record, not a score — what you
       do with it is up to you.</span></div>`
    : "";
}

async function init() {
  people = await loadJSON(dataPath("councillors.json"));
  wardNames = new Map(people.filter((p) => p.current && !p.mayor)
    .map((p) => [p.ward, p.wardName]));
  try {
    const td = await loadJSON(dataPath("threads-summary.json"));
    threadThreads = td.threads || [];
  } catch (e) { threadThreads = []; }
  mountFinders();
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
  const profileDoneBtn = document.getElementById("profile-done-btn");
  if (profileDoneBtn) profileDoneBtn.addEventListener("click", () => {
    profileEditing = false;
    topicsEditing = false;
    renderInterests();
    renderProfileChrome();
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
    if (confirm("Erase all your Deme picks, your ward and Your Deme from this browser? (Picks saved to your account are not erased by this — deleting the account itself removes those.)")) {
      VoteStore.resetAll();
      topicsEditing = false;
      renderContinuity();
      mountFinders();
      renderInterests();
      renderPicks();
    }
  });
  renderPicks();
  loadUpcoming();
}
init().catch(() => {
  picksBox.innerHTML = `<p class="small">Your record could not be loaded.</p>`;
});
