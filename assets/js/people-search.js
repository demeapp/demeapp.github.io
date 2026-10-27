/* Cross-layer people search (framing wave, Oct 27, 2026).
   One people index over the three legislatures' member files —
   Toronto (record-data/councillors.json), Ontario
   (record-data/ontario/members.json), Canada
   (record-data/federal/members.json) — so a name or a riding typed
   into the site search finds the person in whichever legislature
   they sit in, labelled by layer, instead of dead-ending in the
   Toronto decision archive. Pure functions over the member data:
   no DOM, no fetch — Explore builds the index from the files it
   loads and renders the hits; the gate harness runs the same code
   against the same files. The decision record search stays its own
   thing; this module only answers "looking for the person?". */
"use strict";
(function (global) {
  /* Normalisation: case, accents and punctuation all fold away, so
     "Rhéal Fortin", "rheal fortin" and "O'Rourke" / "o'rourke"
     meet in the middle. */
  function psNorm(s) {
    return String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function psTokens(s) {
    const n = psNorm(s);
    return n ? n.split(/\s+/) : [];
  }
  function psEsc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* layers: { toronto: [...councillors.json], ontario: [...],
     canada: [...] } — any may be missing/empty. Each person keeps
     their search forms precomputed: name/area token lists plus the
     squashed (space-free) strings, so a query typed without the
     punctuation ("dentremont" for D'Entremont, "blackcreek") can
     still meet the name — at a lower rank than a clean token hit. */
  function buildPeople(layers) {
    const people = [];
    const push = (p) => {
      p._nt = psTokens(p.name);
      p._at = psTokens(p.area);
      p._nsq = p._nt.join("");
      p._asq = p._at.join("");
      people.push(p);
    };
    /* P-2 (audit, Oct 27, 2026): each hit also carries the person's
       portrait path, from the same photo flags the directories
       render from — Ontario/Canada from the member files' own
       flags; Toronto from the photo-slug set the caller passes in
       (Toronto's member file carries no flag; the set lives with
       the Toronto avatar helper). No path = initials, exactly as
       on the directories. */
    const tps = layers.torontoPhotoSlugs
      ? new Set(layers.torontoPhotoSlugs) : null;
    (layers.toronto || []).forEach((c) => push({
      name: c.name, layer: "Toronto",
      role: c.mayor ? "Mayor" : "Councillor",
      area: c.mayor ? "Toronto"
        : c.wardName ? `Ward ${c.ward} — ${c.wardName}`
        : c.ward ? `Ward ${c.ward}` : "",
      current: Boolean(c.current),
      photoSrc: tps && tps.has(c.slug)
        ? `assets/headshots/${encodeURIComponent(c.slug)}.webp` : null,
      href: `councillor.html?m=${encodeURIComponent(c.slug)}`,
    }));
    (layers.ontario || []).forEach((m) => push({
      name: m.name, layer: "Ontario", role: "MPP",
      area: m.riding || "",
      current: Boolean(m.current),
      photoSrc: m.photo
        ? `assets/headshots/ontario/${encodeURIComponent(m.slug)}.webp` : null,
      href: `mpp.html?m=${encodeURIComponent(m.slug)}`,
    }));
    (layers.canada || []).forEach((m) => push({
      name: m.name, layer: "Canada", role: "MP",
      area: m.province ? `${m.riding || ""}, ${m.province}` : (m.riding || ""),
      current: Boolean(m.current),
      photoSrc: m.photo
        ? `assets/headshots/federal/${encodeURIComponent(m.id)}.webp` : null,
      href: `mp.html?m=${encodeURIComponent(m.id)}`,
    }));
    return people;
  }

  /* A person matches when EVERY query token lands somewhere in
     their name or their area (riding / ward / province). Each token
     scores by its best landing: a name token (exact or typed
     prefix) beats the squashed name, which beats an area token,
     which beats the squashed area — so "ford" finds the Fords
     ahead of Bradford, while "dentremont" still finds D'Entremont.
     Current members edge earlier ones at the same score. Returns
     up to perLayer people per layer, in Toronto · Ontario ·
     Canada order. */
  function tokenClass(p, t) {
    if (p._nt.some((x) => x === t || x.startsWith(t))) return 4;
    if (p._nsq.includes(t)) return 3;
    if (p._at.some((x) => x === t || x.startsWith(t))) return 2;
    if (p._asq.includes(t)) return 1;
    return 0;
  }
  function findPeople(people, query, perLayer) {
    const qTokens = psTokens(query);
    if (!qTokens.length) return [];
    const lim = perLayer || 2;
    const order = ["Toronto", "Ontario", "Canada"];
    const byLayer = { Toronto: [], Ontario: [], Canada: [] };
    for (const p of people) {
      let score = 0, ok = true;
      for (const t of qTokens) {
        const cls = tokenClass(p, t);
        if (!cls) { ok = false; break; }
        score += cls * 10;
      }
      if (!ok) continue;
      byLayer[p.layer].push({ p, score: score + (p.current ? 1 : 0) });
    }
    const out = [];
    for (const layer of order) {
      byLayer[layer]
        .sort((a, b) => b.score - a.score
          || a.p.name.localeCompare(b.p.name))
        .slice(0, lim)
        .forEach(({ p }) => out.push(p));
    }
    return out;
  }

  /* The notice lines, in the same shape as Explore's own member
     hit: a link to the person's record, labelled by layer, role
     and area — so the visitor lands in the right legislature.
     P-2: the hit pairs the name with the same avatar the
     directories and profiles use — the portrait where one exists,
     the initials disc where none does — instead of bare text. */
  function psInitials(name) {
    return String(name || "").split(/\s+/).filter(Boolean)
      .slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase();
  }
  function psAvatar(p) {
    const img = p.photoSrc
      ? `<img src="${p.photoSrc}" alt="" loading="lazy" decoding="async" onerror="demeAvatarError(this)">`
      : "";
    return `<span class="avatar sm" aria-hidden="true"><span>${psEsc(psInitials(p.name))}</span>${img}</span>`;
  }
  function peopleHitHTML(hits) {
    return hits.map((p) => `<div class="notice person-hit">${psAvatar(p)}<span>Looking for the person? See
      <a href="${p.href}">${psEsc(p.name)}'s record</a> — ${psEsc(p.layer)}
      · ${psEsc(p.role)}${p.area ? ` · ${psEsc(p.area)}` : ""}</span></div>`).join("");
  }

  global.DemePeople = { buildPeople, findPeople, peopleHitHTML, psNorm, psTokens };
})(typeof window !== "undefined" ? window : globalThis);
