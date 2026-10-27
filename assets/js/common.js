/* Deme — shared helpers, chrome (header/footer), and the vote store. */
"use strict";

/* Progressive-enhancement flags: .js gates any pre-reveal hidden state
   (content is never hidden when JS fails); .vt tells CSS the browser
   can run cross-document view transitions, so the page-in fallback
   stays off. */
document.documentElement.classList.add("js");
if (typeof document.startViewTransition === "function") {
  document.documentElement.classList.add("vt");
}
document.head.appendChild(Object.assign(document.createElement("script"), { src: "/assets/js/pwa.js", defer: true }));

/* ---------------- formatting helpers ---------------- */
const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-CA"));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

/* Simpler-text mode (Stream D preview): renderers pick wording through
   simpleT(normal, simple); when simple-mode.js is absent or the mode is
   off, the normal wording is returned untouched. */
const simpleT = (a, b) => (typeof DemeSimple !== "undefined" ? DemeSimple.t(a, b) : a);
const simpleOn = () => typeof DemeSimple !== "undefined" && DemeSimple.isOn();

/* ---------------- motion helpers ----------------
   Animated counter: ease-out, formatted with fmtNum. Sets the final
   value instantly under reduced motion, without
   requestAnimationFrame, or if anything goes wrong — the rendered
   number is always exactly fmtNum(target): it lands, it never
   overshoots, and nothing keeps ticking afterwards. */
function animateCount(el, target, duration) {
  if (!el) return;
  const finalText = fmtNum(target);
  const reduced = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof requestAnimationFrame !== "function") {
    el.textContent = finalText;
    return;
  }
  const dur = duration || 900, t0 = performance.now();
  function tick(now) {
    /* Clamped at both ends: a first rAF timestamp can precede t0,
       which would otherwise ease to a negative first frame
       (visitor-eye catch, stats-countup wave). */
    const p = Math.min(1, Math.max(0, (now - t0) / dur)),
      e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtNum(Math.round(target * e));
    if (p < 1) requestAnimationFrame(tick); else el.textContent = finalText;
  }
  requestAnimationFrame(tick);
}

/* Duration for a stat count-up, scaled by size so the biggest
   figures don't feel rushed: 900ms small, 1000ms five-figure,
   1200ms six-figure. */
function countDuration(target) {
  if (target >= 100000) return 1200;
  if (target >= 10000) return 1000;
  return 900;
}

/* Stat-band count-ups (stats-countup wave, Oct 22, 2026): any
   [data-count] inside a .statband counts up ONCE when it scrolls
   into view, via the same animateCount as the rest of the site —
   one mechanism, wherever the band appears (homepage, Open Data,
   For Reporters). Only elements carrying data-count animate;
   secondary figures without it stay static. Elements start from
   their final value in the markup, so without JS — and for
   reduced-motion visitors, whose figures are set instantly and
   never zeroed — the band always shows the true numbers. */
function setupCountUps(scope) {
  const root = scope || document;
  const els = Array.from(root.querySelectorAll(".statband [data-count]"))
    .filter((el) => !el.dataset.countWired);
  if (!els.length) return;
  const reduced = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof IntersectionObserver !== "function"
      || typeof requestAnimationFrame !== "function") {
    els.forEach((el) => {
      el.dataset.countWired = "1";
      animateCount(el, Number(el.dataset.count));
    });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const el = en.target;
      if (en.isIntersecting) {
        io.unobserve(el);
        animateCount(el, Number(el.dataset.count),
          countDuration(Number(el.dataset.count)));
      }
      /* Audit F-6/D-4 (Oct 26): off-screen counters are NO LONGER
         parked at zero. The band renders with its true figures in
         place, and the count-up runs when the band comes into view —
         a visitor resting with the band half-visible sees the real
         numbers, never zeros on the headline stats. */
    });
  }, { rootMargin: "0px" });
  els.forEach((el) => { el.dataset.countWired = "1"; io.observe(el); });
}

/* Scroll reveal: .reveal elements get .in as they enter the viewport.
   Without IntersectionObserver every element is revealed at once. */
function setupReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  if (typeof IntersectionObserver !== "function") {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  els.forEach((el) => io.observe(el));
}

/* ---------------- data loading (cached) ---------------- */
const _cache = new Map();
function loadJSON(path) {
  if (!_cache.has(path)) {
    _cache.set(path, fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return _cache.get(path);
}
const dataPath = (p) => `record-data/${p}`;

/* ---------------- site chrome ---------------- */
const NAV = [
  ["index.html", "Home"],
  ["explore.html", "The Record"],
  ["councillors.html", "Representatives"],
  ["about.html", "About"],
  ["my-record.html", "My Record"],
];
const COLUMN_MARK = `
<svg class="mark" width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"
     focusable="false">
  <rect x="3" y="2" width="24" height="4" rx="1" fill="#2FBF8F"/>
  <rect x="6" y="9" width="3.6" height="19" fill="#0E2A47"/>
  <rect x="13.2" y="9" width="3.6" height="19" fill="#0E2A47"/>
  <rect x="20.4" y="9" width="3.6" height="19" fill="#0E2A47"/>
  <rect x="3" y="31" width="24" height="4" rx="1" fill="#2FBF8F"/>
</svg>`;
const SOCIAL_LINKS = [
  ["https://x.com/demecivic", "Deme on X", `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"
         aria-hidden="true" focusable="false">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>`],
  ["https://www.instagram.com/demecivic", "Deme on Instagram", `
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.9" aria-hidden="true"
         focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.2" cy="6.8" r="1.15" fill="currentColor" stroke="none"/>
    </svg>`],
  ["https://www.facebook.com/profile.php?id=1417248804799587", "Deme on Facebook", `
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"
         aria-hidden="true" focusable="false">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>`],
];
/* Legislature layers (expansion wave, Oct 27, 2026): Toronto is the
   original layer and the default. The Ontario (MPP) and Canada (MP)
   layers carry their own directories and profile pages; the level
   switcher below is the only chrome they add to the Toronto pages.
   A page declares its layer with window.__demeLayer before this
   script loads; anything undeclared is Toronto. The site-level
   pages — homepage, About & method, Explore, My Record, Privacy,
   For reporters, Open data and the 404 page — declare "site"
   (framing wave, Oct 27, 2026): their footer speaks for all three
   legislatures at once and the switcher marks no layer current,
   because the site's frame is every level of government, with
   Toronto one layer of three. */
const DEME_LEVELS = [
  ["toronto", "Toronto", "councillors.html"],
  ["ontario", "Ontario", "ontario.html"],
  ["canada", "Canada", "canada.html"],
];
function demeLayer() {
  if (typeof window !== "undefined" && window.__demeLayer)
    return window.__demeLayer;
  const p = (typeof location !== "undefined" ? location.pathname : "")
    .toLowerCase();
  if (p.includes("ontario") || p.endsWith("/mpp.html")) return "ontario";
  if (p.includes("canada") || p.endsWith("/mp.html")) return "canada";
  return "toronto";
}
function renderChrome(active) {
  window.__demeChromeActive = active;
  const layer = demeLayer();
  const header = document.querySelector(".site-header");
  if (header) {
    header.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html">${COLUMN_MARK}
        <span><span class="wordmark">Deme</span>
        <span class="tagline">Where the people meet the vote</span></span></a>
      <nav class="header-social" aria-label="Deme on social media">
        ${SOCIAL_LINKS.map(([href, label, glyph]) =>
          `<a href="${href}" target="_blank" rel="noopener" aria-label="${label} (opens in a new tab)">${glyph}</a>`).join("")}
      </nav>
      <nav class="site-nav" aria-label="Main">
        ${NAV.map(([href, label]) =>
          `<a href="${href}"${href === "my-record.html" ? ' class="nav-record"' : ""}${href === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
      <nav class="level-switcher" aria-label="Choose a legislature">
        <span class="ls-label" aria-hidden="true">Legislature</span>
        ${DEME_LEVELS.map(([key, label, href]) =>
          `<a href="${href}" data-level="${key}"${key === layer ? ' aria-current="true"' : ""}>${label}</a>`).join("")}
      </nav>
      <div class="simple-mode-wrap">
        <button class="simple-mode-toggle" id="simple-mode-toggle" type="button"
          aria-pressed="${simpleOn()}" aria-describedby="simple-mode-help">
          <span class="track" aria-hidden="true"></span>Simpler text</button>
        <span class="visually-hidden" id="simple-mode-help">Use simpler words
          across this site. Your choice is saved on this device, and to your
          account when you are signed in.</span>
      </div></div>`;
  }
  const footer = document.querySelector(".site-footer");
  if (footer) {
    /* Layer-aware brand line: Toronto's is the original string; the
       Ontario and Canada layers name their own legislature so no
       Toronto wording leaks into their pages. The site-level pages
       (layer "site") carry the general line — the site's identity
       is all three legislatures, not one of them. */
    const brandLine = layer === "site"
      ? `<strong>Deme</strong> — the public record of your elected
          representatives, in plain language — municipal, provincial and
          federal. Non-partisan. No grades, no endorsements — just the record.`
      : layer === "ontario"
      ? `<strong>Deme</strong> — the Ontario Legislature's record, in plain
          language. Non-partisan. No grades, no endorsements — just the record.`
      : layer === "canada"
      ? `<strong>Deme</strong> — the House of Commons' record, in plain
          language. Non-partisan. No grades, no endorsements — just the record.`
      : `<strong>Deme</strong> — Toronto City Council's record, in plain
          language. Non-partisan. No grades, no endorsements — just the record.`;
    const fineprint = layer === "site"
      ? `Built from the published records of the City of Toronto, the
      Legislative Assembly of Ontario and the House of Commons. Coverage
      for each legislature is stated in full on its directory and on
      <a href="about.html">About &amp; method</a>.`
      : layer === "ontario"
      ? `Built from the Legislative Assembly of Ontario's published records
      and the Integrity Commissioner's disclosure registry. Voting record:
      name-by-name rows 2018–2026, as gathered Oct 20, 2026 and extended
      Oct 27, 2026 ·
      Disclosure statements: 2005–2025 — coverage is stated in full on the
      <a href="ontario.html">Ontario directory</a>.`
      : layer === "canada"
      ? `Built from the House of Commons' published records, the Conflict of
      Interest and Ethics Commissioner's registry, and the Office of the
      Commissioner of Lobbying's registry. Voting record: name-by-name
      rows 2004–2026 — coverage is stated in full on the
      <a href="canada.html">Canada directory</a>.`
      : `Built from the City of Toronto's published council
      records. Decision archive: 2018–2026 · Voting record: name-by-name
      rows 2018–2026, member totals back to 2006 ·
      Archive current to Oct 19, 2026 — see
      <a href="about.html">About &amp; method</a>.`;
    footer.innerHTML = `<div class="wrap"><div class="rule"></div>
      <div class="footer-grid">
        <div class="footer-brand">
          <p>${brandLine}</p>
          <nav class="footer-group footer-social" aria-label="Follow Deme">
            <p class="footer-h">Follow Deme</p>
            <ul>
              <li><a href="https://x.com/demecivic" target="_blank" rel="noopener">X<span class="visually-hidden"> (opens in a new tab)</span></a></li>
              <li><a href="https://www.instagram.com/demecivic" target="_blank" rel="noopener">Instagram<span class="visually-hidden"> (opens in a new tab)</span></a></li>
              <li><a href="https://www.facebook.com/profile.php?id=1417248804799587" target="_blank" rel="noopener">Facebook<span class="visually-hidden"> (opens in a new tab)</span></a></li>
            </ul>
          </nav>
        </div>
        <nav class="footer-group" aria-label="The Record">
          <p class="footer-h">The Record</p>
          <ul>
            <li><a href="explore.html">The Record</a></li>
            <li><a href="councillors.html">Representatives</a></li>
            <li><a href="my-record.html#weigh-in">Weigh in</a></li>
          </ul>
        </nav>
        <nav class="footer-group" aria-label="How it works">
          <p class="footer-h">How it works</p>
          <ul>
            <li><a href="about.html">About &amp; method</a></li>
            <li><a href="open-data.html">Open data</a></li>
            <li><a href="reporters.html">For reporters</a></li>
            <li><a href="embed.html">Embed the record</a></li>
            <li><a href="my-record.html">My Record</a></li>
            <li><a href="privacy.html">Privacy policy</a></li>
          </ul>
        </nav>
      </div>
      <p class="fineprint">${fineprint}</p>
      </div>`;
  }
}

/* Member cards carry only the four summary stats the owner approved:
   recorded-vote participation, votes cast, tenure, and declared
   interests (counted from recorded votes). Tenure is
   derived only from the member's own term list in councillors.json:
   the earliest term start plus, where relevant, the number of terms. */
function memberTenure(person) {
  const terms = Array.isArray(person.terms) ? person.terms : [];
  if (!terms.length) return "—";
  const starts = terms.map((t) => Number(String(t).slice(0, 4))).filter(Boolean);
  if (!starts.length) return terms.map(fmtTerm).join(" · ");
  const since = Math.min(...starts);
  return terms.length === 1
    ? `On Council since ${since}`
    : `${terms.length} terms · since ${since}`;
}
/* One recorded-vote participation format everywhere (OE-8): exactly one decimal,
   matching the member-page tiles — a stored 95 renders "95.0%",
   never a bare "95%" beside someone else's "95.7%". */
function fmtAtt(person) {
  if (person.participation == null) return "—";
  const att = Number(person.participation);
  return Number.isFinite(att) ? `${att.toFixed(1)}%` : "—";
}
/* Callers pass CURRENT members only: the interest counter reads vote
   rows the source flags as interest-declared, a flag that exists only
   from June 2023 — an earlier member must never reach this helper;
   the directory dashes them instead. */
function memberStatsHTML(person) {
  const interest = Number(person.interest) || 0;
  /* Decorative participation meter (the percentage figure beside it is
     the value; the meter is aria-hidden and purely visual). Null or
     non-numeric participation renders the em dash with no meter. */
  const att = Number(person.participation);
  const meter = person.participation != null && Number.isFinite(att)
    ? `<span class="att-meter" aria-hidden="true"><span class="att-fill" style="width:${Math.max(0, Math.min(100, att))}%"></span></span>`
    : "";
  return `<div class="member-stats" aria-label="Record summary">
    <div><span>${simpleT("Recorded-vote participation", "Votes they took part in")}</span><strong>${fmtAtt(person)}</strong>${meter}</div>
    <div><span>Votes cast</span><strong>${fmtNum(person.votesCast)}</strong></div>
    <div><span>${simpleT("Tenure", "How long on Council")}</span><strong>${esc(memberTenure(person))}</strong></div>
    <div><span>${simpleT("Interest declared on a recorded vote · stepped back (since Jun 2023)", "Declared an interest on a recorded vote · did not vote (since Jun 2023)")}</span><strong>${fmtNum(interest)}</strong></div>
  </div>`;
}

/* ---------------- member avatars ----------------
   Official portraits exist for the members in PHOTO_SLUGS (the
   files live in assets/headshots/, named by slug): the 19 returning
   current members, plus 27 earlier members — 20 whose portraits come
   from the City of Toronto Archives' official councillor portrait
   series (Fonds 219, Series 2311, via Wikimedia Commons — polish
   wave, Oct 22, 2026; full provenance in that wave's D/E report)
   and the 7 who left council in 2026, whose official portraits ran
   while they served. The 7 members elected in 2026 are NOT in the
   set: the City has not published official portraits of the
   incoming council, so they get the initials disc — no campaign or
   substitute photos are used. (Mike Layton's archive portrait file
   stays on disk, unreferenced, until the parent decides whether to
   link his earlier-service portrait; v32 roster wave, Oct 27, 2026.)
   Everyone else — and any photo that fails to load — falls back
   to the member's initials on a navy disc, the old build's
   pattern. */
const PHOTO_SLUGS = new Set(["alejandra-bravo", "amber-morley",
  "anthony-perruzza", "ausma-malik", "brad-bradford", "chris-moise",
  "dianne-saxe", "frances-nunziata", "gord-perks", "jamaal-myers",
  "james-pasternak", "jon-burnside", "josh-matlow", "lily-cheng",
  "michael-thompson", "mike-colle", "neethan-shan", "nick-mantas", "olivia-chow",
  "parthi-kandavel", "paul-ainslie", "paula-fletcher",
  "rachel-chernos-lin", "shelley-carroll", "stephen-holyday",
  "vincent-crisanti",
  "adam-vaughan", "ana-bailao", "chin-lee", "doug-ford",
  "doug-holyday", "frank-di-giorgio", "gary-crawford", "janet-davis",
  "jaye-robinson", "joe-mihevc", "john-parker", "josh-colle",
  "karen-stintz", "kristyn-wong-tam", "maria-augimeri", "mark-grimes",
  "mary-fragedakis", "mary-margaret-mcmahon",
  "norman-kelly", "sarah-doucette"]);
const initialsOf = (name) => String(name || "").split(/\s+/)
  .filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase();
/* Avatar photo failure handling (audit F-2, Oct 26): the old
   onerror removed the <img> on the FIRST failure, so one transient
   fetch error cost that page-view its portrait even though every
   headshot file exists. Retry once with a cache-busting query; only
   a second failure removes the image, leaving the initials disc
   that sits behind it in avatarHTML. */
function demeAvatarError(img) {
  if (!img.dataset.avatarRetried) {
    img.dataset.avatarRetried = "1";
    const src = img.getAttribute("src") || "";
    img.src = src + (src.includes("?") ? "&" : "?") + "retry=1";
  } else {
    img.remove();
  }
}
function avatarHTML(person, size = "") {
  const img = PHOTO_SLUGS.has(person.slug)
    ? `<img src="assets/headshots/${encodeURIComponent(person.slug)}.webp"
        alt="" loading="lazy" decoding="async" onerror="demeAvatarError(this)">`
    : "";
  return `<span class="avatar ${size}" aria-hidden="true"><span>${esc(initialsOf(person.name))}</span>${img}</span>`;
}
/* Term strings in the data use ASCII hyphens ("2022-2026"); display
   copy everywhere else uses en dashes. Normalise at render. */
const fmtTerm = (t) => String(t).replace(/(\d{4})-(\d{4})/g, "$1–$2");

/* ---------------- past-voice briefs (W1) ----------------
   Archive briefs were written in preview voice ("City Council will
   vote on…", "The committee is asked to…") and are rendered under
   outcome pills on decided items. pastVoice() rewrites ONLY the
   brief's lead construction — the first "will <verb>" and/or the
   first "is/are asked to" starting inside the opening window — into
   past voice, using a verb map built from the brief corpus itself.
   A "will" later in the brief (a bylaw that will take effect in
   2027) describes the proposal's own future and is left untouched,
   as is any lead verb outside the map: unconverted is safer than
   corrupted. Applied by decisionCard and the decision page — never
   to upcoming items, whose future tense is correct. */
const PAST_VERBS = {
  decide: "decided", vote: "voted", hear: "heard", give: "gave",
  receive: "received", provide: "provided", get: "got",
  consider: "considered", introduce: "introduced", review: "reviewed",
  present: "presented", hold: "held", approve: "approved",
  discuss: "discussed", conduct: "conducted", weigh: "weighed",
  update: "updated", elect: "elected", appoint: "appointed",
  note: "noted", ask: "asked", confirm: "confirmed",
  deliver: "delivered", have: "had", declare: "declared",
  keep: "kept", set: "set", talk: "talked", come: "came",
  report: "reported", lead: "led", recommend: "recommended",
  adopt: "adopted", select: "selected", act: "acted",
  suggest: "suggested", pass: "passed", align: "aligned",
  guide: "guided", make: "made", bring: "brought",
  brief: "briefed", continue: "continued", extend: "extended",
  share: "shared", add: "added", interview: "interviewed",
  include: "included", allow: "allowed", improve: "improved",
  cover: "covered", increase: "increased", result: "resulted",
  rule: "ruled", reopen: "reopened",
  speak: "spoke", assess: "assessed", launch: "launched",
  redevelop: "redeveloped", outline: "outlined",
  facilitate: "facilitated", call: "called", amplify: "amplified",
  offer: "offered", administer: "administered", recite: "recited",
  recess: "recessed", train: "trained", post: "posted",
  cancel: "cancelled", replace: "replaced", explain: "explained",
  pick: "picked", show: "showed", rename: "renamed",
  reappoint: "reappointed", raise: "raised", let: "let",
  reconsider: "reconsidered", redo: "redid", build: "built",
  take: "took", open: "opened", rehear: "reheard",
};
function pastVoice(brief) {
  if (!brief) return brief;
  let out = brief;
  const LEAD = 90; /* the lead construction starts within this window */
  /* hyphenated re-verbs first: "will re-elect" → "re-elected" */
  const reVerb = /\bwill\s+re-([a-z]+)/i.exec(out);
  if (reVerb && reVerb.index < LEAD && PAST_VERBS[reVerb[1].toLowerCase()]) {
    out = out.replace(reVerb[0], `re-${PAST_VERBS[reVerb[1].toLowerCase()]}`);
  }
  const will = /\bwill\s+(not\s+|also\s+|formally\s+|privately\s+|fully\s+|again\s+)?([a-z]+)/i.exec(out);
  if (will && will.index < LEAD) {
    const [whole, adv, verbRaw] = will;
    const verb = verbRaw.toLowerCase();
    if (adv && adv.trim() === "not") {
      out = out.replace(whole, `did not ${verbRaw}`);
    } else if (verb === "be") {
      /* "will be asked/held/conferring…" — the next word carries the
         tense: participles and -ing forms both take "was". */
      const tail = out.slice(will.index + whole.length);
      const part = /^\s+([a-z]+)/i.exec(tail);
      if (part && (/(ed|en|ing)$/.test(part[1].toLowerCase())
        || ["held", "given", "made", "set", "put"].includes(part[1].toLowerCase()))) {
        out = out.slice(0, will.index) + "was" + tail;
      }
    } else if (PAST_VERBS[verb]) {
      const advText = adv ? `${adv.trim()} ` : "";
      out = out.replace(whole, `${advText}${PAST_VERBS[verb]}`);
    }
  }
  const asked = /\b(is|are) asked to/i.exec(out);
  if (asked && asked.index < LEAD) {
    out = out.replace(asked[0], asked[1].toLowerCase() === "is"
      ? "was asked to" : "were asked to");
  }
  return out;
}

/* ---------------- record-title hygiene ----------------
   A few City item titles carry a doubled honorific ("by Councillor
   Councillor Paula Fletcher") — the exporter's title build adds the
   title to a name that already carries it. Collapse the repeat at
   render time, wherever a record title is shown, so a regenerated
   dataset cannot resurrect it. Only an exact, immediate repeat of
   the same honorific is touched; the rest of the title is the
   record's own and stays byte-for-byte. */
function cleanTitle(t) {
  return String(t || "").replace(/\b(Councillor|Mayor|Deputy Mayor)\s+\1\b/g, "$1");
}

/* ---------------- decision card renderer ---------------- */
function decisionCard(c, opts = {}) {
  const briefText = c.brief
    ? (simpleOn() ? DemeSimple.simplifyBrief(pastVoice(c.brief)) : pastVoice(c.brief))
    : "";
  const more = c.hasVote
    ? `<a href="decision.html?ref=${encodeURIComponent(c.ref)}">See the record
       <span aria-hidden="true">→</span></a>`
    : `<a href="decision.html?ref=${encodeURIComponent(c.ref)}">Details
       <span aria-hidden="true">→</span></a>`;
  const wards = (c.wards && c.wards.length)
    ? ` · Ward${c.wards.length > 1 ? "s" : ""} ${c.wards.join(", ")}`
    : (c.citywide ? " · Citywide" : "");
  return `<article class="card">
    <div class="meta"><span>${esc(fmtDate(c.date))}</span>
      <span>${esc(c.body)}</span>
      <span class="pill">${esc(c.statusLabel)}</span></div>
    <h3><a href="decision.html?ref=${encodeURIComponent(c.ref)}">${esc(cleanTitle(c.title))}</a></h3>
    ${c.brief ? `<p class="brief">${esc(briefText)}</p>` : ""}
    ${c.stake ? `<p class="stake">${esc(c.stake)}</p>` : ""}
    <p class="more">${more}${wards ? `<span class="wardtag">${esc(wards.replace(/^ · /, ""))}</span>` : ""}</p>
  </article>`;
}

/* ---------------- vote store ----------------
   All vote reads/writes go through this adapter interface:
     getWard() / setWard(n|null)
     getPick(ref) / setPick(ref, choice) / clearPick(ref)
     allPicks() -> {ref: {choice, ts}}
     exportAll() / resetAll()
     getWatchWard() / setWatchWard(n|null)
     getInterests() / setInterests(ids)
     getWardRep() / setWardRep(slug, name) / clearWardRep()
     getMayorRep() / setMayorRep(slug, name) / clearMayorRep()
     hasProfile()
   LocalAdapter below is the production adapter on a static host: picks
   and the on-device profile (ward, an optional second watched
   ward, followed topics, ward/mayor rep snapshots, last-changed
   time) live in the visitor's own browser (localStorage), v2.
   Migration: on read, a valid v2 wins. Otherwise a valid v1 migrates
   losslessly — ward and every pick (choice + ts) carry over exactly,
   new fields empty — v2 is persisted, verified by re-reading it
   (ward + pick count must match), and only then is v1 removed. If
   persisting/verifying fails, v1 stays and the migrated state is
   kept in memory for the session. Corrupt JSON counts as absent.
   A future API phase swaps in a RemoteAdapter implementing the same
   methods — no page code changes. There is deliberately NO aggregate,
   tally, or percentage-of-visitors concept anywhere in this interface:
   a static site has no other visitors' data, and Deme never implies
   otherwise. */
/* Council alerts are an account opt-in (owner decision, Oct 20,
   2026): there is no separate sign-up form, and no form URL is
   configured anywhere. Alerts are opted into at account creation
   and managed in the account settings (account.js). */

/* Deme accounts (staged) — config constants.
   Both values empty = accounts not open: My Record shows an honest
   "accounts open soon" panel and the local, no-account profile remains
   the whole product. The parent fills these from the Supabase project
   created per WARD-FINDER-REPORT.md (project URL + anonymous key — the
   anon key is a public client key by design; row-level security, not
   secrecy, protects the data). Passwords are handled only by the auth
   provider; no Deme code ever stores or transmits one anywhere else. */
const DEME_SUPABASE_URL = "https://pesvnphmgbzejkoqbmzt.supabase.co";
const DEME_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlc3ZucGhtZ2J6ZWprb3FibXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjM1MjYsImV4cCI6MjEwODAzOTUyNn0.CaZpwARN1TsRDCrAq6wbYFQ_VLZn-AkUjHK0ujn0gIk";

/* Sign-up abuse protection (CAPTCHA), staged the same way: empty =
   no widget renders, no third-party script is loaded, and auth
   requests are exactly as before. At activation the parent sets
   this to the Cloudflare Turnstile SITE key (public by design) and
   enables Turnstile in the Supabase dashboard (Authentication →
   Bot and Abuse Protection), where the matching SECRET key lives —
   that dashboard half is a publish-step item, not code. See
   ACTIVATION-AUDIT-PROTOCOL.md F-6 / gate G-10. */
const DEME_CAPTCHA_KEY = "0x4AAAAAAFeAvARA30IkxZms";
/* Positions a visitor takes on upcoming items. This store is the
   on-device cache. When the visitor is signed in, account.js also
   saves each pick to their account (their own rows only) so their
   card and notifications follow them across devices; signed-out
   picks stay on this device. Deme never publishes tallies or
   percentages of visitor positions, anywhere. */
const VoteStore = (() => {
  const KEY = "deme.votes.v2", OLD = "deme.votes.v1";
  let mem = null; /* session-only state if a migration cannot persist */
  const now = () => new Date().toISOString();
  const fresh = () => ({ v: 2, ward: null, watchWard: null, interests: [],
    picks: {}, wardRep: null, mayorRep: null, profileUpdatedAt: null });
  function shape(p) {
    const s = fresh();
    s.ward = p.ward ?? null;
    s.watchWard = p.watchWard ?? null;
    if (Array.isArray(p.interests)) s.interests = p.interests;
    s.picks = p.picks;
    s.wardRep = p.wardRep ?? null;
    s.mayorRep = p.mayorRep ?? null;
    s.profileUpdatedAt = p.profileUpdatedAt ?? null;
    return s;
  }
  function parse(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.picks && typeof p.picks === "object") return p;
      }
    } catch (e) { /* corrupt / unavailable — treat as absent */ }
    return null;
  }
  function read() {
    if (mem) return mem;
    const p2 = parse(KEY);
    if (p2 && p2.v === 2) return shape(p2);
    const p1 = parse(OLD);
    if (p1 && p1.v === 1) {
      const s = fresh();
      s.ward = p1.ward ?? null;
      s.picks = p1.picks;
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
        const back = parse(KEY);
        if (!back || back.v !== 2 || back.ward !== s.ward
          || Object.keys(back.picks).length !== Object.keys(s.picks).length) {
          throw new Error("verify");
        }
        try { localStorage.removeItem(OLD); } catch (e) {}
        return s;
      } catch (e) { mem = s; return mem; }
    }
    return fresh();
  }
  function write(s) {
    if (mem) mem = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); }
    catch (e) { mem = s; }
  }
  return {
    storageKey: KEY,
    getWard() { return read().ward; },
    setWard(n) {
      const s = read();
      if (s.ward !== n) {
        s.ward = n; s.wardRep = null; s.profileUpdatedAt = now();
      }
      write(s);
    },
    getWatchWard() { return read().watchWard; },
    setWatchWard(n) {
      const s = read();
      if (s.watchWard !== n) { s.watchWard = n; s.profileUpdatedAt = now(); }
      write(s);
    },
    getInterests() { return read().interests.slice(); },
    setInterests(ids) {
      const s = read();
      const next = Array.isArray(ids) ? ids.slice() : [];
      if (JSON.stringify(s.interests) !== JSON.stringify(next)) {
        s.interests = next; s.profileUpdatedAt = now();
      }
      write(s);
    },
    getWardRep() { return read().wardRep; },
    setWardRep(slug, name) {
      const s = read(); s.wardRep = { slug, name }; write(s);
    },
    clearWardRep() { const s = read(); s.wardRep = null; write(s); },
    getMayorRep() { return read().mayorRep; },
    setMayorRep(slug, name) {
      const s = read(); s.mayorRep = { slug, name }; write(s);
    },
    clearMayorRep() { const s = read(); s.mayorRep = null; write(s); },
    hasProfile() {
      const s = read();
      return s.ward != null || s.watchWard != null || s.interests.length > 0;
    },
    getPick(ref) { return read().picks[ref] || null; },
    setPick(ref, choice) {
      const s = read();
      s.picks[ref] = { choice, ts: now() };
      write(s);
    },
    clearPick(ref) { const s = read(); delete s.picks[ref]; write(s); },
    allPicks() { return read().picks; },
    /* Replace the whole pick set — used after a sign-in merge, where
       the account's rows and the device's rows have been combined. */
    replacePicks(picks) {
      const s = read();
      s.picks = picks && typeof picks === "object" ? picks : {};
      write(s);
    },
    exportAll() { return read(); },
    resetAll() {
      mem = null;
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(OLD);
      } catch (e) {}
    },
  };
})();

/* ---------------- whose ward? (owner rule, Oct 20, 2026) --------
   A ward belongs to the account profile: it is set when the account
   is created and edited in the account form on My Record. There is
   no device-level ward, and finding a councillor without one is the
   directory's postal-code lookup, which saves nothing. Pages
   personalize from the profile ward only, resolved as:
   - accounts live + signed in: the VoteStore ward, which the
     account layer (account.js) keeps mirrored from the profile row;
   - accounts live + signed out: NO ward — no personalization, no
     rep tag, no snapshot read or written, whatever an older build
     left stored on this device (it stays untouched, as the sign-in
     merge's raw material);
   - accounts not live (the constants above are empty — the staged
     or kill-switch state): the on-device profile remains the whole
     product, exactly as before accounts existed.
   Pages that do not load account.js read the session record the
   account layer persists (deme.account.v1) — the same presence
   test account.js itself applies when it loads a session. */
function demeAccountsLive() {
  if (window.DemeAccount && typeof window.DemeAccount.enabled === "function") {
    return window.DemeAccount.enabled();
  }
  return Boolean(DEME_SUPABASE_URL && DEME_SUPABASE_ANON_KEY);
}
function demeSignedIn() {
  if (window.DemeAccount && typeof window.DemeAccount.isSignedIn === "function") {
    return window.DemeAccount.isSignedIn();
  }
  try {
    const raw = localStorage.getItem("deme.account.v1");
    if (!raw) return false;
    const s = JSON.parse(raw);
    return Boolean(s && s.access_token && s.user);
  } catch (e) { return false; }
}
/* True only in the one state with no profile to personalize from:
   accounts live and the visitor signed out. */
function demeSignedOut() {
  return demeAccountsLive() && !demeSignedIn();
}
/* The ward pages may personalize from, or null. */
function demeProfileWard() {
  if (demeSignedOut()) return null;
  return typeof VoteStore !== "undefined" ? VoteStore.getWard() : null;
}

/* TMMIS (City of Toronto agenda) record link for an item reference. */
const tmmisUrl = (ref) =>
  `https://secure.toronto.ca/tmmis/viewAgendaItemHistory.do?item=${encodeURIComponent(ref)}`;

/* ---------------- "/" focuses search (D7) ----------------
   The search-first shortcut: pressing "/" on a page with a search box
   (#q — Home hero, Explore) focuses it. Never fires while typing in a
   field, and modifier combos are left to the browser. WCAG fix wave
   (m-2, 2.1.4): the shortcut fires only while the search box is on
   screen, and it is documented beside the search box on both pages. */
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"
    || t.tagName === "SELECT" || t.isContentEditable)) return;
  const q = document.getElementById("q");
  if (!q) return;
  const r = q.getBoundingClientRect();
  const onScreen = r.bottom > 0 && r.top < window.innerHeight
    && r.right > 0 && r.left < window.innerWidth;
  if (onScreen) { e.preventDefault(); q.focus(); }
});

/* ---------------- share / copy link (D3) ----------------
   One quiet affordance for decision and member pages: native share
   where the platform offers it, clipboard copy elsewhere. Static
   hosting cannot mint per-page preview cards — the button shares
   the link itself, nothing more is promised. */
function setupShareButton(btn) {
  if (!btn) return;
  if (typeof navigator !== "undefined" && navigator.share) {
    btn.textContent = "Share";
  }
  btn.addEventListener("click", async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: document.title, url: location.href }); }
      catch (e) { /* the visitor dismissed the share sheet */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(location.href);
      const old = btn.textContent;
      btn.textContent = "Link copied";
      setTimeout(() => { btn.textContent = old; }, 2000);
    } catch (e) { /* clipboard unavailable — the address bar still works */ }
  });
}

/* Static sections are already parsed when this script runs (it sits at
   the end of <body> on every page), so reveal can be wired up now. */
setupReveal();
/* Stat bands in static markup are wired up here; the homepage builds
   its band from data and calls setupCountUps on it directly. */
setupCountUps(document);
