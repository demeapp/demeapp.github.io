/* Ward finder — postal-code-first ward picking, shared by Start Here
   (Home), the step-2 editor, and My Record.

   Privacy posture (hard rule): the visitor may type a full postal
   code, but only the first three characters (the FSA) are ever read,
   and only here in the browser — the lookup runs against a static
   file (data/fsa-wards.json, derived offline from City of Toronto
   ward boundaries and Statistics Canada's 2021 Census FSA boundary
   file; see tools/build_fsa_map.py). The full code is never stored,
   never sent anywhere. The only thing a caller persists is the ward
   the visitor confirms or picks.

   An FSA that straddles a ward boundary is never guessed: the finder
   presents every candidate ward with its councillor and a street /
   landmark cue, and the visitor's pick is what's used.

   Callers that carry the privacy note once for a whole area (the
   My Record profile card) pass privacyNote: false to suppress the
   per-finder note; every other caller gets the note as before. */
"use strict";

/* Ward cues live in data/ward-cues.json, loaded lazily on first lookup —
   no-profile visitors don't pay for them until they use the finder. */

const WardFinder = (() => {
  let mapPromise = null;
  let cuesPromise = null;
  function fsaMap() {
    if (!mapPromise) mapPromise = loadJSON(dataPath("fsa-wards.json"));
    return mapPromise;
  }
  function wardCues() {
    if (!cuesPromise) {
      cuesPromise = loadJSON(dataPath("ward-cues.json")).catch(() => ({}));
    }
    return cuesPromise;
  }
  function info(people, n) {
    const p = (people || []).find((c) => c.current && !c.mayor && c.ward === n);
    return p ? { name: p.wardName, councillor: p.name }
             : { name: "", councillor: "" };
  }
  /* Wards for an FSA string (already normalized or not). Resolves to
     an array of ward numbers (largest overlap first), [] for an FSA
     with Toronto geography but no ward, or null when the FSA is not
     in the Toronto map at all. */
  async function wardsFor(rawFsa) {
    const fsa = String(rawFsa || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    if (!/^[A-Z]\d[A-Z]$/.test(fsa)) return null;
    const map = await fsaMap();
    return Object.prototype.hasOwnProperty.call(map, fsa) ? map[fsa].slice() : null;
  }

  function mount(el, opts) {
    const p = opts.idPrefix;
    const people = opts.people || [];
    let current = opts.current ?? null;      /* displayed / staged value */
    let stagedTouched = false;
    const allWards = Array.from({ length: 25 }, (_, i) => i + 1);

    el.innerHTML = `
      <div class="wardfinder">
        ${opts.label ? `<p class="wf-label" id="${p}-label">${esc(opts.label)}</p>` : ""}
        <div class="wf-current" id="${p}-current" hidden></div>
        <div class="wf-entry" id="${p}-entry">
          <div class="wf-row">
            <input type="text" id="${p}-pc" autocomplete="postal-code"
              autocapitalize="characters" spellcheck="false"
              placeholder="M5V 1J1"
              aria-label="${esc(opts.inputLabel || "Your postal code")}">
            <button class="${esc(opts.btnClass || "btn")}" type="button" id="${p}-find">Find my ward</button>
          </div>
          ${opts.privacyNote === false ? "" : `<p class="wf-privacy">Only the first 3 characters are used, right
          here in your browser — your full postal code is never stored or
          sent anywhere. Only the ward you choose is saved.</p>`}
          <div class="wf-result" id="${p}-result" aria-live="polite"></div>
          <p class="wf-listline"><button class="wf-listtoggle" type="button"
            id="${p}-lt" aria-expanded="false">or find your ward in the list</button></p>
          <div class="wf-listrow" id="${p}-listrow" hidden>
            <label class="visually-hidden" for="${p}-list">Ward list</label>
            <select id="${p}-list">
              <option value="">${esc(opts.noneLabel || "Choose your ward…")}</option>
              ${allWards.filter((n) => n !== opts.exclude).map((n) => {
                const wi = info(people, n);
                return `<option value="${n}">Ward ${n}${wi.name ? ` — ${esc(wi.name)}` : ""}</option>`;
              }).join("")}
            </select>
          </div>
        </div>
      </div>`;

    const currentBox = el.querySelector(`#${p}-current`);
    const entryBox = el.querySelector(`#${p}-entry`);
    const input = el.querySelector(`#${p}-pc`);
    const result = el.querySelector(`#${p}-result`);
    const listRow = el.querySelector(`#${p}-listrow`);
    const listToggle = el.querySelector(`#${p}-lt`);
    const listSel = el.querySelector(`#${p}-list`);

    function showCurrent() {
      if (current == null) {
        currentBox.hidden = true;
        entryBox.hidden = false;
        return;
      }
      const wi = info(people, current);
      currentBox.innerHTML = `
        <p class="wf-set"><strong>Ward ${current}${wi.name ? ` — ${esc(wi.name)}` : ""}</strong>
        ${wi.councillor ? `<span class="small">· Councillor ${esc(wi.councillor)}</span>` : ""}
        <button class="wf-listtoggle" type="button" id="${p}-change">Change</button></p>`;
      currentBox.hidden = false;
      entryBox.hidden = true;
      currentBox.querySelector(`#${p}-change`).addEventListener("click", () => {
        currentBox.hidden = true;
        entryBox.hidden = false;
        result.innerHTML = "";
        input.focus();
      });
    }

    function choose(n) {
      current = n;
      stagedTouched = true;
      result.innerHTML = "";
      showCurrent();
      if (opts.onChoose) opts.onChoose(n);
    }

    function confirmHTML(fsa, n) {
      const wi = info(people, n);
      return `<div class="wf-confirm">
        <p><strong>That's Ward ${n}${wi.name ? ` — ${esc(wi.name)}` : ""}.</strong>
        ${wi.councillor ? `Your councillor is ${esc(wi.councillor)}.` : ""}</p>
        <p class="wf-actions">
          <button class="btn bronze" type="button" data-yes="${n}">Yes — set Ward ${n}</button>
          <button class="btn secondary" type="button" data-no="1">Not my ward</button>
        </p></div>`;
    }

    function revealList() {
      listRow.hidden = false;
      listToggle.setAttribute("aria-expanded", "true");
      listSel.focus();
    }

    async function find() {
      const fsa = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
      if (!/^[A-Z]\d[A-Z]$/.test(fsa)) {
        result.innerHTML = `<p class="wf-note">That doesn't look like a postal
          code yet — the first three characters are enough (a letter, a
          number, a letter — like M5V).</p>`;
        input.focus();
        return;
      }
      result.innerHTML = `<p class="wf-note">Looking up ${esc(fsa)}…</p>`;
      let wards, cues;
      try {
        [wards, cues] = await Promise.all([wardsFor(fsa), wardCues()]);
      } catch (e) { wards = undefined; cues = {}; }
      if (wards === undefined) {
        result.innerHTML = `<p class="wf-note">The ward lookup couldn't load.
          Please use the list below instead.</p>`;
        revealList();
        return;
      }
      if (wards === null || !wards.length) {
        result.innerHTML = `<p class="wf-note"><strong>That postal code isn't
          in Toronto</strong> — Deme covers Toronto City Council. If you do
          live in Toronto, check the first three characters, or find your
          ward in the list.</p>`;
        revealList();
        return;
      }
      const candidates = wards.filter((n) => n !== opts.exclude);
      if (!candidates.length) {
        result.innerHTML = `<p class="wf-note">That's the ward you've
          already set — to watch a second area, enter a postal code from
          that area, or pick one from the list.</p>`;
        revealList();
        return;
      }
      if (candidates.length === 1) {
        result.innerHTML = confirmHTML(fsa, candidates[0]);
      } else {
        result.innerHTML = `<div class="wf-confirm">
          <p><strong>${esc(fsa)} straddles a ward boundary</strong> — parts
          of it sit in ${candidates.length} wards, so Deme won't guess.
          Which part is yours?</p>
          <div class="wf-candidates">
            ${candidates.map((n) => {
              const wi = info(people, n);
              return `<button type="button" class="wf-candidate" data-pick="${n}">
                <span class="wf-cand-ward">Ward ${n}${wi.name ? ` — ${esc(wi.name)}` : ""}</span>
                ${wi.councillor ? `<span class="wf-cand-who">Councillor ${esc(wi.councillor)}</span>` : ""}
                <span class="wf-cand-cue">${esc(cues[n] || cues[String(n)] || "")}</span>
              </button>`;
            }).join("")}
          </div></div>`;
      }
      result.querySelectorAll("[data-pick]").forEach((b) =>
        b.addEventListener("click", () => choose(Number(b.dataset.pick))));
      const yes = result.querySelector("[data-yes]");
      if (yes) yes.addEventListener("click", () => choose(Number(yes.dataset.yes)));
      const no = result.querySelector("[data-no]");
      if (no) no.addEventListener("click", () => {
        result.innerHTML = `<p class="wf-note">No problem — find your ward
          in the list instead.</p>`;
        revealList();
      });
    }

    el.querySelector(`#${p}-find`).addEventListener("click", find);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); find(); }
    });
    listToggle.addEventListener("click", () => {
      const open = listRow.hidden;
      listRow.hidden = !open;
      listToggle.setAttribute("aria-expanded", String(open));
      if (open) listSel.focus();
    });
    listSel.addEventListener("change", () => {
      choose(listSel.value ? Number(listSel.value) : null);
    });

    showCurrent();
    return {
      value() { return current; },
      touched() { return stagedTouched; },
      set(n) { current = n ?? null; showCurrent(); },
    };
  }

  return { mount, wardsFor, info };
})();
