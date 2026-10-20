/* My Record — resolves each saved pick against the archive: is the item
   decided yet? What was the outcome? If a recorded vote exists and the
   visitor set a ward, how did their councillor vote on the first recorded
   vote of the item, next to the visitor's own pick? All client-side. */
"use strict";
renderChrome("my-record.html");

const interestsBox = document.getElementById("interests");
const continuityBox = document.getElementById("continuity");
const alertsBox = document.getElementById("profile-alerts");
const picksBox = document.getElementById("picks");
const agreeBox = document.getElementById("agreement");
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
   show is always the stored truth. The profile card carries the
   postal-code privacy note once for the whole area, so the finders
   here suppress their per-finder copy (privacyNote: false). */
function mountFinders() {
  const primaryEl = document.getElementById("ward-finder-primary");
  if (primaryEl) {
    WardFinder.mount(primaryEl, {
      idPrefix: "rec1",
      people,
      label: "Find your ward by postal code",
      privacyNote: false,
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
      privacyNote: false,
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
    return;
  }
  if (summaryBox) summaryBox.innerHTML = "";
  interestsBox.style.display = "";
  interestsBox.innerHTML = threadThreads.map((t) =>
    `<button type="button" class="chip" data-id="${esc(t.id)}" aria-pressed="${ints.includes(t.id)}">${esc(t.label)}</button>`).join("");
  if (doneRow) doneRow.hidden = !ints.length;
}

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

async function renderPicks() {
  const picks = VoteStore.allPicks();
  const refs = Object.keys(picks).sort(
    (a, b) => (picks[a].ts < picks[b].ts ? 1 : -1));
  if (!refs.length) {
    picksBox.innerHTML = `<div class="calm"><h3>No picks yet.</h3>
      <p>When you weigh in on an upcoming Council item, your position is
      saved here. After the meeting, this page lines your pick up against
      what Council actually did. <a href="vote.html">See how weighing in
      works →</a></p></div>`;
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
    if (confirm("Erase all your Deme picks, your ward and Your Deme from this browser?")) {
      VoteStore.resetAll();
      topicsEditing = false;
      renderContinuity();
      mountFinders();
      renderInterests();
      renderPicks();
    }
  });
  renderPicks();
}
init().catch(() => {
  picksBox.innerHTML = `<p class="small">Your record could not be loaded.</p>`;
});
