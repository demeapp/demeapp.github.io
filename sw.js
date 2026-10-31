// Deme service worker (v68 — Copy wave (Oct 30, 2026): unscoped breadth claims scoped to the record across the homepage, About, Open Data, Reporters, Representatives and Lobbying pages (new hero: 'The decisions and the recorded votes'); the Open Data 'Most decisions' paragraph now leads with the name-by-name scope (2,962 of 33,795 decisions; another 209 carry a recorded vote as a tally only; 3,171 decisions with a recorded vote); federal directory search aliases Rachael Thomas's previous surname 'Harder' (search-only — no profile, displayed name, or member data changed); the duplicated in-page LEVEL switcher is removed from Representatives, and the signed-in homepage hero entry offers 'Go to My Record' and 'Your ward' instead of the sign-up pitch; Toronto councillor Adrian Heaps's display name corrected from 'A.A. Heaps' to 'Adrian Heaps' (name field only — slug, term and figures unchanged). No other record facts changed.
// Previous: Deme service worker (v67 — Safe-fixes wave (Oct 30, 2026): John Aldag's 44th-Parliament held corrected to 792 (98.2%; career 91.3%) from his own stored ballots, and five federal member files' absent figures recomputed on the archive-wide basis; directory counts corrected to 1,359 members (1,069 federal, 732 earlier MPs) in prose, stat bands and meta; the 743,677 vote-row figure now carries its stored-vs-aggregate basis on the Open Data page; name-by-name coverage scoped to 2,962 of 3,171 recorded-vote decisions on About, Open Data and Reporters; directory search folds accents so unaccented queries find every member; Ontario disclosure years corrected to (2005–2025); Reporters council-promises count corrected to 24 of 26; homepage Toronto card cites 33,777 briefs in plain language and the stat band reads 'decisions in the archive'; participation figure lines wrap on narrow screens. No other record facts changed.
// Previous: Deme service worker (v66 — Card participation swap ship (Oct 30, 2026): representative cards now lead with the current (or last) term's recorded-vote participation figure, with the career figure in the supporting row beneath; profile panels unchanged — presentation only; no figures, counts, notes, or record data changed.
// Previous: Deme service worker (v65 — Card + profile redesign ship (Oct 30, 2026): representative cards rebuilt to the approved one-hero-figure layout and profiles to the mint summary-band design — presentation only; no figures, counts, notes, or record data changed.
// Previous: Deme service worker (v63 — Participation ship (Oct 30, 2026): every representative card and profile carries the audited participation panel — career figure with counts and span, This term / Last term rows, Speaker and died-in-office notes; Rachael Thomas's record is merged across her previous surname (77.6% career) and the duplicate Harder profile is retired; Robert Oliphant's phantom 41st-Parliament row is removed. No other record facts changed.
// Previous: Deme service worker (v62 — Backend Three ship (Oct 30, 2026): federal
// profile pages load the per-member division split file first (the whole
// layer file remains the fallback); the My Record briefing gains its
// Ontario + federal sections behind the account's riding fields and
// behaves exactly as v1 where no riding is set; the postal-code lookup
// data layer (federal verified tier + provincial provisional tier) is
// published under record-data/. No record facts changed.
// Previous: Deme service worker (v61 — About page paragraph rebalance (Oct 29, 2026):
// the About page's three-level material leads, Toronto-only explanations
// sit under their own "The Toronto record" heading, and simple-mode keys
// for the About page were re-keyed to the current text (stale keys fixed,
// values corrected to match). No facts or record data changed.
// Previous: Deme service worker (v60 — framing rebalance (Oct 29, 2026): the site
// leads with all three levels — new Why-Deme headline, Canada → Ontario →
// Toronto ordering throughout, a three-level Representatives chooser,
// an honestly titled Compare page, and three-layer Open Data and
// Reporters stat bands. Framing only; no record data changed.
// Previous: Deme service worker (v56 — Stories over time fix
// (Oct 29, 2026): the Stories section is labelled Toronto City
// Council, its cards show each story's true latest decision
// date from the regenerated threads data, story naming is
// made consistent across the homepage, story pages and About,
// and a stories-load fallback line is added. Copy and data
// change plus this version bump. (v55 — 2026 campaign commitments for
// four more incoming councillors (Oct 29, 2026): the profile data
// (record-data/profiles.json) gains the sourced 2026 campaign
// promises for Nate Erskine-Smith (14, from his own published
// policy page, nateerskinesmith.ca/policies), Curran Stikuts (20)
// and Shaun Chen (9) — Stikuts and Chen from their own published
// KnowYourVote Toronto questionnaire answers — and Diana Chan
// McNally (1, from her own published plan page,
// dianachanmcnally.ca/platform), rendered by the existing Campaign
// promises section exactly as on 2022-term profiles — presented
// as what they ran on, with no kept/broken status before the new
// term begins November 15, 2026. Sara Ehrhardt keeps the standard
// "No campaign promises on record" line: her own published
// answers and materials hold priorities and advocacy positions,
// no commitments under the same grading rule, and none were
// invented to fill the gap. Data-only change plus this version
// bump. (v54 — 2026 campaign commitments for
// two incoming councillors (Oct 28, 2026): the profile data
// (record-data/profiles.json) gains the sourced 2026 campaign
// promises for Mike Layton (27, from his own published plan
// page) and Chiara Padovani (13, from her own published
// issues page), rendered by the existing Campaign promises
// section exactly as on 2022-term profiles — presented as
// what they ran on, with no kept/broken status before the
// new term begins November 15, 2026. The other five incoming
// members keep the standard "No campaign promises on record"
// line: the verified research package holds no actual
// commitments for them (priority headings and directional
// statements only, or no published platform at all), and
// none were invented to fill the gap. Data-only change plus
// this version bump. (v53 — the lobbying record joins the
// footer (Oct 28, 2026): the shared footer that
// assets/js/common.js renders on every page gains one link,
// "Lobbying record", in The Record column after Compare,
// pointing at the lobbying page shipped in v52 — added at
// the owner's direction; until now the page's only entry
// points were the homepage and About sections. The footer
// line is the only change — no page's content, data or other
// chrome moves. (v52 — the lobbying record page
// (Oct 28, 2026): a new page, lobbying.html, presents Deme's
// federal lobbying record as part of Deme itself — the free
// per-MP record, plus the coming subscriber tools for watching
// it (alerts, search across the filed communications, digests
// and exports, for journalists, researchers, civic and
// community groups and the public) — with a locked, blurred
// sample-results preview and the notice "For paid subscribers
// — coming soon." No prices, no payment, no email capture; the
// lobbying record itself stays free on every MP's profile,
// exactly as before. The homepage gains a "Watching the
// lobbying record" section after the three-legislatures
// section, and About & method gains a matching section after
// Sources; those are the only entry points, and nothing else
// on either page changes. (v51 corrected the same-day v50
// teaser: the separate product name and the government-affairs
// audience framing are removed at the owner's direction. v52
// adds the joined-record claim to the page and both sections:
// the communications naming a member sit on the same profile
// as that member's votes, expenses and disclosures — "See who
// lobbied them — then see how they voted.")
// The three-level Upcoming (v49), the About & method
// level-scope copy fix (v48), shareable pages (v46), briefing
// (v45), INC 1+2 (v44) and the party filter (v43) are unchanged.
// Caches: app shell + static assets, visited pages, and the PUBLIC record JSON
// (read-only, for offline browsing of what was already loaded).
// Never caches: non-GET requests, cross-origin requests (Supabase auth, picks,
// watches, Turnstile), or anything carrying an Authorization header.
// Online, EVERYTHING same-origin is fetched fresh first (network-first) —
// pages, record data, AND static assets. Assets used to be served
// stale-while-revalidate; that mixed a fresh page with last deploy's JS on
// the first load after a push (Oct 22, 2026: new index.html + old common.js
// → setupCountUps ReferenceError → homepage stats/Upcoming/Latest broke
// for returning visitors). HTML and JS must always come from the same
// deploy, so assets are network-first too; cache is the offline fallback.
// VERSION bumps rename every cache, and activate deletes the old ones —
// bump VERSION whenever this file ships a strategy change.
const VERSION = 'v73';
const SHELL = 'deme-shell-' + VERSION;
const PAGES = 'deme-pages-' + VERSION;
const DATA = 'deme-data-' + VERSION;
const KEEP = [SHELL, PAGES, DATA];
const OFFLINE_URL = '/offline.html';
const MAX_PAGES = 60;
const MAX_SHELL = 200;
const MAX_DATA = 400; // per-decision files are small; this bounds storage

const PRECACHE = [
  '/',
  OFFLINE_URL,
  '/assets/css/deme.css',
  '/assets/js/common.js',
  '/assets/js/simple-mode.js',
  '/assets/js/pwa.js',
];

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, cacheName, max, ignoreSearch) {
  return fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(cacheName).then((c) => c.put(req, copy)).then(() => trim(cacheName, max));
      }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: !!ignoreSearch }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('Authorization')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: fresh when online; last-seen copy, then offline page, when not.
  if (req.mode === 'navigate') {
    event.respondWith(
      networkFirst(req, PAGES, MAX_PAGES, true).then(
        (res) => res || caches.match(OFFLINE_URL).then((r) => r || Response.error())
      )
    );
    return;
  }

  // Public record data: fresh when online; already-loaded copy when offline.
  if (url.pathname.startsWith('/record-data/')) {
    event.respondWith(
      networkFirst(req, DATA, MAX_DATA).then((res) => res || Response.error())
    );
    return;
  }

  // Static assets: fresh when online (same deploy as the page that
  // requested them); last-seen copy when offline. Never stale-while-
  // revalidate — see the header note on the Oct 22 version mix.
  if (url.pathname.startsWith('/assets/') || /\.(?:svg|png|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      networkFirst(req, SHELL, MAX_SHELL).then((res) => res || Response.error())
    );
  }
});
