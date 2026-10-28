/* Deme — "Simpler text" mode (Stream D preview, Oct 23, 2026).
   A site-wide mode that re-renders DEME'S OWN WORDS in simpler
   language — shorter sentences, common words, the same facts. The
   record itself is never touched: votes, figures, names, dates,
   outcomes, titles and official wording come from record-data/ and
   are identical in both modes.

   How it works (see readable-oct23/STREAM-D-DESIGN-NOTE.md):
   1. SIMPLE_TEXT below is a hand-authored pair table (normal -> simple).
      A pair applies only on an EXACT whole-text-node match
      (whitespace-normalised), so nothing can be half-replaced inside
      record data, a title, or a longer sentence.
   2. Strings that are BUILT (templated with numbers/names) can never
      exact-match; their renderers call DemeSimple.t(normal, simple)
      or branch on DemeSimple.isOn() instead. Both branches are
      hand-written; the numbers are interpolated identically.
   3. Decision briefs: the decision page shows the existing
      record-data/simple-<year>.json corpus when the mode is on
      (decision.js); cards use simplifyBrief(), a currency-expansion
      transform that cannot alter facts.
   4. Off restores every node's original text (kept in a WeakMap) —
      off is the untouched site.

   Persistence: localStorage "deme.simple.v1" ("1"/"0") on this device,
   and — when signed in — the account's profiles.simple_text field.
   account.js wires the two together: on sign-in it applies the row's
   value via DemeSimple.setPreference(on, { fromAccount: true }), and
   it listens for the "deme:simple-changed" event (detail: {on, source})
   to upsert toggles made on this device; events sourced from the
   account itself are ignored, so there is no write loop. The toggle
   states the behaviour plainly: the choice is saved on this device,
   and to the account when signed in.
*/
"use strict";

const DemeSimple = (() => {
  const KEY = "deme.simple.v1";
  let on = false;
  try { on = localStorage.getItem(KEY) === "1"; } catch (e) { /* session-only */ }
  let observer = null;
  let applying = false;

  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  /* ---------------- the strings table ----------------
     Keys and values are compared after whitespace normalisation.
     Every number, date, proper name and outcome word in a key must
     appear in its value — the parity gate (STREAM-D-PARITY.md)
     checks exactly that, pair by pair. */
  const SIMPLE_TEXT = {
    /* ----- chrome: header, footer ----- */
    "— Toronto City Council's record, in plain language. Non-partisan. No grades, no endorsements — just the record.":
      "— Toronto City Council's record, in easy words. Non-partisan. No grades, no endorsements — just the record.",
    "Built from the City of Toronto's published council records. Decision archive: 2018–2026 · Voting record: name-by-name rows 2018–2026, member totals back to 2006 · Archive current to Oct 19, 2026 — see":
      "Built from the City of Toronto's own council records. Decisions: 2018–2026. Votes with names: 2018–2026. Member totals go back to 2006. The archive is up to date to Oct 19, 2026 — see",
    "— the public record of your elected representatives, in plain language — municipal, provincial and federal. Non-partisan. No grades, no endorsements — just the record.":
      "— the public record of your elected representatives, in easy words — city, provincial and federal. Non-partisan. No grades, no endorsements — just the record.",
    "Built from the published records of the City of Toronto, the Legislative Assembly of Ontario and the House of Commons. Coverage for each legislature is stated in full on its directory and on":
      "Built from the records the City of Toronto, the Legislative Assembly of Ontario and the House of Commons publish. How much each one covers is stated in full on its directory page and on",
    "Follow Deme": "Follow Deme",
    "About & method": "About and how it works",
    "Privacy policy": "Privacy policy",
    "Embed the record": "Put the record on your site",
    "For reporters": "For reporters",
    "Open data": "Open data",
    "Weigh in": "Weigh in",

    /* ----- home ----- */
    "Municipal · Provincial · Federal · The record, in plain language":
      "Municipal · Provincial · Federal · The record, in easy words",
    "Every decision, every vote — City Hall, Queen's Park, and Parliament Hill, in plain language.":
      "Every decision and every vote — at City Hall, Queen's Park and Parliament Hill, in easy words.",
    "Three legislatures, one record": "Three levels of government, one record",
    "Deme covers the representatives you elect at every level — the same plain-language record for each.":
      "Deme covers the people you elect at every level. It keeps the same record for each, in easy words.",
    "33,795 decisions in plain language, every member's votes, declared interests and expenses — and a say before the next vote.":
      "33,795 decisions in easy words, every member's votes, the interests they declared and their expenses — and a say before the next vote.",
    "Every MPP's record: 505 recorded divisions — the 2018–2022 span extracted from House documents — disclosure statements, 2005–2025, and lobbying registrations.":
      "Every MPP's record: 505 recorded votes — the 2018–2022 span was taken from House documents — the statements they filed about their interests, 2005–2025, and lobbying registrations.",
    "Every MP's record: 4,856 recorded divisions, ethics registry documents, and 172,864 lobbying communications.":
      "Every MP's record: 4,856 recorded votes, ethics registry papers, and 172,864 lobbying contacts.",
    "Deme turns the City of Toronto's published council records into plain language. Search a topic, a street, or a name, and see the decision — and the vote behind it.":
      "Deme takes the City of Toronto's council records and puts them in easy words. Search for a topic, a street, or a name. You will see the decision — and how people voted on it.",
    "Ask in plain words:": "Ask in your own words:",
    "Have your say on upcoming Council decisions, watch the ones that matter to you — we'll email you the outcome once — and see where you stand against your representative.":
      "Have your say on Council decisions coming up. Watch an item and we will email you the result once. See how your choices compare with your representative's.",
    "And counting — the record grows with every meeting.":
      "And still counting — the record grows with each meeting.",
    "Upcoming at City Council": "Coming up at City Council",
    "Make Deme yours": "Set up Deme for you",
    "Set your ward to see your representative, your area's decisions, and alerts.":
      "Set your ward. You will see your representative, decisions for your area, and alerts.",
    "Each story below groups the decisions in one thread of the record, oldest story to newest decision — grouping is a finding aid; the record itself is unchanged.":
      "Each story below puts the decisions on one topic in one place, from the oldest story to the newest decision. Grouping only helps you find things. The record itself does not change.",
    "Most Toronto council decisions come with no recorded vote — no public list of who voted yes and who voted no. Deme keeps the whole record readable, and flags every decision where the names":
      "Most Toronto council decisions have no recorded vote. There is no public list of who voted yes and who voted no. Deme keeps the whole record easy to read, and marks each decision where the names",
    "are on it, so you can see exactly how your representative voted.":
      "are on it, so you can see just how your representative voted.",
    "Existing tools do part of the job. Deme picks up where they stop: a plain-language record matched to your ward and your ridings.":
      "Other tools do part of the job. Deme does the rest: a record in easy words, matched to your ward and your ridings.",
    "tracks US Congress bills and member voting records.":
      "Tracks US Congress bills and how members voted.",
    "US federal only — nothing for Canadians at any level.":
      "US federal only — nothing for Canadians at any level.",
    "plain-language summaries, polls, contact your lawmaker.":
      "Easy summaries, polls, and a way to contact your lawmaker.",
    "US federal & state only; contact tool is US-only. No Canadian coverage.":
      "US federal and state only. The contact tool is US-only. No Canadian coverage.",
    "clean mobile app, push alerts, rep voting records.":
      "A clean phone app, alerts, and voting records for representatives.",
    "US only; advocacy-driven priorities, not a neutral record.":
      "US only. It takes sides, so it is not a neutral record.",
    "excellent, searchable Hansard and House of Commons votes.":
      "Very good, searchable Hansard and House of Commons votes.",
    "stops at the federal level — nothing provincial or municipal, and no ward-level view.":
      "Stops at the federal level — nothing provincial or city, and no ward view.",
    "Deme is built for all three levels of government in Canada: matched to your ward and your ridings · your positions save to your account — only yours to see, never tallied · a permanent public record.":
      "Deme is built for all three levels of government in Canada. It is matched to your ward and your ridings. Your positions save to your account — only you can see them, and they are never tallied. It is a permanent public record.",
    "Built to complete the record, not just cover it":
      "Built to show the full record, not just part of it",
    "This is the record behind that vision: every decision, every recorded vote, and the promises on the record — public, permanent and plain. Every representative shown fairly and without favour. Every resident trusted to judge the record for themselves.":
      "This is the record behind that idea: every decision, every recorded vote, and the promises on the record — public, here to stay, and plain. Each representative is shown in a fair way, with no favour. Each resident is trusted to judge the record for themselves.",

    /* ----- explore ----- */
    "Every Toronto council decision in the archive — nearly all with a plain-language brief. Search words from the title or topic — or use the filters to narrow by year, ward, or outcome. Looking for a person? A name or a riding finds them in any of the three legislatures — Toronto, Ontario or Canada.":
      "Every Toronto council decision in the archive — nearly all with a brief in easy words. Search with words from the title or topic. Or use the filters to narrow by year, ward, or outcome. Looking for a person? A name or a riding finds them in any of the three legislatures — Toronto, Ontario or Canada.",
    "is the public list of who voted yes and who voted no. Most decisions don't have one.":
      "is the public list of who voted yes and who voted no. Most decisions do not have one.",
    "Narrow the record to decisions for the ward you saved.":
      "Show only decisions for the ward you saved.",
    "Loading the archive…": "Loading the archive…",
    "No decisions match. Try fewer words, or clear a filter.":
      "No decisions match. Try fewer words, or clear a filter.",
    "The archive could not be loaded. Please reload the page.":
      "The archive could not be loaded. Please reload the page.",
    "Pick two members to see their shared record.":
      "Pick two members to see their shared record.",
    "Those are the same member — pick two different members to compare.":
      "Those are the same member. Pick two different members to compare.",
    "Lining up the shared record…": "Lining up their shared record…",
    "They took the same position on every shared recorded vote in the archive.":
      "They took the same position on every recorded vote in the archive that both of them took part in.",
    "The member list could not be loaded. Please reload.":
      "The member list could not be loaded. Please reload.",
    "Looking for the person? See": "Looking for the person? See",

    /* ----- representatives directory ----- */
    "Facts only — no grades, no rankings. Recorded-vote participation is the share of recorded votes where a member was present and voting — not a count of meetings attended, and declared interests never count against it.":
      "Facts only — no grades, no rankings. Recorded votes they took part in means: of the recorded votes, the share where the member was there and voted. It is not a count of meetings they went to. A declared interest never counts against them.",
    "Type a name or a ward to filter the members below — or enter your postal code to find your representative and their record.":
      "Type a name or a ward to cut the list below. Or type your postal code to find your representative and their record.",
    "Only the first 3 characters of a postal code are used, right here in your browser — your full postal code is never stored or sent anywhere. A lookup only: nothing is saved, and it sets nothing on your profile.":
      "Only the first 3 characters of your postal code are used, right here in your browser. Your full postal code is never saved or sent anywhere. It is a lookup only. Nothing is saved, and it sets nothing on your profile.",
    "Each card carries four facts — recorded-vote participation, votes cast, tenure, and — from the recorded votes — the times a member declared an interest and did not vote. Open a member for the full record. Portraits are the members’ official photos; where none is published, initials instead.":
      "Each card shows four facts: recorded votes they took part in, votes cast, how long they have served, and — from the recorded votes — times they declared an interest and did not vote. Open a member to see the full record. The photos are the members' official photos. If none is published, the card shows initials instead.",
    "Members from earlier terms, in the same archive.":
      "Members from earlier terms, in the same archive.",
    "Of the 74 earlier Toronto members listed here, 27 have a published official portrait; the rest are shown with initials.":
      "Of the 74 earlier Toronto members listed here, 27 have a published official portrait. The rest are shown with initials.",
    "“Interest declared on a recorded vote · stepped back (since Jun 2023)” counts recorded votes where a member declared an interest and did not vote. The voting record only carries that flag from June 2023 — earlier declarations were recorded as ordinary absences — so a dash marks a member whose service ended before June 2023. Each member’s page also lists the declarations on the City’s official register, counted separately. Those register counts now appear on each earlier member’s row below too, in the mint band under their stats, labelled with the registers they come from.":
      "“Declared an interest on a recorded vote · did not vote (since Jun 2023)” counts recorded votes where a member declared an interest and did not vote. The voting record only carries that mark from June 2023. Before that, declarations were written down as plain absences. So a dash means the member's service ended before June 2023. Each member's page also lists the declarations on the City's official list, counted on its own. Those counts now appear on each earlier member's row below too, in the green band under their stats, with the names of the lists they come from.",

    /* ----- member profile: JS-rendered panels ----- */
    "Standing assignments in this member profile.":
      "The committees and boards they sit on, from this member profile.",
    "No standing committee or board assignments are listed in this profile.":
      "No committee or board assignments are listed in this profile.",
    "Public office contact details.": "How to reach their office.",
    "Opens your email app with the office address filled in. Deme does not send or read the message.":
      "This opens your email app with the office address filled in. Deme does not send or read your message.",
    "No public office contact details are listed in this profile.":
      "No office contact details are listed in this profile.",
    "Promises are carried from the campaign material each member published, with the source kept beside the words. Related votes are matched by topic from this member’s recorded votes — a finding aid, not a verdict on whether a promise was kept.":
      "These promises come from what each member published in their campaign. The source sits beside the words. Related votes are matched by topic from this member's recorded votes. They help you find votes. They do not say if a promise was kept.",
    "No campaign promises on record for this member.":
      "No campaign promises on record for this member.",
    "Lobbyists must file every communication with a member of Council — any contact a registered lobbyist reported naming this member, whether a meeting, a call or an email. It records the lobbyist's activity, not anything the member sought or did, and is never a claim about influence.":
      "Lobbyists must report every time they contact a member of Council. This counts any contact a registered lobbyist reported with this member — a meeting, a call, or an email. It shows what the lobbyist did. It does not show anything the member asked for or did. It is never a claim about influence.",
    /* Lobbying note pair RETIRED (WS2b, Oct 23): the note's registry
       snapshot date is now read from lobbying.json at render time, so
       the string is built, not static — councillor.js renders it
       through a simpleOn() branch with the date interpolated
       identically in both modes (the simple wording there is the one
       this pair carried). No exact-match pair can carry a data-driven
       date, and a stale pair here would freeze the old date. */
    "Communications by year": "Communications in each year",
    "All communications, as filed": "All contacts, as reported",
    "Gifts and benefits this member disclosed, as published in the Integrity Commissioner's Gift Disclosure Registry. Values are as published.":
      "Gifts and benefits this member reported, as published in the Integrity Commissioner's Gift Disclosure Registry. Values are as published.",
    "Declared interests — the official register": "Declared interests — the official list",
    "This member's recorded votes predate the searchable decision archive, which begins in 2018. Their votes are counted in the totals above; the item-by-item record starts with the 2018 term.":
      "This member's recorded votes came before the decision archive you can search, which starts in 2018. Their votes are counted in the totals above. The record, item by item, starts with the 2018 term.",
    "The voting record could not be loaded.": "The voting record could not be loaded.",
    "Public office contact details, as listed in the record.":
      "How to reach the office, as listed in the record.",
    "Most Council decisions start at a committee — and residents can address it directly.":
      "Most Council decisions start at a committee. Residents can speak to the committee.",
    "and note which committee is hearing it, and when.":
      "and note which committee will hear it, and when.",
    "Tell the City Clerk you want to speak on the item — anyone can. The City's page on":
      "Tell the City Clerk you want to speak on the item. Anyone can do this. The City's page on",
    "sets out how to register — you are asked to register by 4:30 p.m. the day before the meeting. Written comments can be sent instead, and become part of the public record.":
      "explains how to sign up. You must sign up by 4:30 p.m. the day before the meeting. You can also send written comments instead. They become part of the public record.",
    "Public presentations are limited to five minutes. Say who you are, where you live, and what you are asking the committee to do.":
      "You get five minutes to speak. Say who you are, where you live, and what you want the committee to do.",
    "Say your piece.": "Say what you think.",

    /* ----- decision page ----- */
    "The City's published voting record gives the result above, but its name-by-name rows for this vote are incomplete — so no breakdown is shown, rather than a wrong one.":
      "The City's published voting record gives the result above. But its rows by name for this vote are not complete. So no breakdown is shown, rather than a wrong one.",
    "Made without a name-by-name vote, so no member's position is attached to it in the public record. Only about 9 in every 100 Council decisions has one.":
      "This decision was made without a vote by name. So the public record does not show how each member voted. Only about 9 in every 100 Council decisions has a vote by name.",
    "Citywide — this decision applies across Toronto.":
      "Citywide — this decision covers all of Toronto.",
    "It may predate the decision archive (2018) or the reference may be mistyped.":
      "It may be from before the decision archive (2018), or the reference may be typed wrong.",
    "What the item proposed": "What the item asked for",
    "The vote record could not be loaded. The official record is linked below.":
      "The vote record could not be loaded. The official record is linked below.",

    /* ----- compare ----- */
    "Choose any two members. Deme lines up the recorded votes where both voted on the same motion — how often they landed on the same side, and where they differed.":
      "Pick any two members. Deme lines up the recorded votes where both voted on the same motion. It shows how often they were on the same side, and where they were not.",
    "Agreement here is arithmetic, not a grade: members are compared only on shared recorded votes. Absences and declared interests are left out of the comparison — a declared interest is a duty, not a position.":
      "Agreement here is just counting. It is not a grade. Members are compared only on recorded votes they both took part in. Time away and declared interests are left out. A declared interest is a duty, not a position.",
    "Different recorded positions": "Where they voted in different ways",

    /* ----- my record ----- */
    "Your one personal home on Deme: weigh in before the vote, then see your picks lined up against the public record.":
      "Your own home page on Deme. Say what you think before the vote. Then see your picks next to the public record.",
    "Make your voice heard — before the vote, not after it.":
      "Have your say — before the vote, not after it.",
    "— after the vote, your voting card lines your picks up against how your representative actually voted.":
      "— after the vote, your voting card puts your picks next to how your representative voted.",
    "Reading the record never needs an account. Your picks are yours alone — only you can see them, and Deme never totals visitors' positions.":
      "You never need an account to read the record. Your picks are yours alone. Only you can see them. Deme never adds up visitors' picks.",
    "Account tools load here — if they don't appear, this page still works in full on this device.":
      "Account tools load here. If they do not show up, this page still works in full on this device.",
    "Your topics and Council alerts live here. Just looking for your representative?":
      "Your topics and Council alerts are here. Just looking for your representative?",
    "Take your position before the vote. Signed-in picks save to your account; after the meeting, your picks below are lined up against what Council actually did.":
      "Say what you think before the vote. If you are signed in, your picks save to your account. After the meeting, your picks below sit next to what Council did.",
    "Watch an item and it waits here. When Council decides it, we email you the outcome once, and the item lands here with its result — and your pick beside it if you weighed in.":
      "Watch an item and it will wait here. When Council decides it, we email you the outcome once. The item then shows here with its result, and your pick beside it if you gave one.",
    "Erase my picks, ward and preferences": "Erase my picks, ward and settings",
    "Signed in, your picks save to your account and stay on this device too; signed out, they live only in this browser. With an account, your name, email, wards, topics and picks are held on our server so they can follow you — the":
      "If you are signed in, your picks save to your account and stay on this device too. If you are signed out, they live only in this browser. With an account, your name, email, wards, topics and picks are kept on our server, so they can follow you — the",
    "lists exactly what's held and how to delete it.":
      "lists exactly what is kept and how to delete it.",
    "Sign in to save picks to your account and to change them.":
      "Sign in to save picks to your account and to change them.",
    "No pick yet — tap Support or Oppose to save your pick to your account.":
      "No pick yet. Tap Support or Oppose to save your pick to your account.",
    "Why some picks aren't counted": "Why some picks are not counted",
    "This item hasn't been decided in the published record yet — check":
      "This item has not been decided in the published record yet — check",
    "Accounts are opening soon. Nothing is missing today: the full record is open to everyone — an account is how you weigh in and keep your picks.":
      "Accounts are opening soon. Nothing is missing today. The full record is open to everyone. An account is how you weigh in and keep your picks.",
    "What Deme holds, where, and how to delete it: the":
      "What Deme keeps, where, and how to delete it: the",
    "Your ward is part of your account profile — it's set when you create your account, so Deme can put your representative's actual votes beside your picks, on any device.":
      "Your ward is part of your account profile. You set it when you create your account. That way Deme can put your representative's real votes beside your picks, on any device.",
    "Just looking for your representative?": "Just looking for your representative?",
    "Find them by postal code in the directory": "Find them by postal code in the directory",
    "— a lookup only; nothing is saved. And nothing else on this page waits on an account — the whole record stays open either way.":
      "— a lookup only. Nothing is saved. Nothing else on this page needs an account. The whole record stays open either way.",

    /* ----- about ----- */
    "How Deme works": "How Deme works",
    "What Deme is": "What Deme is",
    "Deme is a non-partisan project that makes the public record of your elected representatives readable — Toronto City Council, the Ontario Legislature and the House of Commons. The same official facts, in plain language, searchable by topic, by place, and by the person who cast the vote.":
      "Deme takes no side. It makes the public record of your elected representatives easy to read — Toronto City Council, the Ontario Legislature and the House of Commons. It uses the same official facts, in plain language. You can search by topic, by place, and by the person who cast the vote.",
    "Everything here comes from the official published records of the three legislatures Deme covers. Toronto: the City of Toronto's council records — the agenda items, decisions, and voting records the City itself posts, linked from every decision page as the “official record.” Ontario: the Legislative Assembly of Ontario's member, vote and bill records, with members' disclosure statements from the Office of the Integrity Commissioner of Ontario. Canada: the House of Commons' member and vote records, with registry documents from the Office of the Conflict of Interest and Ethics Commissioner and lobbying records from the Office of the Commissioner of Lobbying of Canada. Deme adds no outside facts about any member or decision.":
      "Everything here comes from the official published records of the three legislatures Deme covers. Toronto: the City of Toronto's council records — the agenda items, decisions, and voting records the City itself posts, linked from every decision page as the “official record.” Ontario: the Legislative Assembly of Ontario's member, vote and bill records, with members' statements about their interests from the Office of the Integrity Commissioner of Ontario. Canada: the House of Commons' member and vote records, with registry papers from the Office of the Conflict of Interest and Ethics Commissioner and lobbying records from the Office of the Commissioner of Lobbying of Canada. Deme adds no outside facts about any member or decision.",
    "How the briefs are written": "How the short summaries are written",
    "Nearly every Toronto council decision carries a short brief: a plain-language summary of what the item is and what was decided, prepared from the official record and readable in under a minute. Briefs summarize — they never replace the record. The official wording is one tap away on every decision page. Where a brief and the official record differ, the official record is right.":
      "Nearly every Toronto council decision has a short brief. It is a summary in plain language. It says what the item is and what was decided. It is made from the official record. It takes under a minute to read. A brief does not replace the record. The official wording is one tap away on every decision page. If a brief and the official record differ, the official record is right.",
    "The line that says why it matters": "The line that says why it matters",
    "Many decisions carry one extra line under the brief, saying in plain words why the decision matters. Each line is composed by template from the record's own fields — the topic, the outcome, the recorded-vote result where one exists, and amounts named in the official summary. If a line can't be sourced from the record, it isn't written: some decisions simply have no line.":
      "Many decisions have one extra line under the brief. The line says, in plain words, why the decision matters. Each line is built by template from the record's own fields. The fields are the topic, the outcome, the recorded-vote result where one exists, and amounts named in the official summary. If a line can't be sourced from the record, it isn't written. Some decisions simply have no line.",
    "Toronto decisions are also grouped into story threads by documented keyword rules over their titles and subject terms. The grouping is conservative — when in doubt a decision is left out — and a decision can appear in more than one thread. Threads are a finding aid: they change nothing in the record.":
      "Toronto decisions are also grouped into story threads. The grouping uses documented keyword rules on their titles and subject terms. The rules are careful. If there is doubt, a decision is left out. One decision can be in more than one thread. Threads only help you find things. They change nothing in the record.",
    "Asking in plain words": "Asking in plain words",
    "Search understands plain questions — topics, names, years, outcomes — and shows its working in a line above the results, so you can see what it took your words to mean and change any of it with the filters. It only ever retrieves real decisions; if it can't break a question down, it says so and runs a plain search instead. People search works across all three legislatures: a name or a riding finds the person's record, whichever body they sit in.":
      "Search understands plain questions — topics, names, years, outcomes. It shows its working in a line above the results. You can see what it took your words to mean. You can change any of it with the filters. It only ever shows real decisions. If it can't break a question down, it says so and runs a plain search instead. People search works across all three legislatures. A name or a riding finds the person's record, in whichever body they sit.",
    "Deme takes no side: no grades, no rankings, no endorsements, no characterizations of any member. Every member's record is shown in the same format, with the same fields: recorded-vote participation as a plain statistic, votes cast, declared interests, and the item-by-item record. Readers draw their own conclusions.":
      "Deme takes no side. It has no grades, no rankings, no endorsements, and no characterizations of any member. Every member's record is shown in the same format, with the same fields: recorded-vote participation as a plain statistic, votes cast, declared interests, and the item-by-item record. Readers make up their own minds.",
    ", below, gives the full method. One rule: a declared interest is never counted against a member. Stepping back from that vote is a duty, not an absence.":
      ", below, gives the full method. One rule needs to be clear: a declared interest is never counted against a member. Stepping back from that vote is a duty, not an absence.",
    "On the Toronto record, recorded-vote participation is a member's votes cast divided by their votes cast plus their absences, across recorded votes where a vote was theirs to cast — the share of recorded votes where the member was present and voting. It counts only recorded votes, the name-by-name kind. It is not a count of meetings attended; Toronto publishes no register of who attended.":
      "On the Toronto record, recorded-vote participation is a member's votes cast divided by their votes cast plus their absences. It counts across recorded votes where a vote was theirs to cast. It is the share of recorded votes where the member was present and voting. It counts only recorded votes, the name-by-name kind. It is not a count of meetings attended. Toronto publishes no register of who attended.",
    "Member totals reach back to 2006 — five terms — as aggregates. Individual, name-by-name vote rows are stored from 2018 onward only, so some long-serving members' totals include votes from before the decision archive begins; their item-by-item record starts in 2018.":
      "Member totals reach back to 2006 — five terms — as aggregates. Vote rows with each name are stored from 2018 onward only. So the totals for some long-serving members include votes from before the decision archive begins. Their item-by-item record starts in 2018.",
    "Toronto: the decision archive covers 2018 to 2026 and is current to October 19, 2026. Member totals reach back to 2006, as aggregates, with name-by-name rows from 2018 onward only (see":
      "Toronto: the decision archive covers 2018 to 2026. It is current to October 19, 2026. Member totals reach back to 2006, as aggregates. Rows with names start from 2018 onward only (see",
    "Ontario: every current and earlier MPP — 505 recorded divisions, July 2018 to June 2, 2026 (the 2018–2022 divisions were extracted from the Assembly's House documents; its official searchable record begins in 2022), disclosure statements, 2005–2025, and lobbying registration counts; the full coverage statement is on the":
      "Ontario: every current and earlier MPP — 505 recorded votes, July 2018 to June 2, 2026 (the 2018–2022 votes were taken from the Assembly's House documents; its official searchable record begins in 2022), statements about their interests, 2005–2025, and lobbying registration counts. The full coverage statement is on the",
    ". Canada: every current and earlier MP — 4,856 recorded divisions, registry documents from the ethics commissioner, and 172,864 lobbying communications; the full coverage statement is on the":
      ". Canada: every current and earlier MP — 4,856 recorded votes, registry papers from the ethics commissioner, and 172,864 lobbying contacts. The full coverage statement is on the",
    "). About 51% of decisions are tagged to a specific ward. The rest are citywide decisions — they apply across Toronto — or carry no ward in the record.":
      "). About 51% of decisions are tagged to one ward. The rest cover all of Toronto, or have no ward in the record.",
    "Yes — completely. Every decision, brief and tool is free. There is nothing to buy and no premium tier.":
      "Yes — completely. Every decision, brief and tool is free. There is nothing to buy. There is no premium tier.",
    "No. Deme takes no side: no grades, no rankings, no endorsements, and every member in the same format. Each brief is a plain-language summary of the official record — one tap away on every decision page, so you can check the wording against the source.":
      "No. Deme takes no side. It has no grades, no rankings, and no endorsements. Every member is shown in the same format. Each brief is a plain-language summary of the official record. It is one tap away on every decision page, so you can check the wording against the source.",
    "The published record in plain language, for all three legislatures: 33,795 Toronto council decisions, 505 Ontario divisions (the 2018–2022 divisions were extracted from the Assembly's House documents; its official searchable record begins in 2022) and 4,856 House of Commons divisions, the recorded votes — most with every name on the record, the rest as a recorded tally — your representatives' full histories, what they declared, and, on Toronto profiles, the promises they campaigned on. Set your Toronto ward and Deme shows your area first. When Council alerts launch, email digests of upcoming Council business will go to anyone who signs up for them.":
      "The published record in plain language, for all three legislatures: 33,795 Toronto council decisions, 505 Ontario votes (the 2018–2022 votes were taken from House documents; the official searchable record begins in 2022) and 4,856 House of Commons votes. It has the recorded votes — most with every name on the record, the rest as a recorded tally. It has your representatives' full histories, what they declared, and, on Toronto profiles, the promises they campaigned on. Set your Toronto ward and Deme shows your area first. When Council alerts launch, email digests of upcoming Council business will go to anyone who signs up for them.",
    "Three, today — one for each level of government: Toronto City Council (municipal), the Ontario Legislature (provincial), and the House of Commons (federal). Each has its own directory and record, in the same plain language. Toronto's decision archive runs from 2018 to 2026, with member voting totals across five terms (individual vote rows from 2018 onward).":
      "Three, today — one for each level of government: Toronto City Council (city), the Ontario Legislature (provincial), and the House of Commons (federal). Each has its own directory and record, in the same plain language. Toronto's decision archive runs from 2018 to 2026, with member voting totals across five terms (vote rows for each person from 2018 on).",
    "It's live. Toronto's municipal election was October 26, 2026, and the new Council term begins November 15, 2026. The Toronto record keeps growing with every meeting. The Ontario and Canada records are the archives their directories describe.":
      "It is live. Toronto's city election was October 26, 2026, and the new Council term begins November 15, 2026. The Toronto record keeps growing with every meeting. The Ontario and Canada records are the archives their directories describe.",
    "lists each file — Toronto's archive and the Ontario and Canada member files — what it holds, and how to reuse it — no account, no key.":
      "lists each file — Toronto's archive and the Ontario and Canada member files — what it holds, and how to use it again — no account, no key.",

    /* ----- open data ----- */
    "Deme is built from public records. Every data file this website loads is published at a public address, listed below — no account, no key; the City's data is shared under the City's open licence. One file is the exception: the bulk dataset — every decision card in a single file — is sent by email on request. Email":
      "Deme is built from public records. Every data file this website loads sits at a public address, listed below. There is no account and no key. The City shares its data under the City's open licence. One file is the exception: the bulk dataset — every decision card in one file — is sent by email when you ask. Email",
    "for it.": "for it.",
    "votes actually cast — a Yes or a No — in member totals, back to 2006; individual vote rows stored from 2018":
      "votes that were cast — a Yes or a No — in member totals, back to 2006. Vote rows for each person are kept from 2018",
    "decisions tagged to a ward — 15,541 of them to exactly one ward":
      "decisions tagged to a ward — 15,541 of them to just one ward",
    "What Deme publishes": "What Deme publishes",
    "Every file is JSON, at the public address shown. If a page on this site shows a number, the file behind it is listed here. The bulk dataset is the one exception, requested by email.":
      "Every file is JSON, at the public address shown. If a page on this site shows a number, the file behind it is listed here. The bulk dataset is the one exception. You ask for it by email.",
    "One record per decision: reference (for example 2026.TE31.16), title, date, deciding body, outcome, subject terms, wards touched, plain-language brief, and whether a recorded vote exists.":
      "One record for each decision: its reference (for example 2026.TE31.16), title, date, the body that decided it, the result, subject terms, the wards it touches, the summary in easy words, and whether a recorded vote exists.",
    "One file for each of the 3,171 decisions with a recorded vote: the official summary, what was decided, and every motion on the item with its name-by-name votes and result.":
      "One file for each of the 3,171 decisions with a recorded vote: the official summary, what was decided, and each motion on the item with its votes by name and its result.",
    "The text behind each item — the official summary and the decision — keyed by reference.":
      "The text behind each item — the official summary and the decision — sorted by reference.",
    "Every decision card in a single file — all 33,795 — the index the site's search runs on. We send the bulk file by email — write to us and we'll send the complete file.":
      "Every decision card in one file — all 33,795 — the index the site's search runs on. We send the bulk file by email. Write to us and we will send the complete file.",
    "The most recent City Council decisions, and the latest decisions overall.":
      "The newest City Council decisions, and the newest decisions overall.",
    "City Council items from published agendas that are still upcoming, with the counts from the classification that selected them. Published even when empty — an empty file is the honest state, not a missing one.":
      "City Council items from published agendas that are still to come, with the counts from the sorting that picked them. The file is published even when it is empty. An empty file is the honest state, not a missing one.",
    "All 94 members in the voting record: terms served, votes cast, Yes and No counts, absences, declared interests, and recorded-vote participation as a plain statistic.":
      "All 94 members in the voting record: terms served, votes cast, Yes and No counts, times away, declared interests, and recorded votes they took part in as a plain number.",
    "One file per member: the item-level vote rows from 2018 onward — the item's reference, the vote cast, the stage, the date, the motion, and its result. Members whose service ended before 2018 show totals in Members instead.":
      "One file for each member: the vote rows, item by item, from 2018 on — the item's reference, the vote cast, the stage, the date, the motion, and its result. Members whose service ended before 2018 show totals in Members instead.",
    "The story threads that group decisions by topic: the documented keyword rule behind each thread, and the decisions each rule groups.":
      "The stories that group decisions by topic: the set word rule behind each story, and the decisions each rule groups.",
    "How often each subject term in the City's record appears across the archive.":
      "How often each subject term in the City's record shows up across the archive.",
    "The headline counts quoted across this site, and the record of how the published files were built.":
      "The main counts used across this site, and the record of how the published files were built.",
    "Where the record comes from": "Where the record comes from",
    "How Deme processes it": "How Deme works with it",
    "Each decision's brief is a plain-language summary of the official record —":
      "Each decision's summary is the official record in easy words —",
    "explains how the briefs and the why-it-matters line are written.":
      "explains how the summaries and the why-it-matters line are written.",
    "Most decisions have no recorded vote.": "Most decisions have no recorded vote.",
    "The two archives start in different years.": "The two archives start in different years.",
    "The record belongs to the public. Deme makes it readable.":
      "The record belongs to the public. Deme makes it easy to read.",
    "explains the briefs, the neutrality commitment, and your privacy.":
      "explains the summaries, the promise to take no side, and your privacy.",

    /* ----- reporters / embed / misc pages ----- */
    "Deme is a non-partisan, public record of your elected representatives — Toronto City Council, the Ontario Legislature and the House of Commons — the same decisions and votes each body publishes, in plain language, searchable by topic, by place, and by the person who cast the vote. This page is the data room: coverage, sources, method, and limits. The archive below is Toronto's, where the decision-level record lives; the Ontario and Canada directories carry their own coverage statements.":
      "Deme takes no side. It is a public record of your elected representatives — Toronto City Council, the Ontario Legislature and the House of Commons — the same decisions and votes each body publishes, in easy words. You can search by topic, by place, and by the person who cast the vote. This page is the data room: coverage, sources, method, and limits. The archive below is Toronto's, where the decision-level record lives. The Ontario and Canada directories carry their own coverage statements.",
    "Deme publishes facts only — no grades, no rankings, and no tally of visitors’ positions. Readers, including reporters, draw their own conclusions.":
      "Deme publishes facts only — no grades, no rankings, and no tally of visitors' positions. Readers, reporters too, make up their own minds.",
    "That page isn't in the record.": "That page is not in the record.",
    "The page you're looking for doesn't exist here. The record itself is open:":
      "The page you are looking for is not here. The record itself is open:",
    "Weighing in has moved": "Weighing in has moved",
    "— one personal home for your picks, your ward and your voting card. If you aren't taken there automatically, follow the link.":
      "— one home for your picks, your ward and your voting card. If you are not taken there on your own, follow the link.",
    "Put your ward’s record on your site": "Put your ward's record on your site",
    "Free to use on any site — just keep the “On Deme” credit line on the card as it appears.":
      "Free to use on any site. Just keep the “On Deme” credit line on the card as it appears.",
    "← Back to the record": "← Back to the record",
    "← All representatives": "← All representatives",
    "← Back home": "← Back home",

    /* ----- about / open-data method paragraphs (added after the
       residual audit — the longest explainer blocks) ----- */
    "Before a Toronto City Council vote, you can weigh in — Support or Oppose — on items in the published agenda. Weighing in takes a free account: your pick saves to your account, where only you can see it, so your voting card and notifications follow you on any device. Deme keeps no tally of visitors' positions, does not know how many people picked either side, and never presents visitors' picks as a result. The only results shown are Council's. Your profile — your ward, a watched ward, and your topics — lives in your browser, and on your account when you create one. With an account, your name, email, wards, topics and picks are held on our server, so they can follow you across devices. If you sign up for Council alerts, your email is held on your account so digests can reach you.":
      "Before a Toronto City Council vote, you can weigh in — Support or Oppose — on items in the published agenda. Weighing in takes a free account. Your pick saves to your account, where only you can see it. That way your voting card and notifications follow you on any device. Deme keeps no tally of visitors' positions. It does not know how many people picked either side. It never shows visitors' picks as a result. The only results shown are Council's. Your profile — your ward, a watched ward, and your topics — lives in your browser, and on your account when you create one. With an account, your name, email, wards, topics and picks are held on our server, so they can follow you across devices. If you sign up for Council alerts, your email is held on your account so digests can reach you.",
    "Declared interests are left out of the participation count entirely: stepping back from a vote for a declared interest is a duty, not an absence, and Deme never counts one against a member. The interest count on a member's page counts recorded votes where the member declared an interest and did not vote. It is not the City's official declarations register — a separate record, published on member pages as its own section — and the nature of each interest is not in this data. The breakdown bar uses a wider base — every recorded vote, declared interests included — which is why its cast share can run slightly lower than the participation figure.":
      "Declared interests are left out of the participation count entirely. Stepping back from a vote for a declared interest is a duty, not an absence. Deme never counts one against a member. The interest count on a member's page counts recorded votes where the member declared an interest and did not vote. It is not the City's official declarations register. That register is a separate record. It is published on member pages as its own section. The nature of each interest is not in this data. The breakdown bar uses a wider base — every recorded vote, declared interests included. That is why its cast share can run slightly lower than the participation figure.",
    "Only about 9 in every 100 decisions carries a recorded (name-by-name) vote. For the rest, the public record attaches no member's position; Deme says so rather than guessing. Where a “close vote” is called — in The Record's close-votes view and on the decision tiles — the margin is the vote that decided the item: its final adoption vote at City Council. The closest-calls dataset behind the member-alignment figures measures an item differently on purpose: its margin comes from the item's first City Council-stage recorded vote — its main vote. On an item with several recorded votes, the two margins can differ. The most recent Council meeting in this archive is July 29, 2026. The weigh-in list in My Record shows only City Council items from published agendas — never committee or board business — and only while they are still upcoming.":
      "Only about 9 in every 100 decisions carries a recorded (name-by-name) vote. For the rest, the public record does not show a member's position. Deme says so. It does not guess. Where a “close vote” is called — in The Record's close-votes view and on the decision tiles — the margin is the vote that decided the item: its final adoption vote at City Council. The closest-calls dataset behind the member-alignment figures measures an item in a different way on purpose. Its margin comes from the item's first City Council-stage recorded vote — its main vote. On an item with several recorded votes, the two margins can differ. The most recent Council meeting in this archive is July 29, 2026. The weigh-in list in My Record shows only City Council items from published agendas — never committee or board business — and only while they are still upcoming.",
    "The Toronto archive starts with the City of Toronto's published council records: the agendas, decisions, and voting records the City Clerk posts through TMMIS, the Toronto Meeting Management Information System — the City's official proceedings. Every decision page on Deme links its item's official record in that system. The Ontario and Canada member files listed above come from the Legislative Assembly of Ontario and the House of Commons — the same sources their directories cite.":
      "The Toronto archive starts with the City of Toronto's published council records: the agendas, decisions, and voting records the City Clerk posts through TMMIS, the Toronto Meeting Management Information System. Those posts are the City's official record of what happened. Every decision page on Deme links to its item's official record in that system. The Ontario and Canada member files listed above come from the Legislative Assembly of Ontario and the House of Commons — the same sources their directories name.",
    "in TMMIS. The City publishes no register of who attended its meetings; Deme's participation figure is derived from the voting record, as the method notes below explain. Deme reorganizes the record; it does not originate it. Where Deme and the official record differ, the official record is right.":
      "in TMMIS. The City publishes no register of who attended its meetings. Deme's participation figure comes from the voting record, as the method notes below explain. Deme puts the record in a new order. It does not create it. Where Deme and the official record differ, the official record is right.",
    "Every item keeps the name of the body that decided it: City Council, a community council, a committee, or a board. Of the 33,795 decisions in the archive, 13,158 are City Council's own. The Vote page and the Council alerts carry City Council business only — committee and board items never appear there.":
      "Every item keeps the name of the body that decided it: City Council, a community council, a committee, or a board. Of the 33,795 decisions in the archive, 13,158 are City Council's own. The Vote page and the Council alerts carry City Council business only. Committee and board items never show there.",
    "Story threads group decisions by documented keyword rules over their titles and subject terms — conservatively: when in doubt, a decision is left out. The rules ship inside the threads file, so anyone can check how a thread was built.":
      "Stories group decisions by set word rules on their titles and subject terms. The grouping is careful: if there is doubt, a decision is left out. The rules are inside the threads file, so anyone can check how a story was built.",
    ", and Deme adds no licence and no restrictions of its own. Credit the City of Toronto as the source. The briefs are Deme's summaries — check the official record before you rely on one. To reuse a file, take it from its public address above — the bulk dataset is the one exception: email us for it, and we'll send it.":
      ", and Deme adds no licence and no limits of its own. Credit the City of Toronto as the source. The summaries are Deme's — check the official record before you rely on one. To use a file again, take it from its public address above. The bulk dataset is the one exception: email us for it, and we will send it.",
    "The City's voting record also carries rows for members who were absent — 112,140 of them — and rows where a member declared a personal interest — 119. Neither is a vote. Of 743,677 vote rows in the record, 631,418 are votes actually cast. The 119 are a count of recorded votes flagged “interest declared”, not entries in the City's official declarations register; the nature of each interest is not in this data.":
      "The City's voting record also has rows for members who were absent — 112,140 of them — and rows where a member declared a personal interest — 119. Neither is a vote. Of 743,677 vote rows in the record, 631,418 are votes that were cast. The 119 are a count of recorded votes flagged “interest declared”. They are not entries in the City's official declarations register. The kind of each interest is not in this data.",
    "A member's votes cast divided by their votes cast plus their absences, across recorded votes where a vote was theirs to cast — the share of recorded votes where the member was present and voting. It is not a count of meetings attended; Toronto publishes no register of who attended. Declared interests are left out of the count entirely: stepping back from a vote for a declared interest is a duty, not an absence, and Deme never counts it as one.":
      "A member's votes cast, divided by their votes cast plus the times they were absent. It counts only recorded votes where the member could vote. It is the share of recorded votes where the member was there and voted. It is not a count of meetings they went to. Toronto publishes no register of who attended. Declared interests are left out of the count in full: stepping back from a vote for a declared interest is a duty, not a missed vote, and Deme never counts it as one.",
    "All 190 Ontario members the Ontario directory carries — the 124 current MPPs and 66 earlier members: riding, party, and the record counts behind each profile. One file per member sits beside the index, carrying their divisions, disclosure statements and lobbying counts.":
      "All 190 Ontario members in the Ontario directory — the 124 current MPPs and 66 earlier members: riding, party, and the record counts behind each profile. One file for each member sits beside the index. It carries their votes, disclosure statements and lobbying counts.",
    "All 1,070 Canada members the Canada directory carries — the 337 current MPs and 733 earlier members: riding, province, party, and the record counts behind each profile. One file per member sits beside the index, carrying their divisions, registry documents and lobbying communications.":
      "All 1,070 Canada members in the Canada directory — the 337 current MPs and 733 earlier members: riding, province, party, and the record counts behind each profile. One file for each member sits beside the index. It carries their votes, registry papers and lobbying contacts.",
    "A name-by-name vote exists only where the City recorded one — for 3,171 of 33,795 decisions, about 9 in every 100. For the rest, the public record attaches no member's position, and Deme says so rather than guessing.":
      "A vote with names exists only where the City recorded one — for 3,171 of 33,795 decisions, about 9 in every 100. For the rest, the public record does not show how each member voted, and Deme says so. It does not guess.",
    "The decision archive runs 2018–2026. Member totals reach back to 2006, five terms, as aggregates; individual, name-by-name vote rows are stored from 2018 onward only. Some long-serving members' totals include votes from before 2018; their item-by-item record starts in 2018.":
      "The decision archive runs 2018–2026. Member totals go back to 2006, five terms, as totals. Vote rows with names for each person are kept from 2018 on only. The totals for some long-serving members include votes from before 2018. Their record, item by item, starts in 2018.",
    "The archive is current to October 19, 2026; the most recent Council meeting in it is July 29, 2026. A new Council term begins in November 2026; its decisions and votes will be added as the new Council meets and the City publishes its record.":
      "The archive is up to date to October 19, 2026. The newest Council meeting in it is July 29, 2026. A new Council term begins in November 2026. Its decisions and votes will be added as the new Council meets and the City publishes its record.",
    "The map behind the postal-code ward finder: each Toronto FSA — the first three characters of a postal code — and the ward or wards it touches, with a street or landmark cue for each. Built from the City of Toronto's ward boundaries and Statistics Canada's 2021 census FSA boundary file.":
      "The map behind the postal-code ward finder: each Toronto FSA — the first three characters of a postal code — and the ward or wards it touches, with a street or landmark hint for each. Built from the City of Toronto's ward boundaries and Statistics Canada's 2021 census FSA boundary file.",
    "— weigh in on what's coming up at Council, decision by decision.":
      "— say what you think about what is coming up at Council, one decision at a time.",
    "— your ward, your topics and your watched items, gathered on this page.":
      "— your ward, your topics and the items you watch, all gathered on this page.",
  };

  /* Attribute strings (placeholder / aria-label / title). */
  const SIMPLE_ATTRS = {
    "Search decisions, topics, names, ridings…": "Search decisions, topics, names, ridings…",
    "Find a representative by name or postal code": "Find a representative by name or postal code",
    "Search earlier members": "Search earlier members",
  };

  const SKIP = "script, style, textarea, [data-no-simple],"
    + " .history-rows, .split-row, .related-list, .record-card-doc, #print-card";
  /* The decision page's name-by-name vote table is record data and is
     never translated; it is the <table class="record"> inside
     #votezone. (The Open Data catalogue table also carries
     class="record" but holds Deme's own descriptions — it IS
     translated, so the skip must be scoped to the vote zone.) */
  const inVoteTable = (el) => Boolean(el && el.closest
    && el.closest("table.record") && el.closest("#votezone"));

  const originals = new WeakMap(); /* text node -> original data */
  const attrOriginals = new WeakMap(); /* element -> {attr: original} */

  function translateNode(node) {
    const key = norm(node.data);
    if (!key || !Object.prototype.hasOwnProperty.call(SIMPLE_TEXT, key)) return;
    const simple = SIMPLE_TEXT[key];
    if (norm(simple) === key) return;
    if (!originals.has(node)) originals.set(node, node.data);
    /* Preserve the node's own boundary whitespace: keys and values are
       trimmed, but the space a text node carries next to an inline
       element (a link, <em>, <strong>) is what keeps the words apart
       in the rendering. Dropping it merged words at inline boundaries
       ("see" + link -> "seeAbout") — Gate D visitor-eye, Oct 23. */
    const lead = node.data.match(/^\s*/)[0];
    const trail = node.data.match(/\s*$/)[0];
    node.data = lead + simple + trail;
  }
  function restoreNode(node) {
    if (originals.has(node)) { node.data = originals.get(node); originals.delete(node); }
  }
  function walk(root, fn) {
    if (!root) return;
    if (root.nodeType === 3) { fn(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.closest
        && (root.closest(SKIP) || inVoteTable(root))) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        return n.parentElement
          && (n.parentElement.closest(SKIP) || inVoteTable(n.parentElement))
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(fn);
    if (root.querySelectorAll) {
      root.querySelectorAll("[placeholder], [aria-label], [title]").forEach((el) => {
        if (el.closest(SKIP) || inVoteTable(el)) return;
        ["placeholder", "aria-label", "title"].forEach((attr) => {
          const v = el.getAttribute(attr);
          if (v == null) return;
          const k = norm(v);
          if (!Object.prototype.hasOwnProperty.call(SIMPLE_ATTRS, k)) return;
          if (on) {
            let rec = attrOriginals.get(el);
            if (!rec) { rec = {}; attrOriginals.set(el, rec); }
            if (!(attr in rec)) rec[attr] = v;
            el.setAttribute(attr, SIMPLE_ATTRS[k]);
          }
        });
      });
    }
  }
  function applyAll(root) {
    if (!on) return;
    applying = true;
    walk(root || document.body || document, translateNode);
    applying = false;
  }
  function restoreAll() {
    applying = true;
    walk(document.body || document, restoreNode);
    document.querySelectorAll("[placeholder], [aria-label], [title]").forEach((el) => {
      const rec = attrOriginals.get(el);
      if (!rec) return;
      Object.keys(rec).forEach((attr) => el.setAttribute(attr, rec[attr]));
      attrOriginals.delete(el);
    });
    applying = false;
  }

  function reflect() {
    document.documentElement.dataset.simple = on ? "on" : "off";
    document.documentElement.classList.toggle("simple-on", on);
    document.querySelectorAll(".simple-mode-toggle").forEach((b) => {
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function setPreference(next, opts = {}) {
    on = Boolean(next);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
    reflect();
    if (on) applyAll(); else restoreAll();
    /* Re-render chrome so header/footer strings pick the mode's wording
       at the source, not only through the text-node pass. */
    if (typeof window.renderChrome === "function"
        && window.__demeChromeActive !== undefined) {
      window.renderChrome(window.__demeChromeActive);
      reflect();
      if (on) applyAll();
    }
    if (!opts.silent) {
      document.dispatchEvent(new CustomEvent("deme:simple-changed", {
        detail: { on, source: opts.fromAccount ? "account" : "device" },
      }));
    }
  }

  /* Renderer hook for built strings: t(normal) looks the pair up in
     the table; t(normal, simple) uses the explicit pair. Numbers and
     names are interpolated by the caller, identically in both modes. */
  function t(normal, simple) {
    if (!on) return normal;
    if (simple !== undefined) return simple;
    const k = norm(normal);
    return Object.prototype.hasOwnProperty.call(SIMPLE_TEXT, k)
      ? SIMPLE_TEXT[k] : normal;
  }

  /* Fact-safe brief transform for decision CARDS: currency expansion
     only. "$2.77M" -> "$2.77 million"; "$8.7M USD" -> "$8.7 million US";
     "$1.2B" -> "$1.2 billion"; "approx." -> "about". Nothing else —
     no word swaps, no sentence surgery on record summaries. */
  function simplifyBrief(brief) {
    if (!brief) return brief;
    return String(brief)
      .replace(/\$\s?([\d,]+(?:\.\d+)?)\s?M\b(\s+USD)?/g,
        (m, v, usd) => `$${v} million${usd ? " US" : ""}`)
      .replace(/\$\s?([\d,]+(?:\.\d+)?)\s?B\b/g, (m, v) => `$${v} billion`)
      .replace(/\bapprox\./gi, "about");
  }

  function startObserver() {
    if (observer || typeof MutationObserver !== "function") return;
    observer = new MutationObserver((muts) => {
      if (!on || applying) return;
      applying = true;
      muts.forEach((m) => {
        m.addedNodes.forEach((n) => walk(n, translateNode));
        if (m.type === "characterData") translateNode(m.target);
      });
      applying = false;
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
  }

  /* The header toggle itself is rendered by renderChrome (common.js);
     this wires any toggle present now or rendered later. */
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest
      ? e.target.closest(".simple-mode-toggle") : null;
    if (btn) setPreference(!on);
  });

  reflect();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { applyAll(); startObserver(); });
  } else { applyAll(); startObserver(); }

  return {
    isOn: () => on,
    getPreference: () => on,
    setPreference,
    t, norm, simplifyBrief,
    strings: SIMPLE_TEXT, attrs: SIMPLE_ATTRS,
    applyAll,
  };
})();
