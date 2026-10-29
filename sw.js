// Deme service worker (v56 — Stories over time fix
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
const VERSION = 'v57';
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
