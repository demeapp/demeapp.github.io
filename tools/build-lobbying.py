#!/usr/bin/env python3
"""Build the lobbying data layer for the site from the QA-passed PUBLIC
exports of the lobbying pipeline (and only those — private exports never
enter this repo).

    python3 tools/build-lobbying.py [--exports DIR]

Writes:
  - data/lobbying.json          (lazy-loaded by the app on profile/item views)
  - councillors/*/index.html    ("Lobbying contacts on the record" card,
                                 marker-wrapped, idempotent)
  - items/*/index.html          (topic-area section, only for items whose
                                 reference appears in item_topic_lobbying.csv)
  - methodology-lobbying.html   (the public methodology page)
  - sitemap.xml                 (adds the methodology URL if missing)

Source semantics (from the pipeline, verified):
  - footprint totals count every member-directed communication in the
    registry, dated or not. `by_year` counts only communications with a
    usable date, so year bars can sum to less than the headline total;
    the difference is surfaced on the page as "filings without a usable
    date", never hidden.
  - Item topic counts are topic-area matches only. Lobbyists name subject
    categories, not agenda items; the label "(topic match — not specific
    to this item)" travels with the number everywhere it appears.
Fails loudly (exit 1) if the exports drift from the pinned spot-checks.
"""
import csv, json, os, sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB_DEFAULT = ("~/workspace/goals/ourvote-civic-engagement-app/data-pool/"
               "lobbying/exports/2026-10-08/public")
START = "<!-- deme-lobbying:start -->"
END = "<!-- deme-lobbying:end -->"
SRC_LINE = ("Source: City of Toronto Open Data \u2014 Lobbyist Registry, snapshot "
            "October 8, 2026. As filed by lobbyists and published by the City "
            "as received; not verified by Deme.")
METHOD_LINK_APP = ('<a href="methodology-lobbying.html" '
                   'title="How Deme counts lobbying contact: what the registry '
                   'is, how names are matched, and what this record cannot '
                   'tell you.">How we count this</a>')
METHOD_LINK_STATIC = METHOD_LINK_APP.replace('href="methodology',
                                             'href="../methodology')


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def fail(msg):
    print("BUILD-LOBBYING FAILED: " + msg, file=sys.stderr)
    sys.exit(1)


def esc(t):
    return (str(t).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def fmt(n):
    return f"{int(n):,}"


def main():
    pub = os.path.expanduser(sys.argv[sys.argv.index("--exports") + 1]
                             if "--exports" in sys.argv else PUB_DEFAULT)
    for need in ("member_lobbying_footprint.csv", "member_lobbying_by_year.csv",
                 "member_lobbying_top_categories.csv", "item_topic_lobbying.csv",
                 "METHODOLOGY.md"):
        if not os.path.exists(os.path.join(pub, need)):
            fail(f"missing public export: {need}")

    foot = {r["member"]: r for r in read_csv(os.path.join(pub, "member_lobbying_footprint.csv"))}
    years = {}
    for r in read_csv(os.path.join(pub, "member_lobbying_by_year.csv")):
        years.setdefault(r["member"], []).append([int(r["year"]), int(r["communications"])])
    tops = {}
    for r in read_csv(os.path.join(pub, "member_lobbying_top_categories.csv")):
        if int(r["rank"]) <= 5:
            tops.setdefault(r["member"], []).append(
                (int(r["rank"]), r["subject_category"], int(r["communications"])))
    item_topics = {}
    for r in read_csv(os.path.join(pub, "item_topic_lobbying.csv")):
        item_topics[r["reference"]] = {
            "topic": r["topic_area"],
            "n": int(r["term_member_directed_comms_in_topic_area"]),
        }

    # ---- pinned spot-checks (export drift guard) ----
    th = foot.get("Michael Thompson")
    if not th or (int(th["communications_total"]), int(th["communications_current_term"]),
                  int(th["distinct_lobbyists"]), int(th["distinct_clients"])) != (1579, 195, 428, 295):
        fail("Michael Thompson footprint drifted from pinned 1579/195/428/295")
    te = item_topics.get("2026.TE34.21")
    if not te or te != {"topic": "Planning & development", "n": 3593}:
        fail("2026.TE34.21 topic row drifted from pinned Planning & development / 3593")
    if len(foot) != 94:
        fail(f"expected 94 footprint members, found {len(foot)}")
    for m, r in foot.items():
        meth = [int(r[k]) for k in ("method_meetings", "method_emails", "method_telephone",
                                    "method_written", "method_other_or_unreported")]
        if sum(meth) != int(r["communications_total"]):
            fail(f"method split does not sum to total for {m}")
        if [c for _, c, _ in sorted(tops.get(m, []))] and len(tops.get(m, [])) > 5:
            fail(f"more than 5 top categories for {m}")

    # ---- data/lobbying.json ----
    members = {}
    for m, r in sorted(foot.items()):
        yrs = sorted(years.get(m, []))
        dated = sum(n for _, n in yrs)
        members[m] = {
            "t": int(r["communications_total"]),
            "term": int(r["communications_current_term"]),
            "f": r["communications_first"] or None,
            "l": r["communications_last"] or None,
            "lob": int(r["distinct_lobbyists"]),
            "cli": int(r["distinct_clients"]),
            "meth": [int(r[k]) for k in ("method_meetings", "method_emails",
                                         "method_telephone", "method_written",
                                         "method_other_or_unreported")],
            "top": [[c, n] for _, c, n in sorted(tops.get(m, []))],
            "yrs": yrs,
            "undated": int(r["communications_total"]) - dated,
        }
    payload = {
        "meta": {
            "snapshot": "2026-10-08",
            "source": "City of Toronto Open Data \u2014 Lobbyist Registry",
            "sourceUrl": "https://open.toronto.ca/dataset/lobbyist-registry/",
            "note": "As filed by lobbyists in the City registry; self-reported and unedited by the City.",
            "methodology": "methodology-lobbying.html",
        },
        "m": members,
        "i": item_topics,
    }
    out = os.path.join(SITE, "data", "lobbying.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"data/lobbying.json: {os.path.getsize(out):,} bytes, "
          f"{len(members)} members, {len(item_topics)} item topic rows")

    # ---- static councillor cards ----
    def panel_static(m):
        d = members[m]
        if d["t"] == 0:
            body = ('<p class="note">No reported contacts naming this member '
                    'appear in the registry for 2010\u20132026.</p>')
        else:
            yr_span = f'{d["f"][:4]}\u2013{d["l"][:4]}' if d["f"] and d["l"] else "2010\u20132026"
            meth = d["meth"]
            top_txt = "; ".join(f"{esc(c)} ({fmt(n)})" for c, n in d["top"])
            yrs_txt = " \u00b7 ".join(f"{y}: {fmt(n)}" for y, n in d["yrs"])
            undated = (f'<p class="note">{fmt(d["undated"])} filings carry no usable date; '
                       f'they count in the total but are not placed by year.</p>'
                       if d["undated"] else "")
            body = (
                f'<p class="big">{fmt(d["t"])}</p>'
                f'<p class="note">reported contacts naming this member, {yr_span} \u00b7 '
                f'{fmt(d["term"])} this term (since November 15, 2022) \u00b7 '
                f'{fmt(d["lob"])} different lobbyists \u00b7 {fmt(d["cli"])} different clients named.</p>'
                f'<p class="note">Meetings {fmt(meth[0])} \u00b7 E-mails {fmt(meth[1])} \u00b7 '
                f'Telephone {fmt(meth[2])} \u00b7 Written {fmt(meth[3])} \u00b7 '
                f'Other or not stated {fmt(meth[4])}</p>'
                f'<p class="note"><strong>Top subjects the lobbyists filed under:</strong> {top_txt}</p>'
                f'<p class="note"><strong>Contacts by year:</strong> {yrs_txt}</p>'
                f'{undated}'
            )
        return (f'{START}\n<div class="card"><p class="kicker">Lobbying contacts '
                f'on the record</p>{body}'
                f'<p class="note">{SRC_LINE} {METHOD_LINK_STATIC}</p></div>\n{END}')

    import re
    n_c = 0
    for slug in sorted(os.listdir(os.path.join(SITE, "councillors"))):
        page = os.path.join(SITE, "councillors", slug, "index.html")
        if not os.path.exists(page):
            continue
        html = open(page, encoding="utf-8").read()
        h1 = re.search(r"<h1>(.*?)</h1>", html)
        if not h1 or h1.group(1) not in members:
            fail(f"councillor page without footprint member: {slug} ({h1.group(1) if h1 else '?'})")
        block = panel_static(h1.group(1))
        if START in html:
            html = re.sub(re.escape(START) + r".*?" + re.escape(END), block, html, flags=re.S)
        else:
            anchor = "<h2>Most recent recorded votes</h2>"
            if anchor not in html:
                anchor = '<p><a class="cta"'  # pre-2018 profiles have no vote table
            if anchor not in html:
                fail(f"anchor missing in {page}")
            html = html.replace(anchor, block + "\n" + anchor, 1)
        open(page, "w", encoding="utf-8").write(html)
        n_c += 1
    print(f"councillor pages updated: {n_c}")

    # ---- static item sections ----
    def item_section_static(d):
        return (f'{START}\n<h2>Lobbying in this item\u2019s topic area</h2>'
                f'<div class="card"><p>Registered lobbying communications in this '
                f'item\u2019s topic area (<strong>{esc(d["topic"])}</strong>) this term: '
                f'<strong>{fmt(d["n"])}</strong> '
                f'<span class="note">(topic match \u2014 not specific to this item)</span></p>'
                f'<p class="note">Counted from the subject categories lobbyists filed '
                f'under, matched to this item\u2019s topic area; communications directed '
                f'to Members of Council since November 15, 2022. Lobbyists name subject '
                f'categories, not agenda items, so this count is about the topic area \u2014 '
                f'not about this item.</p>'
                f'<p class="note">{SRC_LINE} {METHOD_LINK_STATIC}</p></div>\n{END}')

    n_i = 0
    for slug in sorted(os.listdir(os.path.join(SITE, "items"))):
        page = os.path.join(SITE, "items", slug, "index.html")
        if not os.path.exists(page):
            continue
        html = open(page, encoding="utf-8").read()
        ref_m = re.search(r"<title>([0-9]{4}\.[A-Z]{2,4}[0-9]+\.[0-9]+)", html)
        if not ref_m:
            continue
        ref = ref_m.group(1)
        d = item_topics.get(ref)
        if START in html:
            if d:
                html = re.sub(re.escape(START) + r".*?" + re.escape(END),
                              item_section_static(d), html, flags=re.S)
            else:
                html = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n?", "", html, flags=re.S)
                open(page, "w", encoding="utf-8").write(html)
            continue
        if not d:
            continue
        anchor = '<p><a class="cta"'
        if anchor not in html:
            fail(f"CTA anchor missing in {page}")
        html = html.replace(anchor, item_section_static(d) + "\n" + anchor, 1)
        open(page, "w", encoding="utf-8").write(html)
        n_i += 1
    print(f"item pages given a topic section: {n_i}")

    # ---- methodology page ----
    write_methodology()
    print("methodology-lobbying.html written")

    # ---- sitemap ----
    sm_path = os.path.join(SITE, "sitemap.xml")
    sm = open(sm_path, encoding="utf-8").read()
    loc = "<loc>https://demeapp.github.io/methodology-lobbying.html</loc>"
    if loc not in sm:
        home = "<url><loc>https://demeapp.github.io/</loc><lastmod>2026-10-09</lastmod></url>\n"
        if home not in sm:
            fail("sitemap home entry not found")
        sm = sm.replace(home, home + f"<url>{loc}<lastmod>2026-10-09</lastmod></url>\n", 1)
        open(sm_path, "w", encoding="utf-8").write(sm)
        print("sitemap: methodology URL added")
    else:
        print("sitemap: methodology URL already present")


def write_methodology():
    css = (":root{--marble:#F6F1E7;--bronze:#B08A4A;--deep:#7C5F1E;--navy:#101E38;"
           "--ink:#1D1A15;--muted:#5E5647;--line:#DCD2BC;--surface:#FDFBF5}"
           "*{box-sizing:border-box}body{margin:0;background:var(--marble);color:var(--ink);"
           "font-family:Inter,system-ui,sans-serif;line-height:1.55}"
           ".wrap{width:min(860px,calc(100% - 40px));margin:0 auto;padding:36px 0 56px}"
           "h1,h2{font-family:Fraunces,Georgia,serif;color:var(--navy);line-height:1.1;margin:0}"
           "h1{font-size:clamp(2rem,5vw,3.2rem);letter-spacing:-.02em}"
           "h2{font-size:1.35rem;margin:34px 0 10px}"
           "a{color:var(--deep);font-weight:650}"
           ".kicker{font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;"
           "font-weight:800;color:var(--deep);margin:0 0 10px}"
           ".ward{font-size:1.08rem;color:var(--muted);margin:10px 0 0}"
           ".card{background:var(--surface);border:1px solid var(--line);border-radius:12px;"
           "padding:20px 22px;margin-top:22px}.card p{margin:6px 0}"
           ".note{font-size:.9rem;color:var(--muted)}"
           "ul{margin:8px 0;padding-left:22px}li{margin:5px 0}"
           "footer{margin-top:44px;padding-top:18px;border-top:2px solid var(--navy);"
           "color:var(--muted);font-size:.85rem}"
           ".brand{font-family:Fraunces,Georgia,serif;font-weight:700;color:var(--navy);font-size:1.05rem}"
           ".cta{display:inline-block;background:var(--bronze);color:#0A1424;font-weight:800;"
           "padding:12px 18px;border-radius:5px;text-decoration:none;margin-top:14px}")
    body = """<p class="kicker">Deme — our data</p>
<h1>How we count lobbying contact</h1>
<p class="ward">The Toronto Lobbyist Registry, read plainly. Registry snapshot: October 8, 2026.</p>

<h2>What this is</h2>
<p>Toronto keeps a public record of lobbying. When a lobbyist contacts a city office holder about a subject, they must report it: who they contacted, who they work for, what the subject was, when, and how (meeting, e-mail, phone, in writing). The reports are gathered in the <a href="https://open.toronto.ca/dataset/lobbyist-registry/" target="_blank" rel="noopener">Toronto Lobbyist Registry</a>, published by the City as open data.</p>
<p>Deme reads that public record and places it beside the voting record, so you can see two facts side by side: <strong>the recorded contact</strong> and <strong>the recorded vote</strong>. We report the record. We never make the call about what it means.</p>

<h2>What we count</h2>
<p>The counts beside a councillor's name are reported contacts where the registry names that Member of Council directly: meetings, e-mails, phone calls, and written messages filed by lobbyists with the City.</p>
<ul>
<li><strong>Total contacts</strong> — every reported contact found in the registry for that member, from 2010 to the snapshot date.</li>
<li><strong>Contacts this term</strong> — the same count since the current council term began on November 15, 2022.</li>
<li><strong>Lobbyists / clients</strong> — how many different lobbyists, and how many different clients they said they were acting for, appear in those reports.</li>
<li><strong>Top subjects</strong> — the subject categories the lobbyists themselves chose when they filed.</li>
<li><strong>Contacts by year</strong> — dated filings placed by year. A filing with no usable date counts in the total but is not placed by year; the panel says how many those are wherever it happens.</li>
</ul>

<h2>How we match names</h2>
<p>The registry names the office holder in each report. We match that name to the member in the voting record in exactly two ways: the name matches as written, or it is a spelling variant we verified against the member's term and ward and listed in our public alias table (Adrian Heaps / A.A. Heaps; Justin Di Ciano / Justin J. Di Ciano). We never guess at a similar name.</p>
<p>If a name in the registry has no recorded votes in our voting record, we don't publish a count for it — we log it and say so in our data notes.</p>

<h2>Contacts with staff</h2>
<p>About 39,000 reports name a member's staff rather than the member. We do <strong>not</strong> add those to any member's count. The registry labels staff contacts by office, and many of those office labels use the ward map from before 2018, when Toronto's wards were redrawn. Attributing them to today's member would be a guess, so we keep them as office-level counts only — and show them nowhere on a member's page.</p>

<h2>Topic areas on agenda items</h2>
<p>Near an agenda item you may see: <em>"Registered lobbying communications in this item's topic area this term: N (topic match — not specific to this item)."</em> That number needs its label:</p>
<ul>
<li>We group both registry subjects and council items into plain topic areas (for example, Planning &amp; development) using the published subject wording.</li>
<li>The count is every reported contact to a Member of Council in that topic area since November 15, 2022 — the same broad topic, <strong>not</strong> contact about that specific item. Lobbyists name subject categories, not agenda items (in this snapshot, no in-window filing names a specific item), so a topic match is the most that can honestly be said.</li>
<li>Items whose topic is not clear from their published title and subject terms don't show a count at all.</li>
</ul>

<h2>What this record cannot tell you</h2>
<ul>
<li><strong>What any lobbyist was paid.</strong> Toronto's registry records no fees, retainers, or charges of any kind; it records who contacted whom, for whom, about what — never a dollar amount. No dataset we use can answer what anyone was paid.</li>
<li><strong>Whether a contact changed a vote.</strong> Contact is constant around active files. As a check, we measured: 33.2% of dated contacts were followed within 90 days by a same-topic vote from the same member — and 30.4% were preceded by one. Timing on its own shows that contact happened, nothing more, which is why we show votes and contacts separately and never draw an arrow between them.</li>
<li><strong>Who lobbied about one specific agenda item.</strong> Filings name subject categories, not agenda items, so item pages show topic-area counts only — labelled as topic matches, never as contact about that item.</li>
<li><strong>Anything from the 2022 election's contribution filings.</strong> Those exist only as scanned statements and are not in this data; the contribution figures described below are 2018 only.</li>
</ul>

<h2>Campaign contributions (2018)</h2>
<p>The contribution figures Deme works from come from the City's 2018 election contribution records. Only contributions over $100 are disclosed. The City publishes postal codes for individual donors, not street addresses, and so neither do we: any public view shows candidate totals and donor counts only, never a list of individual donors. People who donated in 2018 and people registered as lobbyists are <strong>not</strong> matched to each other on the public record — a shared name is not proof of a shared person.</p>

<h2>Accuracy</h2>
<ul>
<li>Registry reports are filed by lobbyists and published by the City as received, unedited; late and mistaken filings exist. Counts are "as filed", and every figure carries its source, its snapshot date, and this note: <em>Toronto Lobbyist Registry communications filed with the City (snapshot Oct 8, 2026), as filed / self-reported, not verified by Deme.</em></li>
<li>Before any export is produced, an independent check re-derives every headline number from the raw City files a second way and compares. If the two do not agree, the export is blocked and the failure is written down, not smoothed over.</li>
<li>Found an error? Corrections are part of the record: we fix the number, note the fix, and keep the source line attached.</li>
</ul>
<p><a class="cta" href="https://demeapp.github.io/#record">See the record in the Deme app</a></p>"""
    html = f"""<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>How we count lobbying contact | Deme</title>
<meta name="description" content="How Deme counts lobbying contact from the Toronto Lobbyist Registry: what is counted, how names are matched, and what the record cannot tell you." />
<link rel="canonical" href="https://demeapp.github.io/methodology-lobbying.html" />
<meta property="og:title" content="How we count lobbying contact | Deme" />
<meta property="og:description" content="How Deme counts lobbying contact from the Toronto Lobbyist Registry: what is counted, how names are matched, and what the record cannot tell you." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://demeapp.github.io/methodology-lobbying.html" />
<meta property="og:image" content="https://demeapp.github.io/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
{css}
</style>
<script type="application/ld+json">{{"@context": "https://schema.org", "@type": "WebPage", "name": "How we count lobbying contact | Deme", "url": "https://demeapp.github.io/methodology-lobbying.html", "isPartOf": {{"@id": "https://demeapp.github.io/#website"}}}}</script>
</head>
<body>
<main class="wrap">
{body}
<footer>
<p><span class="brand">Deme</span> — Where the people meet the vote.</p>
<p>Contact: <a href="mailto:demecivic@gmail.com">demecivic@gmail.com</a> · Source: City of Toronto Open Data — Lobbyist Registry (snapshot October 8, 2026), as filed / self-reported, not verified by Deme.</p>
<p><a href="https://demeapp.github.io/">Back to Deme</a></p>
</footer>
</main>
</body>
</html>
"""
    with open(os.path.join(SITE, "methodology-lobbying.html"), "w", encoding="utf-8") as fh:
        fh.write(html)


if __name__ == "__main__":
    main()
