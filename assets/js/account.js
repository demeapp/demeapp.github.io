/* Deme accounts — staged behind DEME_SUPABASE_URL / DEME_SUPABASE_ANON_KEY
   in common.js, the same constant pattern as the Council alerts form.

   While the constants are empty (the shipped state), this file renders
   one honest panel — "accounts open soon" — and changes nothing else:
   the local, no-account profile in VoteStore remains the whole
   product, complete and first-class. Signing up, once activated, is
   an upgrade (profile sync across devices + one alerts identity),
   never a gate: every feature works signed out.

   Design rules that hold at activation:
   - Passwords go only to the auth provider's HTTPS endpoint. No Deme
     code stores them, logs them, or sends them anywhere else.
   - The account profile is: name, email, postal FSA (first 3 chars
     only — the same rule as the ward finder), primary ward, watched
     ward, interests, alerts opt-in. Picks are NOT in the account
     payload and never leave the device; there is deliberately no
     field anywhere that could total visitors' picks — the no-tally
     rule is permanent, accounts or not.
   - Data access is enforced by Postgres row-level security (each row
     readable/writable only by its owner); the anon key shipped here
     is a public client key by design.
   Provider setup (schema, RLS, project steps): WARD-FINDER-REPORT.md. */
"use strict";

const DemeAccount = (() => {
  const enabled = () => Boolean(DEME_SUPABASE_URL && DEME_SUPABASE_ANON_KEY);
  const SESSION_KEY = "deme.account.v1";
  const PENDING_KEY = "deme.account.pending";
  const zone = document.getElementById("account-zone");
  let session = null;         /* {access_token, refresh_token, expires_at, user} */
  let accountProfile = null;  /* row from public.profiles */
  let people = [];
  let threadLabels = {};
  let lastSyncedStamp = null; /* profileUpdatedAt last pushed to the server */
  let booted = false;

  /* ---------------- session storage ---------------- */
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.access_token && s.user) return s;
      }
    } catch (e) { /* treat as signed out */ }
    return null;
  }
  function saveSession() {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  /* ---------------- provider API (REST, no library) ---------------- */
  async function api(path, opts = {}, auth = true) {
    const headers = {
      "apikey": DEME_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };
    if (auth && session) headers["Authorization"] = `Bearer ${session.access_token}`;
    else if (auth === "anon") headers["Authorization"] = `Bearer ${DEME_SUPABASE_ANON_KEY}`;
    const res = await fetch(`${DEME_SUPABASE_URL}${path}`, { ...opts, headers });
    return res;
  }
  async function apiJSON(path, opts = {}, auth = true) {
    const res = await api(path, opts, auth);
    let body = null;
    try { body = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const msg = (body && (body.msg || body.message || body.error_description
        || body.error)) || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }
  function adoptSession(data, fallbackUser) {
    if (!data || !data.access_token) return false;
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      user: data.user || fallbackUser,
    };
    saveSession();
    return true;
  }
  async function refreshSession() {
    if (!session || !session.refresh_token) return false;
    try {
      const data = await apiJSON("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      }, "anon");
      return adoptSession(data, session.user);
    } catch (e) { return false; }
  }
  async function authedJSON(path, opts = {}) {
    if (session && session.expires_at < Date.now() + 30000) {
      await refreshSession();
    }
    try {
      return await apiJSON(path, opts, true);
    } catch (e) {
      if (e.status === 401 && await refreshSession()) {
        return apiJSON(path, opts, true);
      }
      throw e;
    }
  }

  /* ---------------- profile mapping ---------------- */
  function localPayload() {
    return {
      ward: VoteStore.getWard(),
      watch_ward: VoteStore.getWatchWard(),
      interests: VoteStore.getInterests(),
    };
  }
  function applyToLocal(row) {
    if (row.ward !== VoteStore.getWard()) VoteStore.setWard(row.ward ?? null);
    if (row.watch_ward !== VoteStore.getWatchWard()) {
      VoteStore.setWatchWard(row.watch_ward ?? null);
    }
    const ints = Array.isArray(row.interests) ? row.interests : [];
    if (JSON.stringify(ints) !== JSON.stringify(VoteStore.getInterests())) {
      VoteStore.setInterests(ints);
    }
  }
  async function fetchRow() {
    const rows = await authedJSON(
      `/rest/v1/profiles?user_id=eq.${encodeURIComponent(session.user.id)}&select=*`);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  async function upsertRow(fields) {
    const row = {
      user_id: session.user.id,
      email: session.user.email,
      updated_at: new Date().toISOString(),
      ...fields,
    };
    const rows = await authedJSON("/rest/v1/profiles", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    accountProfile = Array.isArray(rows) && rows.length ? rows[0] : row;
    lastSyncedStamp = VoteStore.exportAll().profileUpdatedAt;
    return accountProfile;
  }

  /* On sign-in: the newer of (server row, this device's profile)
     wins, and the loser is updated to match. With no row yet, the
     account is seeded from the sign-up details + this device. */
  async function bootstrapProfile() {
    const row = await fetchRow();
    const localStamp = VoteStore.exportAll().profileUpdatedAt;
    if (row) {
      accountProfile = row;
      const rowStamp = row.updated_at || "";
      if (!localStamp || rowStamp >= localStamp) {
        applyToLocal(row);
        lastSyncedStamp = VoteStore.exportAll().profileUpdatedAt;
      } else {
        await upsertRow({
          name: row.name || pendingName(),
          fsa: row.fsa || pendingFsa(),
          alerts_opt_in: Boolean(row.alerts_opt_in),
          ...localPayload(),
        });
      }
      return;
    }
    let ward = VoteStore.getWard();
    const fsa = pendingFsa();
    if (ward == null && fsa) {
      try {
        const wards = await WardFinder.wardsFor(fsa);
        if (wards && wards.length === 1) ward = wards[0];
      } catch (e) { /* ward stays unset; the editor offers the finder */ }
    }
    await upsertRow({
      name: pendingName(),
      fsa,
      alerts_opt_in: pendingAlerts(),
      alerts_consent_at: pendingAlerts() ? new Date().toISOString() : null,
      ward,
      watch_ward: VoteStore.getWatchWard(),
      interests: VoteStore.getInterests(),
    });
    if (ward !== VoteStore.getWard()) VoteStore.setWard(ward);
    try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
  }
  function pending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || {}; }
    catch (e) { return {}; }
  }
  const pendingName = () => pending().name || (accountProfile && accountProfile.name) || "";
  const pendingFsa = () => pending().fsa || (accountProfile && accountProfile.fsa) || null;
  const pendingAlerts = () => Boolean(pending().alerts_opt_in);

  /* Push local profile edits up while signed in (wards / interests
     changed in the editors below). Name, FSA and the alerts opt-in
     are account-side fields and are preserved from the row. */
  async function syncFromLocal() {
    if (!session || !accountProfile) return;
    const stamp = VoteStore.exportAll().profileUpdatedAt;
    if (!stamp || stamp === lastSyncedStamp) return;
    try {
      await upsertRow({
        name: accountProfile.name || "",
        fsa: accountProfile.fsa || null,
        alerts_opt_in: Boolean(accountProfile.alerts_opt_in),
        ...localPayload(),
      });
      refreshSyncLine();
    } catch (e) { /* next tick retries */ }
  }

  /* ---------------- rendering ---------------- */
  function renderDisabled() {
    if (!zone) return;
    zone.innerHTML = `<div class="card record-card account-card">
      <p class="kicker">Accounts</p>
      <h2 style="font-size:1.25rem">Your Deme account — opening soon</h2>
      <p>Soon you'll be able to create a free Deme account with your
      name and email, so your ward, your watched ward and your topics
      follow you across devices, and your Council alerts live in one
      place.</p>
      <p class="small" style="margin:0">Nothing is missing today: Your
      Deme on this page already works in full, on this device, with no
      account at all. An account will be an upgrade — never a
      requirement.</p>
    </div>`;
  }

  function errLine(el, msg) {
    el.innerHTML = msg ? `<p class="wf-note" role="alert">${esc(msg)}</p>` : "";
  }

  function renderSignedOut(note = "") {
    if (!zone) return;
    zone.innerHTML = `<div class="card record-card account-card">
      <p class="kicker">Accounts</p>
      <h2 style="font-size:1.25rem">Your Deme account</h2>
      <p>An account syncs Your Deme — your ward, watched ward and
      topics — across your devices, and makes your account your
      Council alerts identity. Your picks never leave each device,
      account or not.</p>
      ${note ? `<p class="wf-note">${esc(note)}</p>` : ""}
      <div class="account-cols">
        <form id="acc-signup" class="account-form" novalidate>
          <h3>Create your account</h3>
          <div class="field"><label for="su-name">Name</label>
            <input type="text" id="su-name" autocomplete="name" required></div>
          <div class="field"><label for="su-email">Email</label>
            <input type="email" id="su-email" autocomplete="email" required></div>
          <div class="field"><label for="su-pass">Password</label>
            <input type="password" id="su-pass" autocomplete="new-password" required>
            <p class="small">Set and checked by our sign-in provider —
            Deme never sees or stores it.</p></div>
          <div class="field"><label for="su-pc">Postal code <span class="muted">(optional — only the first 3 characters are kept)</span></label>
            <input type="text" id="su-pc" autocomplete="postal-code"
              autocapitalize="characters" spellcheck="false"
              placeholder="First 3 characters is enough">
            <p class="small">Used once to find your ward. Only the first
            three characters are stored — never the full code.</p></div>
          <label class="checkline"><input type="checkbox" id="su-alerts">
            Email me the Council alerts digest for my wards and topics</label>
          <div id="su-err"></div>
          <p style="margin:.8rem 0 0"><button class="btn" type="submit">Create account</button></p>
        </form>
        <form id="acc-signin" class="account-form" novalidate>
          <h3>Sign in</h3>
          <div class="field"><label for="si-email">Email</label>
            <input type="email" id="si-email" autocomplete="email" required></div>
          <div class="field"><label for="si-pass">Password</label>
            <input type="password" id="si-pass" autocomplete="current-password" required></div>
          <div id="si-err"></div>
          <p style="margin:.8rem 0 0"><button class="btn secondary" type="submit">Sign in</button></p>
        </form>
      </div>
    </div>`;

    zone.querySelector("#acc-signup").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = zone.querySelector("#su-err");
      const name = zone.querySelector("#su-name").value.trim();
      const email = zone.querySelector("#su-email").value.trim();
      const pass = zone.querySelector("#su-pass").value;
      const pc = zone.querySelector("#su-pc").value.toUpperCase()
        .replace(/[^A-Z0-9]/g, "").slice(0, 3);
      if (!name || !email || !pass) {
        errLine(err, "Name, email and a password are all needed to create the account.");
        return;
      }
      if (pc && !/^[A-Z]\d[A-Z]$/.test(pc)) {
        errLine(err, "That postal code doesn't look right yet — the first three characters are enough (like M5V), or leave it blank.");
        return;
      }
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify({
          name, fsa: pc || null,
          alerts_opt_in: zone.querySelector("#su-alerts").checked,
        }));
      } catch (e2) {}
      errLine(err, "");
      try {
        const data = await apiJSON("/auth/v1/signup", {
          method: "POST",
          body: JSON.stringify({ email, password: pass }),
        }, "anon");
        if (adoptSession(data)) {
          await afterSignIn();
        } else {
          renderSignedOut("Account created — check your email and confirm it, then sign in. Your details are saved on this device and will be attached when you first sign in.");
        }
      } catch (e2) {
        errLine(err, e2.message || "Sign-up didn't go through. Please try again.");
      }
    });

    zone.querySelector("#acc-signin").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = zone.querySelector("#si-err");
      const email = zone.querySelector("#si-email").value.trim();
      const pass = zone.querySelector("#si-pass").value;
      errLine(err, "");
      try {
        const data = await apiJSON("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email, password: pass }),
        }, "anon");
        if (adoptSession(data)) await afterSignIn();
        else errLine(err, "Sign-in didn't return a session. Please try again.");
      } catch (e2) {
        errLine(err, e2.message || "Sign-in didn't go through. Check the email and password.");
      }
    });
  }

  function refreshSyncLine() {
    const el = zone && zone.querySelector("#acc-sync");
    if (el && accountProfile) {
      el.textContent = `Synced — Your Deme saved ${fmtDate((accountProfile.updated_at || "").slice(0, 10)) || "just now"}.`;
    }
  }

  async function renderSignedIn() {
    if (!zone) return;
    const row = accountProfile || {};
    zone.innerHTML = `<div class="card record-card account-card">
      <p class="kicker">Accounts</p>
      <h2 style="font-size:1.25rem">Your Deme account</h2>
      <p>Signed in as <strong>${esc(session.user.email || "")}</strong>.
      The form below is Your Deme, held on your account — saving it
      updates this device too, and the editors below stay in step.</p>
      <p class="small" id="acc-sync"></p>
      <form id="acc-profile" novalidate>
        <div class="field"><label for="ap-name">Name</label>
          <input type="text" id="ap-name" autocomplete="name"
            value="${esc(row.name || "")}"></div>
        <div class="field"><label for="ap-pc">Postal area <span class="muted">(first 3 characters only — what's stored)</span></label>
          <input type="text" id="ap-pc" autocapitalize="characters"
            spellcheck="false" value="${esc(row.fsa || "")}"
            placeholder="e.g. M5V">
          <p class="small">Changing this re-derives your ward below when
          the area sits in a single ward; where it straddles a boundary,
          pick your ward with the finder.</p></div>
        <div class="profile-field"><div id="ap-ward"></div></div>
        <div class="profile-field"><div id="ap-watch"></div></div>
        <div class="profile-field">
          <label id="ap-topics-l">Topics you follow</label>
          <div class="chips" id="ap-ints" role="group" aria-labelledby="ap-topics-l">
            ${Object.keys(threadLabels).map((id) =>
              `<button type="button" class="chip" data-id="${esc(id)}" aria-pressed="${(row.interests || []).includes(id)}">${esc(threadLabels[id])}</button>`).join("")}
          </div>
        </div>
        <label class="checkline"><input type="checkbox" id="ap-alerts" ${row.alerts_opt_in ? "checked" : ""}>
          Council alerts — email me the digest for my wards and topics</label>
        <div id="ap-err"></div>
        <p class="toolbar" style="margin:.9rem 0 0">
          <button class="btn" type="submit">Save account profile</button>
          <button class="btn secondary" type="button" id="acc-signout">Sign out</button>
        </p>
      </form>
      <div class="account-danger">
        <h3>Delete your account</h3>
        <p class="small">Deletes your account and everything Deme holds
        on its server for you — name, email, postal area, wards, topics
        and your alerts opt-in. Your picks and profile on this device
        are yours and stay unless you erase them below.</p>
        <div id="del-zone">
          <button class="btn danger" type="button" id="acc-del1">Delete my account and data</button>
        </div>
      </div>
    </div>`;
    refreshSyncLine();

    const wardFinder = WardFinder.mount(zone.querySelector("#ap-ward"), {
      idPrefix: "ap1", people, label: "Your ward",
      current: row.ward ?? VoteStore.getWard(), noneLabel: "No ward set",
    });
    const watchFinder = WardFinder.mount(zone.querySelector("#ap-watch"), {
      idPrefix: "ap2", people, label: "Also watch a second ward",
      current: row.watch_ward ?? VoteStore.getWatchWard(),
      exclude: row.ward ?? VoteStore.getWard(), noneLabel: "No second ward",
      inputLabel: "Postal code of the area to watch",
    });
    zone.querySelectorAll("#ap-ints .chip").forEach((b) =>
      b.addEventListener("click", () => b.setAttribute("aria-pressed",
        b.getAttribute("aria-pressed") === "true" ? "false" : "true")));

    zone.querySelector("#ap-pc").addEventListener("change", async (e) => {
      const fsa = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
      e.target.value = fsa;
      if (/^[A-Z]\d[A-Z]$/.test(fsa)) {
        try {
          const wards = await WardFinder.wardsFor(fsa);
          if (wards && wards.length === 1) wardFinder.set(wards[0]);
        } catch (e2) { /* finder remains for manual picking */ }
      }
    });

    zone.querySelector("#acc-profile").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = zone.querySelector("#ap-err");
      const fsaRaw = zone.querySelector("#ap-pc").value.toUpperCase()
        .replace(/[^A-Z0-9]/g, "").slice(0, 3);
      if (fsaRaw && !/^[A-Z]\d[A-Z]$/.test(fsaRaw)) {
        errLine(err, "The postal area should be three characters — a letter, a number, a letter — or blank.");
        return;
      }
      const fields = {
        name: zone.querySelector("#ap-name").value.trim(),
        fsa: fsaRaw || null,
        ward: wardFinder.value(),
        watch_ward: watchFinder.value(),
        interests: [...zone.querySelectorAll('#ap-ints .chip[aria-pressed="true"]')]
          .map((b) => b.dataset.id),
        alerts_opt_in: zone.querySelector("#ap-alerts").checked,
        alerts_consent_at: zone.querySelector("#ap-alerts").checked
          ? new Date().toISOString() : null,
      };
      if (fields.watch_ward != null && fields.watch_ward === fields.ward) {
        fields.watch_ward = null;
      }
      errLine(err, "");
      try {
        await upsertRow(fields);
        applyToLocal(accountProfile);
        refreshSyncLine();
        errLine(err, "");
        zone.querySelector("#acc-sync").textContent =
          "Saved — your account and this device now match.";
        refreshAlertsBox();
        if (typeof mountFinders === "function") mountFinders();
      } catch (e2) {
        errLine(err, e2.message || "Saving didn't go through. Please try again.");
      }
    });

    zone.querySelector("#acc-signout").addEventListener("click", async () => {
      try { await api("/auth/v1/logout", { method: "POST" }); } catch (e) {}
      session = null;
      accountProfile = null;
      saveSession();
      renderSignedOut("Signed out on this device. Your local profile and picks stay, as they always have.");
      refreshAlertsBox();
    });

    const delZone = zone.querySelector("#del-zone");
    zone.querySelector("#acc-del1").addEventListener("click", () => {
      delZone.innerHTML = `
        <p class="wf-note"><strong>This cannot be undone.</strong> Your
        account and its server-held data will be deleted.</p>
        <p class="toolbar" style="margin:.6rem 0 0">
          <button class="btn danger" type="button" id="acc-del2">Yes — delete my account and data</button>
          <button class="btn secondary" type="button" id="acc-del-cancel">Keep my account</button>
        </p>
        <div id="del-err"></div>`;
      delZone.querySelector("#acc-del-cancel").addEventListener("click", renderSignedIn);
      delZone.querySelector("#acc-del2").addEventListener("click", async () => {
        const err = delZone.querySelector("#del-err");
        try {
          const res = await api("/functions/v1/delete-account", { method: "POST", body: "{}" });
          if (!res.ok) throw new Error(`(${res.status})`);
          session = null;
          accountProfile = null;
          saveSession();
          try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
          renderSignedOut("Your account and its server-held data are deleted. Your local profile and picks remain on this device — erase them any time with the button below.");
          refreshAlertsBox();
        } catch (e2) {
          errLine(err, "Automatic deletion couldn't complete just now. Your account can be deleted on request — see the privacy policy for how to reach us, and nothing about your account changes in the meantime.");
        }
      });
    });
  }

  async function afterSignIn() {
    try {
      await bootstrapProfile();
    } catch (e) { /* profile loads on next visit; session still valid */ }
    if (typeof mountFinders === "function") mountFinders();
    await renderSignedIn();
    refreshAlertsBox();
  }

  /* ---------------- alerts box (called by record.js) ---------------- */
  function renderAlerts(box) {
    if (!box) return;
    if (session) {
      const on = accountProfile && accountProfile.alerts_opt_in;
      box.innerHTML = `<h3>Council alerts by email</h3>
        <p>You're signed in, so your account is your alerts identity —
        no separate form. Council alerts for your wards and topics are
        currently <strong>${on ? "on" : "off"}</strong>. Sign-ups are
        open now — digests haven't started yet, and they begin with the
        new Council term. When they start, it will be one digest per
        Council agenda, never one email per item, and a person reviews
        every digest before it goes out.</p>
        <p class="small">Change it any time in
        <a href="#account-zone">your account</a> above. Nothing is sent
        until digests begin.</p>`;
      return;
    }
    box.innerHTML = `<h3>Council alerts by email</h3>
      <p>Get an email when items on your wards or topics reach a City
      Council agenda. Sign-ups are open now — digests haven't started
      yet, and they begin with the new Council term. When they start,
      it will be one digest per Council agenda, never one email per
      item, and a person reviews every digest before it goes out.</p>
      ${DEME_ALERTS_FORM_URL
        ? `<p><a class="btn bronze" href="${esc(DEME_ALERTS_FORM_URL)}" target="_blank" rel="noopener">Sign up for Council alerts</a></p>
           <p class="small">The sign-up form will ask for your email
           address, your wards and your topics. Nothing is sent until
           digests begin. Unsubscribe at any time.</p>
           <p class="small">Or <a href="#account-zone">create a Deme
           account</a> and manage alerts from your account instead.</p>`
        : `<p class="small">Sign-ups are not open right now. When they
           open, alerts will follow the wards and topics in Your Deme.</p>`}`;
  }
  function refreshAlertsBox() {
    const box = document.getElementById("profile-alerts");
    if (box && enabled()) renderAlerts(box);
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    if (!zone || booted) return;
    booted = true;
    if (!enabled()) { renderDisabled(); return; }

    /* Accounts are live, so the "no server and no account" line no
       longer describes the whole page: swap in the re-scoped copy
       (full text in WARD-FINDER-REPORT.md). This only ever runs when
       the account layer is activated. */
    const note = document.getElementById("local-note");
    if (note) {
      note.textContent = "Your picks never leave this browser, and "
        + "Deme keeps no tally of visitors' positions. Your local "
        + "profile lives in this browser's storage; if you create an "
        + "account, your name, email, postal area (first 3 characters), "
        + "wards and topics are also held on our server so they can "
        + "follow you — see the privacy policy for exactly what's held "
        + "and how to delete it.";
    }

    try {
      people = await loadJSON(dataPath("councillors.json"));
    } catch (e) { people = []; }
    try {
      const td = await loadJSON(dataPath("threads-summary.json"));
      threadLabels = {};
      (td.threads || []).forEach((t) => { threadLabels[t.id] = t.label; });
    } catch (e) { threadLabels = {}; }

    session = loadSession();
    if (session) {
      if (session.expires_at < Date.now() + 30000) {
        if (!await refreshSession()) {
          session = null;
          saveSession();
        }
      }
    }
    if (session) {
      try { accountProfile = await fetchRow(); } catch (e) { accountProfile = null; }
      lastSyncedStamp = VoteStore.exportAll().profileUpdatedAt;
      await renderSignedIn();
    } else {
      renderSignedOut();
    }
    refreshAlertsBox();
    setInterval(syncFromLocal, 20000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) syncFromLocal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  return { enabled, renderAlerts };
})();

window.DemeAccount = DemeAccount;
