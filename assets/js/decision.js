/* Decision detail — brief first, outcome next, the named vote one tap
   deeper. The vote and the official wording ride in the per-decision
   file data/d/<ref>.json. */
"use strict";
renderChrome("explore.html");

const ref = new URLSearchParams(location.search).get("ref");
const box = document.getElementById("decision");

async function findCard(ref) {
  const prefixYear = ref.slice(0, 4);
  const years = [prefixYear, "2026", "2025", "2024", "2023", "2022", "2021",
    "2020", "2019", "2018"].filter((v, i, a) => a.indexOf(v) === i);
  for (const y of years) {
    try {
      const cards = await loadJSON(dataPath(`index-${y}.json`));
      const hit = cards.find((c) => c.ref === ref);
      if (hit) return { card: hit, year: y };
    } catch (e) { /* try next year */ }
  }
  return null;
}

function bars(yes, no) {
  const total = Math.max(yes + no, 1);
  return `<div class="votebars" aria-hidden="true">
    <div class="row"><span>Yes</span>
      <span class="bar"><span class="fill y" style="display:block;width:${(100 * yes / total).toFixed(1)}%"></span></span>
      <span class="n">${yes}</span></div>
    <div class="row"><span>No</span>
      <span class="bar"><span class="fill n" style="display:block;width:${(100 * no / total).toFixed(1)}%"></span></span>
      <span class="n">${no}</span></div>
  </div>`;
}

function voteCell(v) {
  if (v === "Yes") return `<span class="voteYes">Yes</span>`;
  if (v === "No") return `<span class="voteNo">No</span>`;
  if (v && v.startsWith("Absent(Interest"))
    return `<span class="voteAbs">Declared an interest — did not vote</span>`;
  return `<span class="voteAbs">Absent</span>`;
}

function motionBlock(m, idx) {
  const absent = m.votes.filter(([, v]) => v === "Absent").length;
  const interest = m.votes.filter(([, v]) => v && v.startsWith("Absent(Interest")).length;
  const rows = m.votes.map(([name, v]) =>
    `<tr><td><a href="councillor.html?name=${encodeURIComponent(name)}">${esc(name)}</a></td>
     <td>${voteCell(v)}</td></tr>`).join("");
  return `<div class="card" style="margin-top:1rem">
    <h3>${esc(m.type || "Motion")}${m.result ? ` — ${esc(m.result)}` : ""}</h3>
    <p class="small" style="margin:.1rem 0 .5rem">Vote taken at:
      <strong>${esc(m.stage || "City Council")}</strong></p>
    ${m.desc ? `<p class="small">${esc(m.desc)}</p>` : ""}
    ${bars(m.yes, m.no)}
    <p class="small">${m.yes + m.no} members voted ·
      ${absent} absent${interest ? ` · ${interest} declared an interest and did not vote` : ""}.</p>
    <details class="recordExpander">
      <summary class="btn secondary small" style="display:inline-flex">See who voted, name by name</summary>
      <table class="record"><thead><tr><th scope="col">Member</th>
      <th scope="col">Vote</th></tr></thead><tbody>${rows}</tbody></table>
    </details>
  </div>`;
}

async function init() {
  if (!ref) {
    box.innerHTML = `<div class="calm"><h3>No decision specified.</h3>
      <p>Browse the <a href="explore.html">record</a> to pick one.</p></div>`;
    return;
  }
  const found = await findCard(ref);
  if (!found) {
    box.innerHTML = `<div class="calm"><h3>That item isn't in the archive.</h3>
      <p>It may predate the decision archive (2018) or the reference may be
      mistyped. <a href="explore.html">Search the record →</a></p></div>`;
    return;
  }
  const { card, year } = found;
  document.title = `${card.title} — Deme`;
  const topics = (card.topics || []).slice(0, 4).map((t) =>
    `<a class="chip" href="explore.html?q=${encodeURIComponent(t.split(",")[0])}">${esc(t)}</a>`).join("");
  const wards = (card.wards && card.wards.length)
    ? `<p class="small">Ward${card.wards.length > 1 ? "s" : ""} affected: ${card.wards.join(", ")}</p>`
    : (card.citywide
      ? `<p class="small">Citywide — this decision applies across Toronto.</p>` : "");

  box.innerHTML = `
    <p class="kicker">${esc(card.body)} · Item ${esc(card.ref)}</p>
    <h1 style="font-size:clamp(1.6rem,4vw,2.4rem)">${esc(card.title)}</h1>
    <div class="outcomeRow">
      <span class="pill">${esc(card.statusLabel)}</span>
      <span class="small">${esc(fmtDate(card.date))}</span>
    </div>
    ${card.brief ? `<p class="briefBig">${esc(pastVoice(card.brief))}</p>` : ""}
    ${card.stake ? `<p class="stake stake-prominent">${esc(card.stake)}</p>` : ""}
    ${wards}
    ${topics ? `<div class="chips" style="margin:1rem 0">${topics}</div>` : ""}
    <div id="threadlinks"></div>
    <div id="votezone"></div>
    <div id="official"></div>
    <p style="margin-top:2rem"><a class="ext" href="${tmmisUrl(card.ref)}"
      target="_blank" rel="noopener">Read the full official record at the
      City of Toronto →</a></p>`;

  /* Story threads this decision belongs to. Membership rides on the
     card itself (exporter's `th`); labels come from the tiny summary
     shard — decision pages never fetch the full threads.json (D9). */
  try {
    const tids = card.th || [];
    if (tids.length) {
      const sdata = await loadJSON(dataPath("threads-summary.json"));
      const labels = new Map((sdata.threads || []).map((t) => [t.id, t.label]));
      const mine = tids.filter((id) => labels.has(id));
      const tl = document.getElementById("threadlinks");
      if (mine.length && tl) {
        tl.innerHTML = `<p class="small" style="margin:.4rem 0 .5rem">More in this story:</p>
          <div class="chips">${mine.map((id) =>
            `<a class="chip" href="thread.html?t=${encodeURIComponent(id)}">${esc(labels.get(id))}</a>`).join("")}</div>`;
      }
    }
  } catch (e) { /* threads are an enhancement, not a requirement */ }

  /* One per-decision file now carries both the recorded vote and the
     official wording (Wave 2): data/d/<ref>.json has "motions" when a
     recorded vote exists and a "text" pair — what the item proposed /
     what was decided — folded in from the old per-year text shards,
     which decision pages no longer download. */
  let detail = null;
  try {
    detail = await loadJSON(dataPath(`d/${encodeURIComponent(ref)}.json`));
  } catch (e) { /* both blocks below degrade gracefully */ }

  const vz = document.getElementById("votezone");
  if (card.hasVote) {
    if (detail && detail.motions) {
      vz.innerHTML = `<h2 style="margin-top:2.2rem">How the vote went</h2>
        <hr class="rule">
        <p class="small">This decision has a <strong>recorded vote</strong> —
        the public list of who voted yes and who voted no.
        ${detail.motions.length > 1 ? `There were ${detail.motions.length} recorded votes on this item. ` : ""}Some
        items are voted on at a committee before reaching Council — every
        vote below is labelled with the body that took it.</p>
        ${detail.motions.map(motionBlock).join("")}`;
    } else {
      vz.innerHTML = `<h2 style="margin-top:2.2rem">How the vote went</h2>
        <hr class="rule"><p class="small">The vote record could not be
        loaded. The official record is linked below.</p>`;
    }
  } else {
    vz.innerHTML = `<div class="notice"><strong>No recorded vote.</strong>
      This decision was made without a name-by-name vote, so no member's
      position is attached to it in the public record. Only about 1 in 11
      Council decisions has one.</div>`;
  }

  const t = detail && detail.text;
  if (t && (t[0] || t[1])) {
    document.getElementById("official").innerHTML = `
      <details class="recordExpander">
        <summary class="btn secondary small" style="display:inline-flex">Read the official wording</summary>
        ${t[0] ? `<h3 style="margin-top:1.2rem">What the item proposed</h3><p style="max-width:44rem">${esc(t[0])}</p>` : ""}
        ${t[1] ? `<h3>What was decided</h3><p style="max-width:44rem">${esc(t[1])}</p>` : ""}
      </details>`;
  }
}
/* Print (D4): Chromium does not render the children of a CLOSED
   <details> in print, whatever the CSS says — so for printing, open
   every expander (the name-by-name vote breakdown and the official
   wording are the two things a printed decision exists for), and
   restore the reader's own open/closed state afterwards. */
(function printExpanders() {
  let opened = [];
  window.addEventListener("beforeprint", () => {
    opened = [];
    document.querySelectorAll("details:not([open])").forEach((d) => {
      d.setAttribute("open", "");
      opened.push(d);
    });
  });
  window.addEventListener("afterprint", () => {
    opened.forEach((d) => d.removeAttribute("open"));
    opened = [];
  });
})();

init();
