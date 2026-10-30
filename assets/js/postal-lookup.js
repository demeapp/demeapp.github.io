/* Deme — "Who represents me?" postal-code lookup (B6, Oct 30, 2026).
   One module, two mounts: the unified panel on representatives.html
   and the panel in the homepage's Start Here section. Both mounts
   are static shells carrying [data-postal-lookup]; this file wires
   every one it finds.

   The resolution rule is record-data/lookup.js, unchanged: only the
   first 3 characters of a code (the FSA) are ever read; sub-1%
   land-area slivers drop out; one surviving district resolves; more
   than one means the visitor confirms — the lookup never picks; a
   district with no current member is a vacant seat, shown as one.
   For the federal and provincial levels the rule was applied
   offline to produce record-data/lookup-federal.json and
   lookup-provincial.json (per-FSA status baked in; verified
   equivalent to the live resolver over all 521 Ontario FSAs at
   build time). Toronto wards resolve here from
   record-data/fsa-wards.json under the same rules WardFinder uses.
   Land-area shares order candidate lists only; they are never
   shown as likelihoods.

   Privacy is mechanical, not promised: the three data files are
   same-origin static files, identical for every visitor, and no
   request ever carries any part of a code; the code is not written
   to the DOM beyond the input itself, the URL, storage, or any
   log; nothing is saved and no profile is touched. Cards render
   from the live rosters by memberId — the lookup files carry no
   names, parties, photos or figures of their own, so a roster
   update (a by-election, a vacancy, the Nov 15, 2026 council)
   flows into the results with no second copy to go stale.

   The provincial tier is PROVISIONAL (its geometry basis is the
   federal-2013 namesake set the Representation Act, 2015 adopts,
   not Elections Ontario's own polygons); its results carry the
   standing provisional note, and its carved northern districts
   arrive as candidate lists by construction. */
"use strict";

const DemePostalLookupUI = (() => {
  /* ---------- lazy data (only what a lookup actually needs) ----------
     Loaded on the first valid lookup, never for malformed input.
     loadJSON caches by path, so rosters shared with the directory
     renderers are fetched once. */
  const once = {};
  function dataOnce(key, path) {
    if (!once[key]) {
      once[key] = loadJSON(dataPath(path)).catch((e) => {
        delete once[key];
        throw e;
      });
    }
    return once[key];
  }

  /* ---------- input ----------
     Normalisation follows the site's existing finders (non-
     alphanumerics stripped); validation is lookup.js's shape: an
     FSA alone, or a full 6-character code, letter-digit-letter
     first. Only the FSA is kept. */
  function parseFsa(raw) {
    const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]\d[A-Z](\d[A-Z]\d)?$/.test(code)) return null;
    return code.slice(0, 3);
  }

  /* ---------- layer card path ----------
     The Ontario/Canada directory card (layer-directory.js) and its
     page configuration (representatives.html's DEME_LAYER_PAGE),
     mirrored so a lookup card is the directory's card: same avatar,
     same participation module, same two-item footer. Keyed by the
     roster entry the lookup's memberId names. */
  const LAYER_CFG = {
    ontario: {
      layer: "ontario", dataDir: "record-data/ontario/",
      profilePage: "mpp.html", idParam: "m",
      photoDir: "assets/headshots/ontario/",
      roleLine: (p) => `MPP · ${p.riding}`,
      tenureCurrent: (p) => `Since ${p.firstYear}`,
      interestsLabel: "Disclosure statements on file (annual statements, 2005–2025)",
      interestsValue: (p) => p.pdsStatements,
      docNoun: (n) => (n === 1 ? "disclosure statement" : "disclosure statements"),
    },
    canada: {
      layer: "canada", dataDir: "record-data/federal/",
      profilePage: "mp.html", idParam: "m",
      photoDir: "assets/headshots/federal/",
      roleLine: (p) => `MP · ${p.riding}${p.province ? `, ${p.province}` : ""}`,
      tenureCurrent: (p) => (p.parliaments > 1
        ? `${p.parliaments} parliaments · since ${p.firstYear}`
        : `Since ${p.firstYear}`),
      interestsLabel: "Ethics registry documents on file",
      interestsValue: (p) => p.interestsDocuments,
      docNoun: (n) => (n === 1 ? "ethics registry document" : "ethics registry documents"),
    },
  };

  function layerAvatar(cfg, person) {
    const img = person.photo
      ? `<img src="${cfg.photoDir}${encodeURIComponent(person.id || person.slug)}.webp"
          alt="" loading="lazy" decoding="async" onerror="demeAvatarError(this)">`
      : "";
    return `<span class="avatar " aria-hidden="true"><span>${esc(initialsOf(person.name))}</span>${img}</span>`;
  }

  function layerTenure(cfg, p) {
    if (p.firstYear == null) return "—";
    if (p.current) return cfg.tenureCurrent(p);
    return p.lastYear && p.lastYear !== p.firstYear
      ? `${p.firstYear}–${p.lastYear}` : `${p.firstYear}`;
  }

  function layerStatsHTML(cfg, p) {
    return `<div class="member-stats" aria-label="Record summary">
      <div><span>Votes cast</span><strong>${fmtNum(p.votesCast)}</strong></div>
      <div><span>${simpleT("Tenure", "How long they have served")}</span><strong>${esc(layerTenure(cfg, p))}</strong></div>
      <div><span>${esc(cfg.interestsLabel)}</span><strong>${fmtNum(cfg.interestsValue(p))}</strong></div>
    </div>`;
  }

  function layerCard(cfg, p, part) {
    const entry = part ? part.members[p.id || p.slug] : null;
    const docN = cfg.interestsValue(p);
    const docItem = docN == null ? ""
      : `<b>${fmtNum(docN)}</b> ${cfg.docNoun(docN)}`;
    const record = entry
      ? `${participationCardModule(entry,
          { layer: cfg.layer, current: !!p.current, incoming: false,
            currentLabel: partCurrentLabel(part, cfg.layer) })}
         ${repCardFooterHTML([esc(layerTenure(cfg, p)), docItem])}`
      : layerStatsHTML(cfg, p);
    return `<article class="person">
      <div class="person-top">${layerAvatar(cfg, p)}
        <div>
          <h3><a href="${cfg.profilePage}?${cfg.idParam}=${encodeURIComponent(p.id || p.slug)}">${esc(p.name)}</a></h3>
          <p class="ward">${esc(cfg.roleLine(p))}</p>
          ${p.party ? `<span class="party-pill">${esc(p.party)}</span>` : ""}
        </div>
      </div>
      ${record}
    </article>`;
  }

  /* ---------- Toronto card path ----------
     The Toronto directory card (toronto-directory.js personCard,
     including its incoming-member block), mirrored on the same
     shared primitives, keyed by the councillors.json entry for the
     ward. */
  function torontoIncomingBlock(c) {
    const prior = (c.terms || []).filter((t) => t !== "2026-2030");
    const recordLine = prior.length
      ? `Returning to Council — their earlier service (${esc(prior[0].slice(0, 4))}–${esc(prior[prior.length - 1].slice(5))}) is on their record page. Their new-term record begins November 15, 2026.`
      : "No votes yet — their voting record begins with the new term.";
    return `<div class="incoming-block">
      <p class="incoming-marker"><strong>Elected October 26, 2026 — takes office November 15, 2026</strong></p>
      <p class="incoming-record">${recordLine}</p>
      <p class="incoming-portrait">No official portrait for the new term yet — the City of Toronto has not published one. Their initials stand in until it does; Deme adds official portraits as the City publishes them.</p>
    </div>`;
  }

  function torontoCard(c, part) {
    const role = c.mayor ? "Mayor of Toronto"
      : `Councillor · Ward ${c.ward} — ${esc(c.wardName)}`;
    const e = part ? part.members[c.slug] : null;
    const partModule = e
      ? participationCardModule(e, {
          layer: "toronto",
          current: !!c.current, incoming: !!c.incoming,
          currentLabel: partCurrentLabel(part, "toronto"),
        })
      : "";
    const intItem = (c.lastSeen && c.lastSeen < "2023-06-01")
      ? "Interest record starts Jun 2023"
      : `<b>${fmtNum(Number(c.interest) || 0)}</b> declared interest${Number(c.interest) === 1 ? "" : "s"} · since Jun 2023`;
    const footer = repCardFooterHTML([esc(memberTenure(c)), intItem]);
    let stats, module;
    if (!e) {
      stats = c.incoming ? torontoIncomingBlock(c) : memberStatsHTML(c);
      module = "";
    } else if (c.incoming && e.career.pct == null) {
      stats = `<div class="incoming-block"><p class="incoming-marker"><strong>Elected October 26, 2026 — takes office November 15, 2026</strong></p></div>`;
      module = partModule;
    } else if (c.incoming) {
      stats = torontoIncomingBlock(c);
      module = `${partModule}${footer}`;
    } else {
      stats = "";
      module = `${partModule}${footer}`;
    }
    return `<article class="person${c.mayor ? " is-mayor" : ""}">
      <div class="person-top">${avatarHTML(c)}
        <div>
          <h3><a href="councillor.html?m=${encodeURIComponent(c.slug)}">${esc(c.name)}</a></h3>
          <p class="ward">${role}</p>
        </div>
      </div>
      ${stats}
      ${module}
    </article>`;
  }

  /* ---------- the vacant-seat card ----------
     The one new visual element: the directory card's skeleton with
     the portrait position carrying the vacant label instead of a
     person. No photo, no figure — the seat, its vacancy, and, where
     the roster holds one, the last member as past record. */
  function vacantCard(o) {
    const last = o.lastHolder
      ? `<p class="small pl-lastholder">Last held by <a href="${o.profilePage}?m=${encodeURIComponent(o.lastHolder.id)}">${esc(o.lastHolder.name)}</a>${o.lastHolder.years ? ` (${esc(o.lastHolder.years)})` : ""} — see their record.</p>`
      : "";
    return `<article class="person pl-vacant-card">
      <div class="person-top"><span class="avatar pl-vacant-disc" aria-hidden="true"><span>Vacant</span></span>
        <div>
          <h3>${esc(o.riding)}</h3>
          <p class="ward">${esc(o.roleLine)}</p>
        </div>
      </div>
      <p class="pl-vacant-line">This seat is currently vacant.</p>
      ${last}
    </article>`;
  }

  function lastHolderFor(roster, riding) {
    let best = null;
    for (const p of roster || []) {
      if (p.current || p.riding !== riding) continue;
      if (!best || (p.lastYear || 0) > (best.lastYear || 0)) best = p;
    }
    if (!best) return null;
    return {
      id: best.id || best.slug,
      name: best.name,
      years: best.firstYear
        ? (best.lastYear && best.lastYear !== best.firstYear
          ? `${best.firstYear}–${best.lastYear}` : `${best.firstYear}`)
        : "",
    };
  }

  /* ---------- copy helpers ---------- */
  const NUMWORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight" };
  const LEVEL_HEAD = {
    toronto: { title: "Your councillor", sub: "Toronto City Council" },
    ontario: { title: "Your MPP", sub: "Ontario Legislature" },
    canada: { title: "Your MP", sub: "House of Commons" },
  };
  const MAP_LINE = {
    toronto: `<p class="small">Or check the ward map at <a href="https://www.toronto.ca">the City of Toronto</a>.</p>`,
    ontario: `<p class="small">Or check the district map at <a href="https://www.elections.on.ca">Elections Ontario</a>.</p>`,
    canada: `<p class="small">Or check the district map at <a href="https://www.elections.ca">Elections Canada</a>.</p>`,
  };

  function levelHead(key) {
    const h = LEVEL_HEAD[key];
    return `<h3 class="pl-level-h">${h.title} <span class="pl-level-sub">${h.sub}</span></h3>`;
  }

  function splitLead(fsa, n, noun) {
    const w = NUMWORDS[n] || String(n);
    return `<strong>${simpleT(
      `The ${fsa} area spans ${w} ${noun}`,
      `The ${fsa} area is in ${w} ${noun}`)}</strong> — ${simpleT(
      "Deme won't guess. Which one is yours?",
      "Deme will not guess. Which one is yours?")}`;
  }

  function provNote() {
    return `<p class="small pl-note">${simpleT(
      "Provincial districts shown from the current provisional boundary basis.",
      "Provincial districts are shown from the current provisional boundaries.")}</p>`;
  }

  function unpickRow(key, nounPlural) {
    return `<p class="small pl-unpickrow"><button type="button" class="wf-listtoggle" data-pl-unpick="${key}">Not yours? Show all the ${nounPlural} again</button></p>`;
  }

  function footerHTML() {
    return `<p class="small pl-caveat">${simpleT(
        "Boundaries are drawn by land, not by address — if you live right at an edge, your official source is",
        "Boundaries follow land, not addresses. If you live right at an edge, check with")}
      <a href="https://www.elections.ca">Elections Canada</a>,
      <a href="https://www.elections.on.ca">Elections Ontario</a> or
      <a href="https://www.toronto.ca">the City of Toronto</a>.</p>
    <p class="small">Not sure? <a href="representatives.html">Browse the full directory →</a></p>`;
  }

  /* ---------- one mount ---------- */
  function mount(root) {
    const form = root.querySelector("[data-pl-form]");
    const input = root.querySelector("[data-pl-input]");
    const result = root.querySelector("[data-pl-result]");
    if (!form || !input || !result) return;

    let S = null; // the current lookup's state; results live in the page only

    function torontoPerson(ward) {
      return (S.torRoster || []).find(
        (c) => c.current && !c.mayor && c.ward === ward) || null;
    }

    function layerPerson(key, memberId) {
      const roster = key === "canada" ? S.fedRoster : S.ontRoster;
      return (roster || []).find(
        (p) => (p.id || p.slug) === memberId) || null;
    }

    function memberCardHTML(key, entry) {
      const cfg = LAYER_CFG[key];
      const p = layerPerson(key, entry.memberId);
      if (!p) {
        /* Defensive only — the build-time data gate verified every
           memberId against the rosters. Never fabricate a card. */
        return `<p class="wf-note">The member for ${esc(entry.riding)} could not be matched to the current directory — see the <a href="representatives.html">directory</a>.</p>`;
      }
      return layerCard(cfg, p, key === "canada" ? S.fedPart : S.ontPart);
    }

    function vacantCardHTML(key, entry) {
      const cfg = LAYER_CFG[key];
      return vacantCard({
        riding: entry.riding,
        roleLine: `${key === "canada" ? "MP" : "MPP"} · ${entry.riding}`,
        profilePage: cfg.profilePage,
        lastHolder: lastHolderFor(
          key === "canada" ? S.fedRoster : S.ontRoster, entry.riding),
      });
    }

    function entryCardHTML(key, entry) {
      return entry.vacant ? vacantCardHTML(key, entry) : memberCardHTML(key, entry);
    }

    function torontoSection() {
      const wards = S.torWards;
      const head = levelHead("toronto");
      const picked = S.picks.toronto;
      if (wards.length === 1 || picked != null) {
        const n = picked != null ? picked : wards[0];
        const c = torontoPerson(n);
        const body = c
          ? torontoCard(c, S.torPart)
          : `<p class="wf-note">That's Ward ${n} — its seat is vacant in the current record.</p>`;
        const un = picked != null && wards.length > 1
          ? unpickRow("toronto", "wards") : "";
        return `<div class="pl-level">${head}<div class="people pl-people">${body}</div>${un}</div>`;
      }
      const btns = wards.map((n) => {
        const c = torontoPerson(n);
        if (!c) return "";
        const cue = (S.cues && (S.cues[n] || S.cues[String(n)])) || "";
        return `<button type="button" class="wf-candidate" data-pl-pick="toronto:${n}">
          <span class="wf-cand-ward">Ward ${n} — ${esc(c.wardName)}</span>
          <span class="wf-cand-who">Councillor ${esc(c.name)}</span>
          <span class="wf-cand-cue">${esc(cue)}</span>
        </button>`;
      }).join("");
      return `<div class="pl-level pl-split">${head}
        <p><strong>${esc(S.fsa)} straddles a ward boundary</strong> — parts
        of it sit in ${wards.length} wards, so Deme won't guess.
        Which part is yours?</p>
        <div class="wf-candidates">${btns}</div>
        ${MAP_LINE.toronto}</div>`;
    }

    function layerSection(key, entry) {
      const head = levelHead(key);
      const note = key === "ontario" ? provNote() : "";
      if (entry.status === "resolved") {
        return `<div class="pl-level">${head}<div class="people pl-people">${entryCardHTML(key, entry)}</div>${note}</div>`;
      }
      const picked = S.picks[key];
      if (picked != null) {
        return `<div class="pl-level">${head}<div class="people pl-people">${entryCardHTML(key, entry.candidates[picked])}</div>${unpickRow(key, key === "canada" ? "ridings" : "districts")}${note}</div>`;
      }
      const noun = key === "canada" ? "federal ridings" : "provincial districts";
      const blocks = entry.candidates.map((e, i) => `
        <div class="pl-candidate">
          <p class="pl-riding">${esc(e.riding)}</p>
          <div class="people pl-people">${entryCardHTML(key, e)}</div>
          <p class="pl-pickrow"><button type="button" class="btn secondary" data-pl-pick="${key}:${i}">This is my ${key === "canada" ? "riding" : "district"}</button></p>
        </div>`).join("");
      return `<div class="pl-level pl-split">${head}
        <p>${splitLead(S.fsa, entry.candidates.length, noun)}</p>
        <div class="pl-candidates">${blocks}</div>
        ${MAP_LINE[key]}${note}</div>`;
    }

    function render() {
      const parts = [];
      if (S.torWards) parts.push(torontoSection());
      if (S.ontEntry) parts.push(layerSection("ontario", S.ontEntry));
      if (S.fedEntry) parts.push(layerSection("canada", S.fedEntry));
      if (!parts.length) {
        result.innerHTML = `<div class="pl-level">
          <p class="wf-note"><strong>Deme's postal lookup covers Ontario for now.</strong>
          ${simpleT(
            "That area isn't in the Ontario files — the record for the rest of Canada is browsable in the directory.",
            "That area is not in the Ontario files. You can browse the record for the rest of Canada in the directory.")}</p>
          <p class="small">Not sure? <a href="representatives.html">Browse the full directory →</a></p>
        </div>`;
        return;
      }
      parts.push(footerHTML());
      result.innerHTML = parts.join("");
      result.querySelectorAll("[data-pl-pick]").forEach((b) =>
        b.addEventListener("click", () => {
          const [key, val] = b.dataset.plPick.split(":");
          S.picks[key] = Number(val);
          render();
        }));
      result.querySelectorAll("[data-pl-unpick]").forEach((b) =>
        b.addEventListener("click", () => {
          S.picks[b.dataset.plUnpick] = null;
          render();
        }));
    }

    async function run() {
      const fsa = parseFsa(input.value);
      if (!fsa) {
        /* Malformed input: an inline error, and nothing is fetched. */
        result.innerHTML = `<p class="wf-note">${simpleT(
          "That doesn't look like a postal code — the first three characters are enough (a letter, a number, a letter — like M5V), or enter a full code.",
          "That does not look like a postal code. The first three characters are enough — a letter, a number, a letter, like M5V. A full code works too.")}</p>`;
        input.focus();
        return;
      }
      result.innerHTML = `<p class="wf-note">Looking up ${esc(fsa)}…</p>`;
      try {
        const [fed, prov, wardsMap] = await Promise.all([
          dataOnce("lookupFed", "lookup-federal.json"),
          dataOnce("lookupProv", "lookup-provincial.json"),
          dataOnce("fsaWards", "fsa-wards.json"),
        ]);
        const fedEntry = (fed.fsa && fed.fsa[fsa]) || null;
        const ontEntry = (prov.fsa && prov.fsa[fsa]) || null;
        const torWards = Object.prototype.hasOwnProperty.call(wardsMap, fsa)
          ? wardsMap[fsa].slice() : null;
        const jobs = {};
        if (torWards && torWards.length) {
          jobs.tor = Promise.all([
            dataOnce("torRoster", "councillors.json"),
            dataOnce("torPart", "participation.json"),
          ]);
          if (torWards.length > 1) {
            jobs.cues = dataOnce("wardCues", "ward-cues.json").catch(() => ({}));
          }
        }
        if (ontEntry) {
          jobs.ont = Promise.all([
            dataOnce("ontRoster", "ontario/members.json"),
            dataOnce("ontPart", "ontario/participation.json"),
          ]);
        }
        if (fedEntry) {
          jobs.fed = Promise.all([
            dataOnce("fedRoster", "federal/members.json"),
            dataOnce("fedPart", "federal/participation.json"),
          ]);
        }
        const got = {};
        for (const k of Object.keys(jobs)) got[k] = await jobs[k];
        S = {
          fsa,
          torWards: torWards && torWards.length ? torWards : null,
          torRoster: got.tor ? got.tor[0] : null,
          torPart: got.tor ? got.tor[1] : null,
          cues: got.cues || null,
          ontEntry,
          ontRoster: got.ont ? got.ont[0] : null,
          ontPart: got.ont ? got.ont[1] : null,
          fedEntry,
          fedRoster: got.fed ? got.fed[0] : null,
          fedPart: got.fed ? got.fed[1] : null,
          picks: { toronto: null, ontario: null, canada: null },
        };
        render();
      } catch (e) {
        result.innerHTML = `<p class="wf-note">${simpleT(
          "The lookup couldn't load — please try again, or browse the directory instead.",
          "The lookup could not load. Please try again, or browse the directory instead.")}</p>
        <p class="small">Not sure? <a href="representatives.html">Browse the full directory →</a></p>`;
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      run();
    });
  }

  document.querySelectorAll("[data-postal-lookup]").forEach(mount);
  return { mount };
})();
