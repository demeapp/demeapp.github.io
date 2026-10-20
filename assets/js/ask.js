/* Ask the record — a plain-words parser for Explore.
   parseAsk(q, ctx) turns a question like "how did Olivia Chow vote on
   the budget since 2022" into structured filters. It only ever parses,
   retrieves, and composes from record fields — it invents nothing.
   ctx = { members: [...councillors.json rows...], storedWard: n|null }.
   Pure function: no DOM, no storage access (callers pass storedWard in).
   Loaded by explore.html; also require()-able in Node for tests. */
"use strict";

/* Words that carry the question's shape, not its subject. The core list
   is the specified stopword set; the extras are question scaffolding
   (decide/happened/thing/councillor/pronouns/question words) that would
   otherwise poison the plain substring search — e.g. "decide" is not a
   substring of anything in the record, so leaving it in would zero out
   "what did council decide about bike lanes in 2024". */
const ASK_STOPWORDS = new Set([
  "what", "did", "the", "a", "an", "on", "in", "of", "to", "how",
  "council", "toronto", "city", "vote", "votes", "voted", "show", "me",
  "find", "all", "about", "for", "from", "with", "was", "were", "are",
  "there", "any", "decisions", "decision",
  /* scaffolding extras */
  "decide", "decided", "decides", "deciding", "happen", "happened",
  "thing", "things", "item", "items", "councillor", "councillors", "councilor",
  "councilors", "member", "members", "my", "your", "their", "when",
  "who", "which", "is", "it", "its", "by", "and", "or", "do", "does",
  "please", "tell", "list",
  /* relative pronoun — pure scaffolding in "decisions about parks
     that were rejected" (D1): left in, it becomes a free token no
     record contains and zeroes a real answer. */
  "that",
]);

/* Topic aliases. `say` is matched against the QUERY (word boundaries);
   `tokens` are matched against a row's title + subject terms with \b
   boundaries in explore.js — never substring, so "rent" can never
   match "current". Each topic is a group: a row matches the group when
   ANY of its tokens matches. */
const ASK_TOPICS = [
  { label: "road safety", say: /\broad safety\b|\bvision zero\b/,
    tokens: ["vision zero", "road safety", "speed limit", "traffic calming"] },
  { label: "child care", say: /\bchild ?care\b|\bdaycare\b/,
    tokens: ["child care", "childcare", "daycare"] },
  { label: "taxes", say: /\bproperty tax\b|\btax(es)?\b/,
    tokens: ["property tax", "tax rate"] },
  { label: "homelessness", say: /\bhomelessness\b|\bhomeless\b|\bencampments?\b/,
    tokens: ["homeless", "encampment"] },
  { label: "housing", say: /\bhousing\b/, tokens: ["housing"] },
  { label: "rent", say: /\brents?\b|\brental\b/, tokens: ["rent"] },
  { label: "transit", say: /\btransit\b|\bttc\b|\bsubway\b|\bstreetcar\b/,
    tokens: ["transit", "ttc", "subway", "streetcar"] },
  { label: "bike lanes & cycling",
    say: /\bbike lanes?\b|\bbikes?\b|\bcycling\b|\bcycle\b|\bbikeway\b/,
    tokens: ["bike lane", "cycling", "bikeway", "bike share", "bicycle"] },
  { label: "budget", say: /\bbudget\b/, tokens: ["budget"] },
  { label: "parks", say: /\bparks?\b|\brecreation\b/,
    tokens: ["park", "parks", "recreation"] },
  { label: "police", say: /\bpolice\b|\bpolicing\b/,
    tokens: ["police", "policing"] },
  { label: "libraries", say: /\blibrar\w*\b/,
    tokens: ["library", "libraries"] },
  { label: "zoning", say: /\bzoning\b/, tokens: ["zoning"] },
  { label: "climate", say: /\bclimate\b|\bemissions?\b|\bnet zero\b/,
    tokens: ["climate", "emissions", "net zero"] },
  { label: "waste", say: /\bgarbage\b|\bwaste\b|\brecycling\b/,
    tokens: ["waste", "recycling"] },
  { label: "flooding", say: /\bflood\w*\b/, tokens: ["flood"] },
];

function parseAsk(q, ctx) {
  const members = (ctx && ctx.members) || [];
  const original = String(q || "");
  let work = " " + original.toLowerCase().replace(/\s+/g, " ").trim() + " ";
  const out = {
    member: null, voteOnly: false, closeOnly: false, statusGroup: null,
    yearFrom: null, yearTo: null, ward: null, topicTokens: [],
    freeTokens: [], recognized: false, raw: original,
  };
  const cut = (re) => { work = work.replace(re, " "); };

  /* 1 — member names: full name first, else a unique last name. */
  const byNameLen = [...members].sort(
    (a, b) => b.name.length - a.name.length);
  for (const m of byNameLen) {
    const full = m.name.toLowerCase();
    if (work.includes(" " + full + " ") || work.includes(" " + full)) {
      out.member = { slug: m.slug, name: m.name };
      cut(new RegExp(full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
      break;
    }
  }
  if (!out.member) {
    const lastCount = new Map(), lastMember = new Map();
    members.forEach((m) => {
      const last = m.name.toLowerCase().split(/\s+/).pop();
      lastCount.set(last, (lastCount.get(last) || 0) + 1);
      lastMember.set(last, m);
    });
    for (const [last, n] of lastCount) {
      if (n === 1 && new RegExp(`\\b${last}\\b`).test(work)) {
        const m = lastMember.get(last);
        out.member = { slug: m.slug, name: m.name };
        cut(new RegExp(`\\b${last}\\b`, "g"));
        break;
      }
    }
  }
  if (out.member && /\bhow did\b|\bdid\b[^?]*\bvote|\bvote on\b|\bvoted\b/.test(original.toLowerCase())) {
    out.voteOnly = true;
  }

  /* 2 — years. */
  let ym;
  if ((ym = work.match(/\bbetween\s+(\d{4})\s+and\s+(\d{4})\b/))) {
    out.yearFrom = Number(ym[1]); out.yearTo = Number(ym[2]); cut(ym[0]);
  } else if ((ym = work.match(/\bsince\s+(\d{4})\b/))) {
    out.yearFrom = Number(ym[1]); out.yearTo = 2026; cut(ym[0]);
  } else if ((ym = work.match(/\bafter\s+(\d{4})\b/))) {
    out.yearFrom = Number(ym[1]) + 1; out.yearTo = 2026; cut(ym[0]);
  } else if ((ym = work.match(/\bbefore\s+(\d{4})\b/))) {
    out.yearFrom = 2018; out.yearTo = Number(ym[1]) - 1; cut(ym[0]);
  } else if (/\blast year\b/.test(work)) {
    out.yearFrom = 2025; out.yearTo = 2025; cut(/\blast year\b/);
  } else if (/\bthis year\b/.test(work)) {
    out.yearFrom = 2026; out.yearTo = 2026; cut(/\bthis year\b/);
  } else if ((ym = work.match(/\bin\s+(\d{4})\b/))) {
    out.yearFrom = Number(ym[1]); out.yearTo = Number(ym[1]); cut(ym[0]);
  } else if ((ym = work.match(/\b((?:19|20)\d{2})\b/))) {
    out.yearFrom = Number(ym[1]); out.yearTo = Number(ym[1]); cut(ym[0]);
  }

  /* 3 — ward. "my councillor" reads as the visitor's own ward too:
     it can only mean the member for the stored ward. */
  let wm;
  if ((wm = work.match(/\bward\s+(\d{1,2})\b/))) {
    out.ward = Number(wm[1]); cut(wm[0]);
  } else if (/\bmy ward\b/.test(work)) {
    out.ward = "mine"; cut(/\bmy ward\b/);
  } else if (/\bmy councillor\b|\bmy councilor\b|\bmy council member\b/.test(work)) {
    out.ward = "mine"; cut(/\bmy (councillor|councilor|council member)\b/);
  }

  /* 4 — outcome. statusGroup = { codes: [...], label } — "adopted"
     means ADOPTED or AMENDED, matching how the site labels outcomes.
     The not-adopted vocabulary covers the natural verb forms too:
     leaving bare "reject" / "turned down" as free text words would
     zero a question that has a real answer (the D1 failure class). */
  if (/\bvoted down\b|\breject(s|ed|ing)?\b|\bdefeated\b|\brefus\w+\b|\bturn(ed)? down\b|\bveto\w*\b/.test(work)) {
    out.statusGroup = { codes: ["NOTADOPT"], label: "Not adopted" };
    cut(/\bvoted down\b|\breject(s|ed|ing)?\b|\bdefeated\b|\brefus\w+\b|\bturn(ed)? down\b|\bveto\w*\b/g);
  } else if (/\bpostponed\b|\bdeferred\b/.test(work)) {
    out.statusGroup = { codes: ["POSTPONE", "DEFERIND"], label: "Postponed or deferred" };
    cut(/\bpostponed\b|\bdeferred\b/g);
  } else if (/\bdid council (pass|approve|adopt)\b/.test(work)
      || /\bwas\b[^?]*\b(approved|adopted|passed)\b/.test(work)
      || /\b(approved|adopted|passed|approve|adopt)\b/.test(work)) {
    out.statusGroup = { codes: ["ADOPTED", "AMENDED"], label: "Adopted, including adopted with changes" };
    cut(/\b(approved|adopted|passed|approve|adopt|pass)\b/g);
  }

  /* 5 — recorded / close votes. Close implies recorded. */
  if (/\bclose (vote|votes|decision|decisions)\b/.test(work)
      || /\bnarrow\b/.test(work)
      || /\bdecided by (one|two|\d+) votes?\b/.test(work)) {
    out.closeOnly = true; out.voteOnly = true;
    cut(/\bclose (vote|votes|decision|decisions)\b|\bnarrow\b|\bdecided by (one|two|\d+) votes?\b/g);
  }
  if (/\brecorded votes?\b/.test(work)) { out.voteOnly = true; cut(/\brecorded votes?\b/g); }
  if (/\bwho voted\b/.test(work)) { out.voteOnly = true; cut(/\bwho voted\b/g); }
  if (/\bnames on the record\b/.test(work)) { out.voteOnly = true; cut(/\bnames on the record\b/g); }
  if (/\bhow did\b[^?]*?\bvot\w*\b/.test(work)) { out.voteOnly = true; cut(/\bhow did\b[^?]*?\bvot\w*\b/); }
  if (/\bdid\b[^?]*?\bvot\w*\b/.test(work)) { out.voteOnly = true; cut(/\bdid\b[^?]*?\bvot\w*\b/); }
  if (/\bvot\w+ on\b/.test(work)) { out.voteOnly = true; cut(/\bvot\w+ on\b/); }

  /* 6 — topics (alias groups). */
  for (const t of ASK_TOPICS) {
    if (t.say.test(work)) {
      out.topicTokens.push({ label: t.label, tokens: t.tokens });
      work = work.replace(new RegExp(t.say.source, "g"), " ");
    }
  }

  /* 7 — whatever is left, minus stopwords, is a plain substring search. */
  const seen = new Set();
  work.toLowerCase().split(/[^a-z0-9']+/).forEach((tok) => {
    const t = tok.replace(/^'+|'+$/g, "");
    if (t && !ASK_STOPWORDS.has(t) && !seen.has(t)) {
      seen.add(t); out.freeTokens.push(t);
    }
  });

  out.recognized = Boolean(out.member || out.statusGroup || out.voteOnly
    || out.closeOnly || out.yearFrom != null || out.ward != null
    || out.topicTokens.length);
  return out;
}

/* Word-boundary matcher for topic tokens against a search row's
   title + subject terms. A trailing optional "s" lets the token
   "bike lane" match the record's own term "bike lanes". */
function askTopicRegex(token) {
  const body = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${body}s?\\b`);
}
function askRowMatchesTopics(row, groups) {
  if (!groups || !groups.length) return true;
  const hay = row.t + " " + row.tp;
  return groups.every((g) => g.tokens.some((t) => askTopicRegex(t).test(hay)));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseAsk, askRowMatchesTopics, askTopicRegex, ASK_TOPICS, ASK_STOPWORDS };
}
