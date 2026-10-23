/* Deme — embed card + embed page logic (Improvement 4: Distribution).

   Shared by two pages:
   - embed-card.html — the lightweight, iframe-able card itself. It has
     no site chrome; this file populates its ward picker, member summary
     and latest decisions for the picked ward.
   - embed.html — the public "embed this card" page. This file wires
     its live preview (ward picker that retargets the iframe) and its
     copy-the-snippet button.

   Data is fetched relative (data/...) so the card works wherever the
   site is served. Outbound links (member + decision pages, the credit
   line) point at the canonical site, because when the card is iframed
   on someone else's site a relative link would resolve to their site,
   not Deme's. */
"use strict";

const DEME_BASE = "https://demeapp.github.io/";
const EMBED_CARD_URL = `${DEME_BASE}embed-card.html`;
const ATTENDANCE_DEFINITION =
  "present and voting, out of recorded votes where a vote was theirs to cast";

/* ---------- shared helpers ---------- */

function embedWardFromURL() {
  try {
    const raw = new URLSearchParams(location.search).get("ward");
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 25 ? n : null;
  } catch (e) {
    return null;
  }
}

function embedCurrentWards(people) {
  return (people || [])
    .filter((p) => p.current && !p.mayor && p.ward != null)
    .slice()
    .sort((a, b) => a.ward - b.ward);
}

function embedWardOptionsHTML(people, placeholder) {
  const wards = embedCurrentWards(people);
  const first = placeholder
    ? `<option value="">${esc(placeholder)}</option>`
    : "";
  return first + wards.map((p) =>
    `<option value="${p.ward}">Ward ${p.ward} — ${esc(p.wardName || "")}</option>`
  ).join("");
}

function embedDecisionsForWard(latest, ward) {
  const council = latest && Array.isArray(latest.council)
    ? latest.council : [];
  return council
    .filter((d) => Array.isArray(d.wards) && d.wards.indexOf(ward) !== -1)
    .slice(0, 3);
}

/* ---------- the card (embed-card.html) ---------- */

function embedCardFallbackHTML() {
  return `<div class="embed-state">
    <p><strong>The record could not load here.</strong></p>
    <p class="small">You can still read your ward&rsquo;s record on Deme.</p>
    <p><a class="btn small" href="${DEME_BASE}" target="_blank"
      rel="noopener">Open Deme</a></p>
  </div>`;
}

function embedMemberHTML(person, decisions) {
  const wardLabel = `Ward ${person.ward} — ${person.wardName || ""}`;
  const memberHref =
    `${DEME_BASE}councillor.html?m=${encodeURIComponent(person.slug)}`;
  const decisionItems = decisions.length
    ? `<ul class="embed-decisions">${decisions.map((d) => {
        const href =
          `${DEME_BASE}decision.html?ref=${encodeURIComponent(d.ref)}`;
        const meta = [fmtDate(d.date), d.statusLabel].filter(Boolean).join(" · ");
        return `<li>
          <a href="${esc(href)}" target="_blank" rel="noopener">${esc(d.title)}</a>
          ${meta ? `<span class="embed-decision-meta">${esc(meta)}</span>` : ""}
        </li>`;
      }).join("")}</ul>`
    : `<p class="small embed-no-decisions">No recent City Council
       decisions in the latest batch are tagged to this ward. Citywide
       decisions still apply — see the full record on Deme.</p>`;
  return `
    <div class="embed-member">
      <p class="embed-ward">${esc(wardLabel)}</p>
      <h2 class="embed-name">
        <a href="${esc(memberHref)}" target="_blank"
           rel="noopener">${esc(person.name)}</a>
      </h2>
      <div class="embed-stats">
        <div class="embed-stat">
          <span class="embed-stat-num">${esc(fmtAtt(person))}</span>
          <span class="embed-stat-lab">Recorded-vote participation</span>
        </div>
        <div class="embed-stat">
          <span class="embed-stat-num">${esc(fmtNum(person.votesCast))}</span>
          <span class="embed-stat-lab">Votes cast</span>
        </div>
      </div>
      <p class="embed-def">Recorded-vote participation: ${esc(ATTENDANCE_DEFINITION)}.</p>
    </div>
    <div class="embed-latest">
      <h3 class="embed-latest-h">Latest decisions for this ward</h3>
      ${decisionItems}
    </div>`;
}

async function initEmbedCard() {
  const select = document.getElementById("embed-ward-select");
  const body = document.getElementById("embed-card-body");
  if (!select || !body) return;

  let people = [];
  let latest = null;
  try {
    const [councillors, latestData] = await Promise.all([
      loadJSON(dataPath("councillors.json")),
      loadJSON(dataPath("latest.json")),
    ]);
    people = Array.isArray(councillors) ? councillors : [];
    latest = latestData;
  } catch (e) {
    body.innerHTML = embedCardFallbackHTML();
    select.disabled = true;
    return;
  }

  const wards = embedCurrentWards(people);
  if (!wards.length) {
    body.innerHTML = embedCardFallbackHTML();
    select.disabled = true;
    return;
  }

  select.innerHTML = embedWardOptionsHTML(people, "Choose your ward…");
  select.disabled = false;

  function render(ward) {
    if (ward == null) {
      body.innerHTML = `<p class="small embed-hint">Pick a ward above to
        see its member, their recorded-vote participation and votes cast, and the latest
        decisions tagged to that ward.</p>`;
      return;
    }
    const person = wards.find((p) => p.ward === ward);
    if (!person) {
      body.innerHTML = embedCardFallbackHTML();
      return;
    }
    body.innerHTML = embedMemberHTML(
      person, embedDecisionsForWard(latest, ward));
  }

  const initial = embedWardFromURL();
  if (initial != null && wards.some((p) => p.ward === initial)) {
    select.value = String(initial);
    render(initial);
  } else {
    render(null);
  }

  select.addEventListener("change", () => {
    const n = Number(select.value);
    render(Number.isInteger(n) && n >= 1 && n <= 25 ? n : null);
    /* Keep the card's own URL honest, so a host copying the address
       bar (or a reader opening the card full-page) keeps the ward. */
    try {
      const url = new URL(location.href);
      if (select.value) url.searchParams.set("ward", select.value);
      else url.searchParams.delete("ward");
      history.replaceState(null, "", url.toString());
    } catch (e) { /* history unavailable in some embeds — not fatal */ }
  });
}

/* ---------- the embed page (embed.html) ---------- */

function embedSnippet(ward) {
  const src = ward ? `${EMBED_CARD_URL}?ward=${ward}` : EMBED_CARD_URL;
  return `<iframe src="${src}" title="Your ward's record — Deme" width="100%" height="520" style="border:1px solid #D7DEE8;border-radius:12px;max-width:480px" loading="lazy"></iframe>`;
}

async function initEmbedPage() {
  const frame = document.getElementById("embed-preview-frame");
  const snippetEl = document.getElementById("embed-snippet");
  const copyBtn = document.getElementById("embed-copy");
  const copyNote = document.getElementById("embed-copy-note");
  const wardSelect = document.getElementById("embed-preview-ward");
  if (!frame && !snippetEl) return;

  let currentWard = embedWardFromURL();

  function sync() {
    const snippet = embedSnippet(currentWard);
    if (snippetEl) snippetEl.value = snippet;
    if (frame) {
      /* The preview loads the card relatively, so it works in local
         previews and on the published site alike; the snippet readers
         copy always carries the canonical absolute address. */
      frame.src = currentWard
        ? `embed-card.html?ward=${currentWard}`
        : "embed-card.html";
    }
    if (wardSelect && currentWard != null) {
      wardSelect.value = String(currentWard);
    }
  }

  if (wardSelect) {
    try {
      const people = await loadJSON(dataPath("councillors.json"));
      wardSelect.innerHTML =
        embedWardOptionsHTML(people, "Any ward (reader picks)");
      if (currentWard != null) wardSelect.value = String(currentWard);
      wardSelect.disabled = false;
    } catch (e) {
      /* The picker is a convenience; the snippet still works without it. */
      wardSelect.disabled = true;
    }
    wardSelect.addEventListener("change", () => {
      const n = Number(wardSelect.value);
      currentWard = Number.isInteger(n) && n >= 1 && n <= 25 ? n : null;
      if (copyNote) copyNote.textContent = "";
      sync();
    });
  }

  if (copyBtn && snippetEl) {
    copyBtn.addEventListener("click", async () => {
      snippetEl.focus();
      snippetEl.select();
      let copied = false;
      try {
        await navigator.clipboard.writeText(snippetEl.value);
        copied = true;
      } catch (e) {
        try { copied = document.execCommand("copy"); } catch (e2) {}
      }
      if (copyNote) {
        copyNote.textContent = copied
          ? "Copied — paste it where your page accepts HTML."
          : "Select the code above and copy it.";
      }
    });
  }

  sync();
}

/* Each page loads only the mount points it owns, so one file can
   safely initialise whichever page it finds itself on. */
initEmbedCard();
initEmbedPage();
