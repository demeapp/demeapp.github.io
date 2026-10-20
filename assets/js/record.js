/* My Record — resolves each saved pick against the archive: is the item
   decided yet? What was the outcome? If a recorded vote exists and the
   visitor set a ward, how did their councillor vote on the first recorded
   vote of the item, next to the visitor's own pick? All client-side. */
"use strict";
renderChrome("my-record.html");

const wardSel = document.getElementById("ward");
const wardWho = document.getElementById("wardwho");
const picksBox = document.getElementById("picks");
const agreeBox = document.getElementById("agreement");
let people = [];

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
function renderWardWho() {
  const c = myCouncillor();
  wardWho.innerHTML = c
    ? `Your councillor: <a href="councillor.html?m=${encodeURIComponent(c.slug)}">
       <strong>${esc(c.name)}</strong></a> — Ward ${c.ward}, ${esc(c.wardName)}`
    : (VoteStore.getWard() ? "" : "No ward set yet.");
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
  const wardNames = new Map(people.filter((p) => p.current && !p.mayor)
    .map((p) => [p.ward, p.wardName]));
  wardSel.innerHTML = `<option value="">Choose your ward…</option>` +
    Array.from({ length: 25 }, (_, i) => {
      const n = i + 1, name = wardNames.get(n);
      return `<option value="${n}">Ward ${n}${name ? ` — ${esc(name)}` : ""}</option>`;
    }).join("");
  const w = VoteStore.getWard();
  if (w) wardSel.value = String(w);
  renderWardWho();
  wardSel.addEventListener("change", () => {
    VoteStore.setWard(wardSel.value ? Number(wardSel.value) : null);
    renderWardWho();
    renderPicks();
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
    if (confirm("Erase all your Deme picks and your ward from this browser?")) {
      VoteStore.resetAll();
      wardSel.value = "";
      renderWardWho();
      renderPicks();
    }
  });
  renderPicks();
}
init().catch(() => {
  picksBox.innerHTML = `<p class="small">Your record could not be loaded.</p>`;
});
