/* Decision detail — brief first, outcome next, the named vote one tap
   deeper. The vote and the official wording ride in the per-decision
   file data/d/<ref>.json. */
"use strict";
renderChrome("explore.html");

const ref = new URLSearchParams(location.search).get("ref");
const box = document.getElementById("decision");

async function findCard(ref) {
  /* D2: consult the ref→year manifest first — a hit costs exactly one
     shard fetch, and a miss goes straight to the honest not-in-archive
     answer instead of burning every year's shard. The sequential hunt
     below remains as the fallback if the manifest cannot load. */
  try {
    const manifest = await loadJSON(dataPath("ref-years.json"));
    const y = manifest && manifest[ref];
    if (y) {
      const cards = await loadJSON(dataPath(`index-${y}.json`));
      const hit = cards.find((c) => c.ref === ref);
      if (hit) return { card: hit, year: y };
      return null; /* the manifest is complete: a miss is a true miss */
    }
  } catch (e) { /* manifest unavailable — fall through to the hunt */ }
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
    return `<span class="voteAbs">${simpleT("Declared an interest — stepped back from this vote", "Declared an interest — did not vote on this item")}</span>`;
  return `<span class="voteAbs">Absent</span>`;
}

/* The clerk's motion line ("Majority required - MM43.128 - Adopt the
   Item") is composed into plain words: the threshold to pass plus,
   where the line carries more than the item's own reference, what the
   motion was for. The raw item reference never shows in the vote card —
   it lives in the decision header where it belongs. */
/* Trailing clerk qualifiers ride behind a spaced dash ("- REVOTE",
   "- Part 1 only"); in the composed line they read as plain words. */
function finTail(s) {
  return s.replace(/\s+-\s+REVOTE\b/g, " (revote)").replace(/\s+-\s+/g, ", ");
}

function descLine(m) {
  const d = (m.desc || "").trim();
  if (!d) return "";
  const t = /^(Majority|Two-Thirds)( full Council)? required\s*(.*)$/.exec(d);
  if (!t) {
    return d.replace(/\b\d{4}\.[A-Z]{2}\d+\.\d+\b/g, "")
      .replace(/\s{2,}/g, " ").trim();
  }
  const thr = t[1] === "Majority"
    ? "Majority required to pass"
    : (t[2] ? "Two-thirds of full Council required to pass"
            : "Two-thirds majority required to pass");
  let rest = (t[3] || "")
    .replace(/^\s*-\s*[A-Z]{2}\d+\.\d+\s*-\s*/, "")
    .replace(/^\s*-\s*/, "").trim();
  /* A reference can also ride inside the motion's subject ("Reconsider
     Item CC44.30", "remove EX21.17 from committee") — it never shows. */
  rest = rest
    .replace(/^[A-Z]{2}\d+\.\d+\s+/, "")
    .replace(/\bitem\s+[A-Z]{2}\d+\.\d+\b/gi, "the item")
    .replace(/\b[A-Z]{2}\d+\.\d+\b/g, "the item")
    .replace(/\s{2,}/g, " ").trim();
  if (!rest) return thr + ".";
  let mm;
  const am = /^adopt (?:the )?item,?( as amended)?( - REVOTE)?$/i.exec(rest);
  if (am) {
    return thr + " — to adopt the item"
      + (am[1] ? " as amended" : "") + (am[2] ? " (revote)" : "") + ".";
  }
  if ((mm = /^item( as amended)?$/i.exec(rest))) {
    return thr + " — to adopt the item" + (mm[1] ? " as amended" : "") + ".";
  }
  if (/^waive (the )?referral$/i.test(rest)) return thr + " — to waive referral.";
  if (/^waive notice$/i.test(rest)) return thr + " — to waive notice.";
  if ((mm = /^([A-ZÀ-Þ][\wÀ-ÿ'’.-]*(?: [A-ZÀ-Þ][\wÀ-ÿ'’.-]*)*) - motion (\d+[a-z]?)( as amended)?(?: - (.+))?$/.exec(rest))) {
    return thr + ` — ${mm[1]}, motion ${mm[2]}${mm[3] || ""}`
      + (mm[4] ? `, ${finTail(mm[4].charAt(0).toLowerCase() + mm[4].slice(1))}` : "") + ".";
  }
  if ((mm = /^Add (urgent )?motion - (.+)$/.exec(rest))) {
    return thr + ` — to add ${mm[1] ? "an urgent " : "a "}motion (${mm[2]}).`;
  }
  if ((mm = /^(.+?) - add (urgent )?motion on (.+)$/.exec(rest))) {
    return thr + ` — ${mm[1]}, to add ${mm[2] ? "an urgent " : "a "}motion on ${finTail(mm[3])}.`;
  }
  if ((mm = /^([A-ZÀ-Þ][\wÀ-ÿ'’.-]*(?: [A-ZÀ-Þ][\wÀ-ÿ'’.-]*)*) - (.+)$/.exec(rest))) {
    return thr + ` — ${mm[1]}, ${finTail(mm[2].charAt(0).toLowerCase() + mm[2].slice(1))}.`;
  }
  if (/^(Introduce|Enact|Adopt|Waive|Receive|Refer|Defer)\b/.test(rest)) {
    return thr + " — to " + finTail(rest.charAt(0).toLowerCase() + rest.slice(1)) + ".";
  }
  return thr + " — " + finTail(rest) + ".";
}

function motionBlock(m, idx) {
  /* D-1 (Oct 21, 2026): tally-only motions — the City's published
     record gives the official result but its name-by-name rows for
     the vote are incomplete in the source, so the result stands
     alone; Deme never shows two disagreeing numbers for one vote. */
  if (m.tallyOnly) {
    return `<div class="card" style="margin-top:1rem">
    <h3>${esc(m.type || "Motion")}${m.result ? ` — ${esc(m.result)}` : ""}</h3>
    <p class="small" style="margin:.1rem 0 .5rem">Vote taken at:
      <strong>${esc(m.stage || "City Council")}</strong></p>
    <p class="small">The City's published voting record gives the result
      above, but its name-by-name rows for this vote are incomplete —
      so no breakdown is shown, rather than a wrong one.</p>
  </div>`;
  }
  const absent = m.votes.filter(([, v]) => v === "Absent").length;
  const interest = m.votes.filter(([, v]) => v && v.startsWith("Absent(Interest")).length;
  /* W2: tag the visitor's own representatives in the name-by-name
     table — a label only, read from the VoteStore rep snapshots.
     Owner rule (Oct 20, 2026): the snapshots are primed from the
     signed-in profile ward (My Record's continuity block, Home's
     signed-in flow), so the tag renders only for a signed-in
     visitor; signed out there is no tag, whatever an older build
     left stored on this device. No tag exists when no ward is set,
     and nothing is sent anywhere. */
  const tagReps = typeof demeSignedOut === "function" && !demeSignedOut();
  const wardRep = tagReps && typeof VoteStore !== "undefined" ? VoteStore.getWardRep() : null;
  const mayorRep = tagReps && typeof VoteStore !== "undefined" ? VoteStore.getMayorRep() : null;
  const repTag = (name) => {
    if (wardRep && name === wardRep.name) return ` <span class="pill yourrep">Your councillor</span>`;
    if (mayorRep && name === mayorRep.name) return ` <span class="pill yourrep">Your mayor</span>`;
    return "";
  };
  const rows = m.votes.map(([name, v]) =>
    `<tr><td><a href="councillor.html?name=${encodeURIComponent(name)}">${esc(name)}</a>${repTag(name)}</td>
     <td>${voteCell(v)}</td></tr>`).join("");
  const dl = descLine(m);
  return `<div class="card" style="margin-top:1rem">
    <h3>${esc(m.type || "Motion")}${m.result ? ` — ${esc(m.result)}` : ""}</h3>
    <p class="small" style="margin:.1rem 0 .5rem">Vote taken at:
      <strong>${esc(m.stage || "City Council")}</strong></p>
    ${dl ? `<p class="small">${esc(dl)}</p>` : ""}
    ${bars(m.yes, m.no)}
    <p class="votecaption">of the ${m.yes + m.no} members who voted</p>
    <p class="small">${m.yes + m.no} members voted ·
      ${absent} absent${interest ? ` · ${interest} ` + simpleT("declared an interest — stepped back from this vote", "declared an interest and did not vote") : ""}.</p>
    <details class="recordExpander">
      <summary class="btn secondary small" style="display:inline-flex">See who voted, name by name</summary>
      <table class="record"><thead><tr><th scope="col">Member</th>
      <th scope="col">Vote</th></tr></thead><tbody>${rows}</tbody></table>
    </details>
  </div>`;
}

async function init() {
  if (!ref) {
    box.innerHTML = `<div class="calm"><h2>No decision specified.</h2>
      <p>Browse the <a href="explore.html">record</a> to pick one.</p></div>`;
    return;
  }
  const found = await findCard(ref);
  if (!found) {
    box.innerHTML = `<div class="calm"><h2>That item isn't in the archive.</h2>
      <p>It may predate the decision archive (2018) or the reference may be
      mistyped. <a href="explore.html">Search the record →</a></p></div>`;
    return;
  }
  const { card, year } = found;
  document.title = `${cleanTitle(card.title)} — Deme`;
  /* Topic terms arrive comma-stuffed ("ferries, ferry tickets" as one
     string). Split them into single chips and drop near-duplicates
     ("ferry boats" / "ferryboats") — render-time only; the data and
     the search it feeds stay exactly as published. */
  const normTopic = (t) => t.toLowerCase().replace(/\s+/g, "")
    .replace(/ies$/, "y").replace(/s$/, "");
  /* Two City-keyword artefacts never reach a chip (render-time only,
     same philosophy as the split above — the data and the search it
     feeds stay exactly as published):
       - bare keyword codes ("abccs", "abcds") — internal index codes
         from the City's keyword list, gibberish to a reader;
       - thesaurus variants "circles (roads)", "courts (roads)"… when
         the qualifier itself ("roads") is already one of the item's
         terms — the variant adds nothing the plain term doesn't say. */
  const TOPIC_CODE_FRAGMENTS = new Set(["abccs", "abcds"]);
  const rawParts = [];
  for (const t of card.topics || []) {
    for (const part of String(t).split(",")) {
      const term = part.trim();
      if (term) rawParts.push(term);
    }
  }
  const plainKeys = new Set(rawParts.filter((t) => !/[()]/.test(t))
    .map(normTopic));
  const seenT = new Set();
  const topicTerms = [];
  for (const term of rawParts) {
    if (TOPIC_CODE_FRAGMENTS.has(term.toLowerCase())) continue;
    const paren = /\(([^)]+)\)\s*$/.exec(term);
    if (paren && plainKeys.has(normTopic(paren[1].trim()))) continue;
    const key = normTopic(term);
    if (seenT.has(key)) continue;
    seenT.add(key);
    topicTerms.push(term);
    if (topicTerms.length >= 8) break;
  }
  const topics = topicTerms.map((t) =>
    `<a class="chip" href="explore.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join("");
  const wards = (card.wards && card.wards.length)
    ? `<p class="small">Ward${card.wards.length > 1 ? "s" : ""} affected: ${card.wards.join(", ")}</p>`
    : (card.citywide
      ? `<p class="small">Citywide — this decision applies across Toronto.</p>` : "");

  box.innerHTML = `
    <p class="kicker">${esc(card.body)}</p>
    <h1 style="font-size:clamp(1.6rem,4vw,2.4rem)">${esc(cleanTitle(card.title))}</h1>
    <div class="outcomeRow">
      <span class="pill">${esc(card.statusLabel)}</span>
      <span class="small">${esc(fmtDate(card.date))}</span>
    </div>
    <p class="share-row"><button class="btn secondary small" id="share-btn"
      type="button">Copy link</button></p>
    ${card.brief ? `<p class="briefBig" id="brief-main">${esc(pastVoice(card.brief))}</p>` : `<p class="briefBig" id="brief-fallback">No plain-language summary for this item yet — see the full City record linked below.</p>`}
    ${card.stake ? `<p class="stake stake-prominent">${esc(card.stake)}</p>` : ""}
    ${wards}
    ${topics ? `<div class="chips" style="margin:1rem 0">${topics}</div>` : ""}
    <div id="threadlinks"></div>
    <div id="votezone"><div class="skel-card" aria-hidden="true">
      <span class="skel-el sm"></span><span class="skel-el title"></span>
      <span class="skel-el"></span><span class="skel-el short"></span></div></div>
    <div id="official"></div>
    <p style="margin-top:2rem"><a class="ext" href="${tmmisUrl(card.ref)}"
      target="_blank" rel="noopener">Read the full official record at the
      City of Toronto →<span class="visually-hidden"> (opens in a new tab)</span></a></p>`;

  setupShareButton(document.getElementById("share-btn"));

  /* Keep it simple (restored): where the simpler-worded summary
     corpus covers this decision, offer the toggle the old build
     had. The standard brief stays the default; the simple text
     swaps in place, nothing is re-fetched per toggle. The fetch is
     gated on SIMPLE_YEARS — the years that have a simple shard —
     so a year without one never produces a 404 request; the
     toggle's presence simply reflects availability. For the rare
     card with no standard brief, the simple text is the summary
     and is shown directly, labelled as such. */
  const SIMPLE_YEARS = new Set(["2018", "2019", "2020", "2021", "2022",
    "2023", "2024", "2025", "2026"]);
  if (SIMPLE_YEARS.has(String(year))) {
    loadJSON(dataPath(`simple-${year}.json`)).then((shard) => {
      const simple = shard && shard[card.ref];
      if (!simple) return;
      const briefEl = document.getElementById("brief-main");
      if (!briefEl) {
        const fb = document.getElementById("brief-fallback");
        if (fb) fb.remove();
        const anchor = document.getElementById("threadlinks");
        if (anchor) {
          anchor.insertAdjacentHTML("beforebegin", `
            <div class="brief-head">
              <span class="bh-lab">Simple summary</span>
            </div>
            <p class="briefBig">${esc(simple)}</p>`);
        }
        return;
      }
      briefEl.insertAdjacentHTML("beforebegin", `
        <div class="brief-head">
          <span class="bh-lab" id="brief-mode-label">Plain-language summary</span>
          <button class="simple-toggle" id="simple-toggle" type="button"
            role="switch" aria-checked="false">
            <span class="track" aria-hidden="true"></span>Simpler text</button>
        </div>`);
      const toggle = document.getElementById("simple-toggle");
      const label = document.getElementById("brief-mode-label");
      /* Simpler-text mode (Stream D): the global mode is the starting
         state here; the switch then works per-decision as before, and
         a global toggle re-syncs this page's summary. */
      let simpleActive = simpleOn();
      const applySimple = () => {
        toggle.setAttribute("aria-checked", String(simpleActive));
        briefEl.textContent = simpleActive ? simple : pastVoice(card.brief);
        label.textContent = simpleActive ? "Simple summary" : "Plain-language summary";
      };
      if (simpleActive) applySimple();
      toggle.addEventListener("click", () => {
        simpleActive = !simpleActive;
        applySimple();
      });
      document.addEventListener("deme:simple-changed", (e) => {
        simpleActive = Boolean(e.detail && e.detail.on);
        applySimple();
      });
    }).catch(() => { /* no simple corpus for this year — standard brief only */ });
  }

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
      const hasNames = detail.motions.some((m) => m.votes && m.votes.length);
      const voteKind = simpleT(
        hasNames
          ? "the public list of who voted yes and who voted no."
          : "a recorded tally of the votes for and against. This vote was recorded as a count only, so no name-by-name list exists for it.",
        hasNames
          ? "the public list of who voted yes and who voted no."
          : "a recorded count of the votes for and against. This vote was recorded as a count only, so there is no list of names for it.");
      const motionsNote = detail.motions.length > 1
        ? `There were ${detail.motions.length} recorded votes on this item. ` : "";
      vz.innerHTML = `<h2 style="margin-top:2.2rem">How the vote went</h2>
        <hr class="rule">
        <p class="small">${simpleOn()
          ? `This decision has a <strong>recorded vote</strong>. That is ${voteKind}
        ${motionsNote}Some
        items are voted on at a committee first, before they reach
        Council. Each vote below says which body took it.`
          : `This decision has a <strong>recorded vote</strong> — ${voteKind}
        ${motionsNote}Some
        items are voted on at a committee before reaching Council — every
        vote below is labelled with the body that took it.`}</p>
        ${detail.motions.map(motionBlock).join("")}`;
    } else {
      vz.innerHTML = `<h2 style="margin-top:2.2rem">How the vote went</h2>
        <hr class="rule"><p class="small">The vote record could not be
        loaded. The official record is linked below.</p>`;
    }
  } else {
    vz.innerHTML = `<div class="notice"><strong>No recorded vote.</strong>
      Made without a name-by-name vote, so no member's position is attached to it in the public record. Only about 9 in every 100 Council decisions has one.</div>`;
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
