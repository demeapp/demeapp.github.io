/* Vote — the weigh-in loop over classified upcoming Council items.
   Picks persist through VoteStore (browser-local). Nothing here ever
   renders an aggregate of visitors' picks: there is no such data. */
"use strict";
renderChrome("vote.html");

const zone = document.getElementById("upcoming");

/* Council alerts opt-in (BUILD 3) — the link IS the sign-up action;
   while DEME_ALERTS_FORM_URL is empty, only the "open soon" line shows. */
const alertsAction = document.getElementById("alerts-action");
if (alertsAction) {
  alertsAction.innerHTML = DEME_ALERTS_FORM_URL
    ? `<p><a class="btn bronze" href="${esc(DEME_ALERTS_FORM_URL)}" target="_blank" rel="noopener">Sign up for Council alerts</a></p>
       <p class="small">The sign-up form will ask for your email address,
       your wards and your topics. Nothing is sent until digests begin.
       Unsubscribe at any time.</p>`
    : `<p class="small">Sign-ups are not open right now. When they open,
       alerts will follow the wards and topics in Your Deme.</p>`;
}

function weighInHTML(u) {
  const pick = VoteStore.getPick(u.ref);
  const picked = pick ? pick.choice : null;
  return `<div class="weighin" id="w-${CSS.escape(u.ref)}">
    <div class="choices" role="group" aria-label="Your position on ${esc(u.title)}">
      <button class="choice support" data-ref="${esc(u.ref)}" data-choice="support"
        aria-pressed="${picked === "support"}">Support</button>
      <button class="choice oppose" data-ref="${esc(u.ref)}" data-choice="oppose"
        aria-pressed="${picked === "oppose"}">Oppose</button>
    </div>
    <p class="savedNote" aria-live="polite">${picked
      ? `Your pick: <strong>${picked === "support" ? "Support" : "Oppose"}</strong> —
         saved on this device. Tap the other side to change it, any time
         before the meeting.`
      : "No pick yet. Your pick is saved on this device only."}</p>
  </div>`;
}

function bindWeighIns() {
  /* One delegated listener for the whole zone — safe across re-renders. */
  if (zone.dataset.bound) return;
  zone.dataset.bound = "1";
  zone.addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    const ref = btn.dataset.ref, choice = btn.dataset.choice;
    const current = VoteStore.getPick(ref);
    if (current && current.choice === choice) {
      VoteStore.clearPick(ref);
    } else {
      VoteStore.setPick(ref, choice);
    }
    const wrap = document.getElementById(`w-${CSS.escape(ref)}`);
    const item = (window._upcomingItems || []).find((u) => u.ref === ref);
    if (wrap && item) {
      const fresh = document.createElement("div");
      fresh.innerHTML = weighInHTML(item);
      /* Confirm-animation hook only: CSS animates .savedNote.pop (and the
         pressed .choice) under no-preference motion. Logic unchanged. */
      const note = fresh.querySelector(".savedNote");
      if (note) note.classList.add("pop");
      wrap.replaceWith(fresh.firstElementChild);
    }
  });
}

loadJSON(dataPath("upcoming.json")).then((up) => {
  /* Defence in depth: the Vote page shows City Council business only.
     The exporter enforces this upstream; the page enforces it again so
     no payload — regenerated or edited — can put a board or committee
     item in front of a visitor as a Council vote. */
  const items = (up.items || []).filter((u) => u.body === "City Council");
  window._upcomingItems = items;
  if (!items.length) {
    zone.innerHTML = `<div class="calm">
      <h3>No Council votes are scheduled in the published agenda right now.</h3>
      <p>The City publishes each Council agenda ahead of the meeting. When
      the next one appears, its items will be listed here with briefs —
      ready to weigh in on before the vote, not after.</p>
      <p style="margin-bottom:.4rem">Toronto's municipal election is
      <strong>October 26, 2026</strong>; the new Council takes office in
      November, and its first agendas follow. In the meantime, the full
      record is open:</p>
      <p><a class="btn secondary small" href="explore.html">Explore past decisions</a>
      <a class="btn secondary small" href="my-record.html">Set your ward in My Record</a></p>
    </div>`;
    return;
  }
  zone.innerHTML = items.map((u) => `
    <article class="card" style="margin-bottom:1rem">
      <div class="meta"><span>${esc(fmtDate(u.date))}</span>
        <span>${esc(u.body)}</span><span class="pill ink">Coming up</span></div>
      <h3>${esc(u.title)}</h3>
      ${u.brief ? `<p>${esc(u.brief)}</p>` : ""}
      ${weighInHTML(u)}
    </article>`).join("");
  bindWeighIns();
  if (location.hash) {
    const target = document.getElementById(`w-${CSS.escape(location.hash.slice(1))}`);
    if (target) target.scrollIntoView({ block: "center" });
  }
}).catch(() => {
  zone.innerHTML = `<p class="small">What's coming up could not be loaded. Please reload.</p>`;
});
