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
   - The account profile is: name, primary ward, watched ward,
     interests, alerts opt-in. (A postal area was briefly part of
     the profile; the owner dropped it Oct 20, 2026 — ward only.
     The profiles.fsa column remains in the schema, unused, and a
     value stored there by an earlier build is never read,
     written, or exported.) The email address of record
     lives only with the auth provider (auth.users) — it is never
     written into the profiles row (F-4). Picks DO save to the
     account (owner decision, Oct 20, 2026 — it reversed the earlier
     on-device-only line): one row per pick in public.picks (item
     reference, position, timestamps), own-rows-only under RLS like
     profiles, used only for the owner's own voting card and
     notifications. There is deliberately no field or function
     anywhere that could total visitors' picks — the no-tally rule
     is permanent, accounts or not. Watches (owner decision,
     Oct 21, 2026 — "close the loop") follow the same shape: one
     row per watched item in public.watches, own-rows-only under
     RLS, read only for the owner's own list and the owner's one
     outcome email when the item is decided.
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
  let authReadyResolve = null;
  const authReadyPromise = new Promise((r) => { authReadyResolve = r; });
  function authReady() { return authReadyPromise; }
  function settleAuthReady() {
    if (authReadyResolve) { authReadyResolve(); authReadyResolve = null; }
  }
  function isSignedIn() { return Boolean(session); }

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
    /* No email key in this payload, deliberately: the corrected
       schema (ACTIVATION-AUDIT-PROTOCOL.md F-4) drops the email
       column from profiles — the verified address of record is the
       auth provider's (session.user.email), never a client-written
       copy that a raw request could spoof. */
    const row = {
      user_id: session.user.id,
      updated_at: new Date().toISOString(),
      ...fields,
    };
    /* RT-02(a): capture the local stamp BEFORE the request. An
       edit made while the request is in flight has not been sent;
       reading the stamp after the await would mark it synced and
       lose it silently until the next edit. */
    const stampAtSend = VoteStore.exportAll().profileUpdatedAt;
    const rows = await authedJSON("/rest/v1/profiles", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    accountProfile = Array.isArray(rows) && rows.length ? rows[0] : row;
    lastSyncedStamp = stampAtSend;
    return accountProfile;
  }

  /* On sign-in: the newer of (server row, this device's profile)
     wins, and the loser is updated to match. With no row yet, the
     account is seeded from the sign-up details + this device. */
  async function bootstrapProfile() {
    const row = await fetchRow();
    const localStamp = VoteStore.exportAll().profileUpdatedAt;
    /* RT-01: pending sign-up details seed this account only when
       they were typed for this very address (pendingForSession). */
    const pend = pendingForSession();
    if (row) {
      accountProfile = row;
      /* RT-02(b): compare stamps as parsed times — the server
         serializes with a "+00:00" offset and the client with
         "Z", so a string comparison can crown the wrong winner
         inside a sub-second window. */
      const rowMs = Date.parse(row.updated_at || "") || 0;
      const localMs = Date.parse(localStamp || "") || 0;
      if (!localStamp || rowMs >= localMs) {
        applyToLocal(row);
        lastSyncedStamp = VoteStore.exportAll().profileUpdatedAt;
      } else {
        await upsertRow({
          name: row.name || pend.name,
          alerts_opt_in: Boolean(row.alerts_opt_in),
          ...localPayload(),
        });
      }
      try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
      return;
    }
    /* New account: the wards picked in the sign-up ward step are
       the profile's wards (owner decision, Oct 20, 2026). A ward
       the sign-up didn't set falls back to this device's, as
       before; a watched ward equal to the home ward is no watch. */
    const ward = pend.ward != null ? pend.ward : VoteStore.getWard();
    let watch = pend.watch != null ? pend.watch : VoteStore.getWatchWard();
    if (watch != null && watch === ward) watch = null;
    await upsertRow({
      name: pend.name,
      alerts_opt_in: pend.alerts,
      alerts_consent_at: pend.alerts ? new Date().toISOString() : null,
      ward,
      watch_ward: watch,
      interests: VoteStore.getInterests(),
    });
    if (ward !== VoteStore.getWard()) VoteStore.setWard(ward);
    if (watch !== VoteStore.getWatchWard()) VoteStore.setWatchWard(watch);
    try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
  }
  function pending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || {}; }
    catch (e) { return {}; }
  }
  /* A ward carried in a pending record counts only as a whole
     Toronto ward number; anything else is treated as unset. */
  function pendingWard(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 25 ? n : null;
  }
  /* RT-01: the pending record holds details typed at sign-up on
     this browser — possibly by somebody else, on a shared
     machine, in an attempt that was abandoned or failed. It may
     seed an account only when it was written for the very
     address that has just signed in; anything else is treated
     as absent. bootstrapProfile removes the record on every
     path, so it can never be inherited twice. (It is NOT
     removed at sign-in submit: the confirm-then-sign-in flow
     the product promises — "your details are saved on this
     device and will be attached when you first sign in" —
     depends on the matching record surviving until here; the
     identity check is what makes that safe.) */
  function pendingForSession() {
    const p = pending();
    const email = session && session.user && session.user.email;
    if (p && p.email && email
        && String(p.email).toLowerCase() === String(email).toLowerCase()) {
      /* A pending record written before the postal area was
         dropped may still carry an fsa key — it is ignored here
         (never read into the account), and bootstrapProfile
         removes the record on every path, as always. */
      return {
        name: p.name || "",
        alerts: Boolean(p.alerts_opt_in),
        ward: pendingWard(p.ward),
        watch: pendingWard(p.watch_ward),
      };
    }
    return { name: "", alerts: false, ward: null, watch: null };
  }

  /* Push local profile edits up while signed in (wards / interests
     changed in the editors below). Name and the alerts opt-in
     are account-side fields and are preserved from the row. */
  async function syncFromLocal() {
    if (!session || !accountProfile) return;
    const stamp = VoteStore.exportAll().profileUpdatedAt;
    if (!stamp || stamp === lastSyncedStamp) return;
    try {
      /* RT-02: name and the alerts opt-in are account-side
         fields — never push them from this device's in-memory
         copy of the row, which can be hours stale. Pushed over
         a fresher server row, a stale opt-in would let an
         unrelated local edit erase genuine consent evidence —
         or, through the server trigger, fabricate it. Read the
         row fresh and re-source those fields from it; only the
         locally-owned fields (wards, topics) travel from this
         device. */
      const fresh = await fetchRow();
      if (!fresh) return; /* row gone server-side; retry next tick */
      accountProfile = fresh;
      await upsertRow({
        name: fresh.name || "",
        alerts_opt_in: Boolean(fresh.alerts_opt_in),
        ...localPayload(),
      });
      refreshSyncLine();
    } catch (e) { /* next tick retries */ }
  }

  /* ---------------- picks (account-saved, owner decision
     Oct 20, 2026) ----------------
     One row per pick in public.picks: item_ref, position,
     timestamps — own-rows-only under RLS, mirroring profiles.
     The VoteStore remains the on-device cache every surface
     renders from; this layer keeps the account copy in step.
     Failure discipline: a failed account write never loses the
     device copy — the divergence is remembered as "stale" and
     offered for correction at the next sign-in merge. Picks are
     never read for anything but the owner's own card and
     notifications; there is no tally, here or anywhere. */
  const STALE_KEY = "deme.stalePicks.v1";
  function stalePicks() {
    try {
      const v = JSON.parse(localStorage.getItem(STALE_KEY));
      return v && typeof v === "object" ? v : {};
    } catch (e) { return {}; }
  }
  function setStale(ref, choice) {
    try {
      const st = stalePicks();
      if (choice === undefined) delete st[ref];
      else st[ref] = choice;
      if (Object.keys(st).length) localStorage.setItem(STALE_KEY, JSON.stringify(st));
      else localStorage.removeItem(STALE_KEY);
    } catch (e) {}
  }
  async function fetchPicks() {
    const rows = await authedJSON(
      `/rest/v1/picks?user_id=eq.${encodeURIComponent(session.user.id)}`
      + `&select=item_ref,position,created_at,updated_at&order=created_at.asc`);
    return Array.isArray(rows) ? rows : [];
  }
  async function upsertPick(ref, position) {
    await authedJSON("/rest/v1/picks", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: session.user.id, item_ref: ref, position,
      }),
    });
  }
  async function deletePickRow(ref) {
    await authedJSON(
      `/rest/v1/picks?user_id=eq.${encodeURIComponent(session.user.id)}`
      + `&item_ref=eq.${encodeURIComponent(ref)}`,
      { method: "DELETE", headers: { "Prefer": "return=minimal" } });
  }
  /* Called by the weigh-in (record.js) after a pick changes in
     the local cache. Returns true when the account copy is in
     step; on failure the divergence is marked stale for the
     next sign-in merge and false comes back, so the caller can
     say honestly that only the device copy is saved. */
  async function syncPick(ref, choice) {
    if (!session) return false;
    try {
      if (choice) await upsertPick(ref, choice);
      else await deletePickRow(ref);
      setStale(ref, undefined);
      return true;
    } catch (e) {
      setStale(ref, choice || null);
      return false;
    }
  }
  function notifyRecord() {
    const r = window.DemeRecord;
    if (!r) return;
    if (typeof r.refreshWeighIn === "function") r.refreshWeighIn();
    if (typeof r.refreshPicks === "function") r.refreshPicks();
    if (typeof r.refreshWatches === "function") r.refreshWatches();
  }
  /* Pages without a DemeRecord surface (Home's upcoming cards)
     listen for this instead: it fires whenever the session or the
     watch list settles — sign-in, sign-out, bootstrap, a toggle. */
  function notifyWatchSurfaces() {
    try { window.dispatchEvent(new CustomEvent("deme:session")); }
    catch (e) { /* very old browser — surfaces refresh on next load */ }
  }
  /* On sign-in: the account's rows and this device's picks are
     merged into the cache. Anything the account doesn't hold
     yet — picks taken signed-out, picks newer on this device,
     removals that never reached the server — is OFFERED, never
     auto-uploaded: the visitor decides. Remote-only picks join
     the cache silently (they are the account working as
     promised). */
  async function bootstrapPicks() {
    if (!session) return;
    if (typeof VoteStore.allPicks !== "function"
        || typeof VoteStore.replacePicks !== "function") return;
    try {
      const rows = await fetchPicks();
      const remote = {};
      rows.forEach((r) => {
        if (r && r.item_ref
            && (r.position === "support" || r.position === "oppose")) {
          remote[r.item_ref] = r;
        }
      });
      const local = VoteStore.allPicks() || {};
      const merged = {};
      Object.entries(remote).forEach(([ref, r]) => {
        merged[ref] = {
          choice: r.position,
          ts: r.updated_at || r.created_at || new Date().toISOString(),
        };
      });
      const uploads = [];
      Object.entries(local).forEach(([ref, lp]) => {
        if (!lp || (lp.choice !== "support" && lp.choice !== "oppose")) return;
        const r = remote[ref];
        if (!r) { uploads.push(ref); merged[ref] = lp; return; }
        const localMs = Date.parse(lp.ts || "") || 0;
        const remoteMs = Date.parse(r.updated_at || r.created_at || "") || 0;
        if (localMs > remoteMs) { uploads.push(ref); merged[ref] = lp; }
      });
      const deletes = [];
      const stale = stalePicks();
      Object.entries(stale).forEach(([ref, want]) => {
        if (want === null && remote[ref] && !local[ref]) {
          deletes.push(ref);
          delete merged[ref];
        } else if (want && local[ref] && !uploads.includes(ref)) {
          uploads.push(ref);
          merged[ref] = local[ref];
        }
      });
      VoteStore.replacePicks(merged);
      renderMigrationOffer(uploads, deletes);
      notifyRecord();
    } catch (e) { /* account copy loads on a later visit */ }
  }
  function renderMigrationOffer(uploads, deletes) {
    const host = document.getElementById("picks-migration");
    if (!host) return;
    if (!uploads.length && !deletes.length) { host.innerHTML = ""; return; }
    const parts = [];
    if (uploads.length) {
      parts.push(`${uploads.length} pick${uploads.length === 1 ? "" : "s"} `
        + `on this device ${uploads.length === 1 ? "isn't" : "aren't"} `
        + `in your account yet`);
    }
    if (deletes.length) {
      parts.push(`${deletes.length} pick${deletes.length === 1 ? "" : "s"} `
        + `you removed ${deletes.length === 1 ? "still shows" : "still show"} `
        + `in your account`);
    }
    host.innerHTML = `<div class="card pick-gate" style="margin-bottom:1rem">
      <h3>Bring your account up to date?</h3>
      <p>${esc(parts.join("; "))}. Update your account so your voting card matches this device everywhere — or leave things as they are. Either way, only you can see your picks, and Deme never totals visitors' positions.</p>
      <p class="toolbar" style="margin:.6rem 0 0">
        <button class="btn small" type="button" id="picks-migrate-yes">Update my account</button>
        <button class="btn secondary small" type="button" id="picks-migrate-no">Not now</button>
      </p>
      <div id="picks-migrate-note"></div>
    </div>`;
    host.querySelector("#picks-migrate-no").addEventListener("click", () => {
      host.innerHTML = "";
    });
    host.querySelector("#picks-migrate-yes").addEventListener("click", async () => {
      const note = host.querySelector("#picks-migrate-note");
      try {
        for (const ref of uploads) {
          const lp = (typeof VoteStore.getPick === "function")
            ? VoteStore.getPick(ref) : null;
          if (lp && (lp.choice === "support" || lp.choice === "oppose")) {
            await upsertPick(ref, lp.choice);
            setStale(ref, undefined);
          }
        }
        for (const ref of deletes) {
          await deletePickRow(ref);
          setStale(ref, undefined);
        }
        host.innerHTML = `<p class="wf-note">Your account now matches
          this device — your picks follow you on any device.</p>`;
        notifyRecord();
      } catch (e) {
        if (note) {
          note.innerHTML = `<p class="wf-note" role="alert">That didn't
            go through just now — your picks are safe on this device,
            and the offer will return at your next sign-in.</p>`;
        }
      }
    });
  }

  /* ---------------- watches (account-saved, owner decision
     Oct 21, 2026 — "close the loop") ----------------
     One row per watched item in public.watches: item_ref, a
     snapshot of the item's public title, timestamps, and the
     resolver-owned notify state (watch-migration.sql). Watching
     requires sign-in, like weighing in; reading never does. When
     the item is decided, the server-side resolver sends the owner
     exactly one outcome email and marks the row sent — the
     notify_state / notified_at / outcome columns are written
     only by that resolver (a trigger freezes them against client
     writes), never from here.
     Failure discipline mirrors picks: a failed account write
     never loses the device copy — the divergence is remembered
     as "stale" and retried at the next sign-in bootstrap, and
     syncWatch returns false so the caller can say honestly that
     the change is only on this device for now. A watch is a
     subscription, not a position, so unlike picks there is
     nothing to arbitrate at merge time: stale retries are quiet.
     Watches are read for the owner's own list and the owner's
     outcome email only; there is no tally, here or anywhere. */
  const WATCH_CACHE_KEY = "deme.watches.v1";
  const STALE_WATCH_KEY = "deme.staleWatches.v1";
  let watchRows = null; /* null = account copy not loaded yet */
  function cachedWatches() {
    try {
      const v = JSON.parse(localStorage.getItem(WATCH_CACHE_KEY));
      if (v && v.user && session && v.user === session.user.id
          && Array.isArray(v.rows)) return v.rows;
    } catch (e) { /* treat as no cache */ }
    return [];
  }
  function cacheWatches(rows) {
    watchRows = rows;
    try {
      if (session && rows) {
        localStorage.setItem(WATCH_CACHE_KEY, JSON.stringify(
          { user: session.user.id, rows }));
      }
    } catch (e) {}
  }
  /* The render-facing read: the account's watches when signed in,
     nothing when signed out — a watch is account data tied to the
     outcome email, so unlike a pick it has no on-device meaning,
     and a previous visitor's cache on a shared device is never
     shown (the cache is stamped with its owner's id). */
  function getWatches() {
    if (!session) return [];
    return watchRows || cachedWatches();
  }
  function isWatching(ref) {
    return getWatches().some((w) => w && w.item_ref === ref);
  }
  function staleWatches() {
    try {
      const v = JSON.parse(localStorage.getItem(STALE_WATCH_KEY));
      return v && typeof v === "object" ? v : {};
    } catch (e) { return {}; }
  }
  function setStaleWatch(ref, want) {
    try {
      const st = staleWatches();
      if (want === undefined) delete st[ref];
      else st[ref] = want;
      if (Object.keys(st).length) {
        localStorage.setItem(STALE_WATCH_KEY, JSON.stringify(st));
      } else localStorage.removeItem(STALE_WATCH_KEY);
    } catch (e) {}
  }
  function isStaleWatch(ref) {
    return Object.prototype.hasOwnProperty.call(staleWatches(), ref);
  }
  async function fetchWatches() {
    const rows = await authedJSON(
      `/rest/v1/watches?user_id=eq.${encodeURIComponent(session.user.id)}`
      + `&select=id,item_ref,item_title,created_at,notify_state,notified_at,outcome`
      + `&order=created_at.asc`);
    return Array.isArray(rows) ? rows : [];
  }
  async function upsertWatchRow(ref, title) {
    await authedJSON("/rest/v1/watches", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: session.user.id, item_ref: ref,
        item_title: title || null,
      }),
    });
  }
  async function deleteWatchRow(ref) {
    await authedJSON(
      `/rest/v1/watches?user_id=eq.${encodeURIComponent(session.user.id)}`
      + `&item_ref=eq.${encodeURIComponent(ref)}`,
      { method: "DELETE", headers: { "Prefer": "return=minimal" } });
  }
  /* Called by the watch toggles (My Record's weigh-in cards,
     Home's upcoming cards) after the visitor taps. The device
     cache updates first so the toggle answers instantly; the
     account write follows. Returns true when the account copy
     is in step; on failure the divergence is marked stale for
     the next bootstrap retry and false comes back, so the
     caller can say honestly that only the device copy is saved. */
  async function syncWatch(ref, on, title) {
    if (!session) return false;
    const before = getWatches().slice();
    const next = on
      ? [...before.filter((w) => w.item_ref !== ref),
         { item_ref: ref, item_title: title || null,
           created_at: new Date().toISOString(),
           notify_state: "pending", notified_at: null, outcome: null }]
      : before.filter((w) => w.item_ref !== ref);
    cacheWatches(next);
    try {
      if (on) await upsertWatchRow(ref, title);
      else await deleteWatchRow(ref);
      setStaleWatch(ref, undefined);
      return true;
    } catch (e) {
      setStaleWatch(ref, on ? { title: title || null } : null);
      return false;
    }
  }
  /* On sign-in / stored-session restore: stale divergences are
     retried once, quietly, then the account's rows become the
     cache. A failure anywhere leaves the cached copy in place —
     the account copy loads on a later visit. */
  async function bootstrapWatches() {
    if (!session) return;
    try {
      const stale = staleWatches();
      for (const ref of Object.keys(stale)) {
        const want = stale[ref];
        try {
          if (want) await upsertWatchRow(ref, want.title);
          else await deleteWatchRow(ref);
          setStaleWatch(ref, undefined);
        } catch (e) { /* stays stale; retried next visit */ }
      }
      cacheWatches(await fetchWatches());
    } catch (e) { /* account copy loads on a later visit */ }
    notifyRecord();
    notifyWatchSurfaces();
  }

  /* ---------------- CAPTCHA (F-6 readiness) ----------------
     Wired but inert while DEME_CAPTCHA_KEY stays empty: no
     third-party script is loaded, no widget renders, and auth
     requests carry no captcha_token — behaviour is unchanged.
     Once the key is set in common.js, both auth forms render a
     Cloudflare Turnstile widget and pass its token to the
     provider (which requires the token on sign-up AND sign-in
     once protection is on). The dashboard half — enabling
     Turnstile under Authentication → Bot and Abuse Protection
     and storing the secret key there — is a publish-step item,
     not code; the site key here is public by design, the secret
     never ships. ACTIVATION-AUDIT-PROTOCOL.md F-6 / gate G-10.
     Wire shape (proved live, Oct 20, 2026): GoTrue reads the
     token ONLY from the request body's
     gotrue_meta_security.captcha_token — a top-level
     captcha_token field is ignored and the request is refused
     as "no captcha_token found". Every token-carrying body
     below nests it; do not flatten. */
  let captchaScript = null;
  function loadCaptchaScript() {
    if (!captchaScript) {
      captchaScript = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return captchaScript;
  }
  function mountCaptcha(el) {
    if (!DEME_CAPTCHA_KEY || !el) return null;
    const state = { token: "", widgetId: null };
    /* Loading treatment (restore pass): the slot explains itself
       while the widget loads, instead of sitting on the widget's
       own bare "Verifying…" spinner. The token flow is unchanged —
       tokens still arrive only through the render callback below. */
    el.innerHTML = `<div class="captcha-wait" role="status">
      <span class="spin" aria-hidden="true"></span>
      <span>Loading the security check…</span></div>`;
    loadCaptchaScript().then(() => {
      if (!window.turnstile) {
        el.innerHTML = `<div class="captcha-wait"><span>The security
          check couldn't load — reload the page to try again.</span></div>`;
        return;
      }
      el.innerHTML = "";
      state.widgetId = window.turnstile.render(el, {
        sitekey: DEME_CAPTCHA_KEY,
        theme: "light",
        callback: (t) => { state.token = t; },
        "expired-callback": () => { state.token = ""; },
        "error-callback": () => { state.token = ""; },
      });
    }).catch(() => {
      el.innerHTML = `<div class="captcha-wait"><span>The security
        check couldn't load — check your connection and reload the
        page.</span></div>`;
      /* the submit handlers also report the missing token */
    });
    return state;
  }

  /* RT-06: Turnstile tokens are single-use and live about five
     minutes. After any attempt that may have consumed one, reset
     the widget and clear the stored token — otherwise the
     immediate retry (a mistyped password is the most common
     attempt in the product) submits the spent token and wedges
     the visitor behind a misleading captcha error. Inert while
     no CAPTCHA key is configured: no widget exists to reset. */
  function resetCaptcha(state) {
    if (!state) return;
    state.token = "";
    try {
      if (window.turnstile && state.widgetId != null) {
        window.turnstile.reset(state.widgetId);
      }
    } catch (e) { /* a re-render remounts the widget anyway */ }
  }

  /* Read-only Council alerts state for My Record's profile
     summary (record.js): false when signed out, null while
     signed in but the profile row hasn't loaded yet, otherwise
     the row's opt-in. Pure read — the summary re-renders at the
     same points the alerts box does (refreshAlertsBox). */
  function alertsOptIn() {
    if (!session) return false;
    if (!accountProfile) return null;
    return Boolean(accountProfile.alerts_opt_in);
  }

  /* ---------------- rendering ---------------- */
  /* The accounts value pitch (owner-reviewed copy, Oct 20, 2026):
     a navy feature panel with the three points as bold feature
     rows. One source for the signed-out panel, the opening-soon
     panel, and (mirrored as static HTML) the pre-JS placeholder in
     my-record.html — keep all three in step. */
  function featurePanelHTML() {
    return `<div class="acct-feature">
      <p class="kicker">Accounts</p>
      <h2>Make your voice heard — before the vote, not after it.</h2>
      <ul class="acct-points">
        <li class="acct-point"><strong>Have your say</strong> — weigh in
        on what's coming up at Council, decision by decision.</li>
        <li class="acct-point"><strong>Stay informed</strong> — get
        alerted when your ward or the issues you follow hit the agenda.</li>
        <li class="acct-point"><strong>See where you stand</strong> —
        after the vote, your voting card lines your picks up against
        how your representative actually voted.</li>
      </ul>
      <p class="acct-privacy">Reading the record never needs an
      account. Your picks are yours alone — only you can see them,
      and Deme never totals visitors' positions.</p>
    </div>`;
  }

  function renderDisabled() {
    if (!zone) return;
    zone.innerHTML = `<div class="card record-card account-card">
      ${featurePanelHTML()}
      <p style="margin:0">Accounts are opening soon. Nothing is missing today: the full record is open to everyone — an account is how you weigh in and keep your picks.</p>
      <p class="small" style="margin:.8rem 0 0">What Deme holds, where,
      and how to delete it: the
      <a href="privacy.html">privacy policy</a>.</p>
    </div>`;
  }

  function errLine(el, msg) {
    el.innerHTML = msg ? `<p class="wf-note" role="alert">${esc(msg)}</p>` : "";
  }

  /* RT-05: provider error strings never reach the page raw.
     One of them — "Email not confirmed" — confirms that a
     pending registration exists for an address: an enumeration
     channel aimed at exactly the addresses a spam wave just
     probed. Others vary wording by provider version. Map to
     house copy; keep specific lines only where the visitor can
     act on them and nothing about any account leaks (wrong
     credentials, throttling, password length — policy, not
     data). Anything unrecognised gets the caller's fallback. */
  function mapAuthError(e, fallback) {
    const raw = (e && e.message) || "";
    if (/invalid login credentials/i.test(raw)) {
      return "That email and password don't match. Check them both and try again.";
    }
    if (/email not confirmed/i.test(raw)) {
      return "Sign-in didn't go through. Check the email and password"
        + " — and if you created an account recently, confirm it"
        + " from the email we sent before signing in.";
    }
    if ((e && e.status === 429) || /rate limit|too many/i.test(raw)) {
      return "Too many attempts just now — wait a few minutes, then try again.";
    }
    if (/password should be at least/i.test(raw)) {
      return "That password is too short — passwords need at least 10 characters.";
    }
    return fallback;
  }

  function renderSignedOut(note = "", opts = {}) {
    if (!zone) return;
    zone.innerHTML = `<div class="card record-card account-card">
      ${featurePanelHTML()}
      ${note ? `<p class="wf-note">${esc(note)}</p>` : ""}
      ${opts.resend ? `<div id="rs-zone">
        <div class="field"><label for="rs-email">Didn't get the confirmation email?</label>
          <input type="email" id="rs-email" autocomplete="email"
            value="${esc(opts.resendEmail || "")}">
          <p class="small">It comes from Deme — if it isn't in your
          inbox, check spam.</p></div>
        <div class="captcha-slot" id="rs-captcha"></div>
        <div id="rs-err"></div>
        <p style="margin:.6rem 0 0"><button class="btn secondary" type="button" id="acc-resend">Resend the confirmation email</button></p>
      </div>` : ""}
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
          <div class="profile-field"><div id="su-ward"></div></div>
          <div class="profile-field"><div id="su-watch"></div></div>
          <label class="checkline"><input type="checkbox" id="su-alerts">
            Email me the Council alerts digest for my wards and topics</label>
          <div class="captcha-slot" id="su-captcha"></div>
          <div id="su-err"></div>
          <p style="margin:.8rem 0 0"><button class="btn" type="submit">Create account</button></p>
        </form>
        <form id="acc-signin" class="account-form" novalidate>
          <h3>Sign in</h3>
          <div class="field"><label for="si-email">Email</label>
            <input type="email" id="si-email" autocomplete="email" required></div>
          <div class="field"><label for="si-pass">Password</label>
            <input type="password" id="si-pass" autocomplete="current-password" required></div>
          <div class="captcha-slot" id="si-captcha"></div>
          <div id="si-err"></div>
          <p style="margin:.8rem 0 0"><button class="btn secondary" type="submit">Sign in</button></p>
          <p style="margin:.7rem 0 0"><button type="button" id="si-forgot"
            style="background:none;border:0;padding:.7rem .25rem;min-height:44px;font:inherit;color:var(--bronze-dark);text-decoration:underline;cursor:pointer">Forgot your password?</button></p>
          <div id="si-reset" hidden>
            <div class="field"><label for="sr-email">Email for your reset link</label>
              <input type="email" id="sr-email" autocomplete="email">
              <p class="small">The link goes to this address. Reset
              links expire, so use yours soon after it arrives.</p></div>
            <div id="sr-err"></div>
            <p style="margin:.6rem 0 0"><button class="btn secondary" type="button" id="sr-send">Email me a reset link</button></p>
          </div>
        </form>
      </div>
      <p class="small" style="margin:.9rem 0 0">What an account holds,
      where it is held, and how to delete it is set out in the
      <a href="privacy.html">privacy policy</a>.</p>
    </div>`;

    const suCaptcha = mountCaptcha(zone.querySelector("#su-captcha"));
    const siCaptcha = mountCaptcha(zone.querySelector("#si-captcha"));

    /* The ward step (owner decision, Oct 20, 2026): a ward belongs
       to the profile and is set when the account is made — here,
       with the same postal-code finder (first 3 characters only,
       in-browser) and the ward list as its fallback. The picks are
       carried in the pending record and land on the profiles row
       at first sign-in (bootstrapProfile), exactly like the name
       and the alerts opt-in typed alongside them. */
    const suWardFinder = WardFinder.mount(zone.querySelector("#su-ward"), {
      idPrefix: "su1", people, label: "Your ward",
      current: null, noneLabel: "No ward set",
    });
    const suWatchFinder = WardFinder.mount(zone.querySelector("#su-watch"), {
      idPrefix: "su2", people, label: "Also watch a second ward (optional)",
      current: null, noneLabel: "No second ward",
      inputLabel: "Postal code of the area to watch",
      collapseWhenEmpty: true,
    });

    zone.querySelector("#acc-signup").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = zone.querySelector("#su-err");
      const name = zone.querySelector("#su-name").value.trim();
      const email = zone.querySelector("#su-email").value.trim();
      const pass = zone.querySelector("#su-pass").value;
      if (!name || !email || !pass) {
        errLine(err, "Name, email and a password are all needed to create the account.");
        return;
      }
      if (pass.length < 10) {
        errLine(err, "That password is too short — passwords need at least 10 characters.");
        return;
      }
      try {
        /* RT-01: the pending record carries the address it was
           typed for; bootstrapProfile consumes it only for that
           same address (see pendingForSession). The wards are the
           ones picked in the ward step above; a watched ward equal
           to the home ward is no watch at all. */
        let suWatch = suWatchFinder.value();
        if (suWatch != null && suWatch === suWardFinder.value()) suWatch = null;
        localStorage.setItem(PENDING_KEY, JSON.stringify({
          email, name,
          alerts_opt_in: zone.querySelector("#su-alerts").checked,
          ward: suWardFinder.value(),
          watch_ward: suWatch,
        }));
      } catch (e2) {}
      errLine(err, "");
      try {
        const body = { email, password: pass };
        if (DEME_CAPTCHA_KEY) {
          if (!suCaptcha || !suCaptcha.token) {
            errLine(err, "Please complete the verification check above, then try again.");
            return;
          }
          body.gotrue_meta_security = { captcha_token: suCaptcha.token };
        }
        const data = await apiJSON("/auth/v1/signup", {
          method: "POST",
          body: JSON.stringify(body),
        }, "anon");
        if (adoptSession(data)) {
          await afterSignIn();
        } else {
          renderSignedOut("Account created — check your email and confirm it, then sign in. It comes from Deme — if it isn't in your inbox, check spam. Your details are saved on this device and will be attached when you first sign in.", { resend: true, resendEmail: email });
        }
      } catch (e2) {
        /* RT-01: a failed attempt leaves no pending record behind
           for the next person at this browser to inherit. */
        try { localStorage.removeItem(PENDING_KEY); } catch (e3) {}
        resetCaptcha(suCaptcha);
        errLine(err, mapAuthError(e2, "Sign-up didn't go through. Please try again."));
      }
    });

    zone.querySelector("#acc-signin").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = zone.querySelector("#si-err");
      const email = zone.querySelector("#si-email").value.trim();
      const pass = zone.querySelector("#si-pass").value;
      errLine(err, "");
      try {
        const body = { email, password: pass };
        if (DEME_CAPTCHA_KEY) {
          if (!siCaptcha || !siCaptcha.token) {
            errLine(err, "Please complete the verification check above, then try again.");
            return;
          }
          body.gotrue_meta_security = { captcha_token: siCaptcha.token };
        }
        const data = await apiJSON("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify(body),
        }, "anon");
        if (adoptSession(data)) await afterSignIn();
        else {
          resetCaptcha(siCaptcha);
          errLine(err, "Sign-in didn't return a session. Please try again.");
        }
      } catch (e2) {
        resetCaptcha(siCaptcha);
        errLine(err, mapAuthError(e2, "Sign-in didn't go through. Check the email and password."));
      }
    });

    /* Password reset — request half (F-8). The provider only sends
       the email when the address holds an account, and the copy
       shown here is the same either way, so the form can never be
       used to check whether an address is registered (protocol
       I-3). The CAPTCHA gate mirrors the two auth forms: the
       sign-in form's widget supplies the token. */
    const resetBlock = zone.querySelector("#si-reset");
    zone.querySelector("#si-forgot").addEventListener("click", () => {
      resetBlock.hidden = !resetBlock.hidden;
      if (!resetBlock.hidden) {
        const em = zone.querySelector("#si-email").value.trim();
        const sr = zone.querySelector("#sr-email");
        if (em && !sr.value) sr.value = em;
        sr.focus();
      }
    });
    async function sendReset() {
      const err = zone.querySelector("#sr-err");
      const email = zone.querySelector("#sr-email").value.trim();
      if (!email) {
        errLine(err, "Enter the email address for your account first — the reset link needs somewhere to go.");
        return;
      }
      if (DEME_CAPTCHA_KEY && (!siCaptcha || !siCaptcha.token)) {
        errLine(err, "Please complete the verification check above, then try again.");
        return;
      }
      errLine(err, "");
      const body = { email };
      if (DEME_CAPTCHA_KEY) body.gotrue_meta_security = { captcha_token: siCaptcha.token };
      const back = `${window.location.origin}${window.location.pathname}`;
      let res = null;
      try {
        res = await api(`/auth/v1/recover?redirect_to=${encodeURIComponent(back)}`, {
          method: "POST",
          body: JSON.stringify(body),
        }, "anon");
      } catch (e) { res = null; }
      resetCaptcha(siCaptcha);
      if (!res) {
        errLine(err, "That didn't go through — check your connection and try again.");
        return;
      }
      if (res.ok) {
        resetBlock.innerHTML = `<p class="wf-note">If an account exists
          for that email, a reset link is on its way. Check your inbox
          and use it soon — reset links expire — and check your spam
          folder if it doesn't show up in a few minutes. If you didn't
          ask for a reset, you can ignore the email; your password
          hasn't changed.</p>`;
        return;
      }
      let msg = "";
      try {
        const b = await res.json();
        msg = (b && (b.msg || b.message || b.error_description || b.error)) || "";
      } catch (e) { /* keep the house fallback */ }
      /* RT-05: the provider's wording is mapped, never shown raw. */
      errLine(err, mapAuthError({ message: msg, status: res.status },
        "Requesting the reset didn't go through. Please try again."));
    }
    zone.querySelector("#sr-send").addEventListener("click", sendReset);
    zone.querySelector("#sr-email").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sendReset(); }
    });

    /* Resend confirmation (RT-04) — rendered in the post-signup
       state and on explained expired-link landings. The answer
       is existence-blind: the same line whether the address is
       unconfirmed, already confirmed, or unknown to the
       provider, so the form can't be used to probe which
       addresses hold accounts. */
    const rsZone = zone.querySelector("#rs-zone");
    if (rsZone) {
      const rsCaptcha = mountCaptcha(zone.querySelector("#rs-captcha"));
      zone.querySelector("#acc-resend").addEventListener("click", async () => {
        const err = zone.querySelector("#rs-err");
        const email = zone.querySelector("#rs-email").value.trim();
        if (!email) {
          errLine(err, "Enter the email address you signed up with first.");
          return;
        }
        if (DEME_CAPTCHA_KEY && (!rsCaptcha || !rsCaptcha.token)) {
          errLine(err, "Please complete the verification check above, then try again.");
          return;
        }
        errLine(err, "");
        const body = { type: "signup", email };
        if (DEME_CAPTCHA_KEY) body.gotrue_meta_security = { captcha_token: rsCaptcha.token };
        let res = null;
        try {
          res = await api("/auth/v1/resend", {
            method: "POST",
            body: JSON.stringify(body),
          }, "anon");
        } catch (e2) { res = null; }
        resetCaptcha(rsCaptcha);
        if (!res) {
          errLine(err, "That didn't go through — check your connection and try again.");
          return;
        }
        let blind = res.ok;
        if (!res.ok) {
          let msg = "";
          try {
            const b = await res.json();
            msg = (b && (b.msg || b.message || b.error_description || b.error)) || "";
          } catch (e2) { /* handled below */ }
          if (res.status === 429) {
            errLine(err, "Too many attempts just now — wait a few minutes, then try again.");
            return;
          }
          /* An "already confirmed" answer earns the same blind
             line — it confirms nothing a prober can use. */
          if (/confirm/i.test(msg)) blind = true;
        }
        if (blind) {
          rsZone.innerHTML = `<p class="wf-note">If that address has
            an unconfirmed account, a fresh link is on its way. It
            comes from Deme — if it isn't in your inbox, check
            spam.</p>`;
        } else {
          errLine(err, "Resending didn't go through. Please try again.");
        }
      });
    }
  }

  function refreshSyncLine() {
    const el = zone && zone.querySelector("#acc-sync");
    if (el && accountProfile) {
      el.textContent = `Synced — your profile saved ${fmtDate((accountProfile.updated_at || "").slice(0, 10)) || "just now"}.`;
    }
  }

  async function renderSignedIn() {
    if (!zone) return;
    const row = accountProfile || {};
    zone.innerHTML = `<div class="card record-card account-card">
      <p class="kicker">Accounts</p>
      <h2 style="font-size:1.25rem">Your account</h2>
      <p>Signed in as <strong>${esc(session.user.email || "")}</strong>.
      The form below is your account profile — your name, your wards,
      the topics you follow and your Council alerts. Saving it updates
      this device too.</p>
      <p class="small">On a shared computer? Sign out when you're done.</p>
      <p class="small" id="acc-sync"></p>
      <form id="acc-profile" novalidate>
        <div class="field"><label for="ap-name">Name</label>
          <input type="text" id="ap-name" autocomplete="name"
            value="${esc(row.name || "")}"></div>
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
      <div class="account-export">
        <h3>Your account data</h3>
        <p class="small">Download the record Deme holds on its server
        for your account — your name, email of record,
        wards, topics, your alerts opt-in and consent record, and the
        picks you have saved to your account — as a JSON file. This
        device's own copy of your profile is exported separately, with
        the button below this card.</p>
        <p class="toolbar" style="margin:.6rem 0 0">
          <button class="btn secondary" type="button" id="acc-export">Export my account data</button>
        </p>
        <div id="exp-err"></div>
      </div>
      <div class="account-danger">
        <h3>Delete your account</h3>
        <p class="small">Deletes your account and everything Deme holds
        on its server for you — name, email, wards, topics,
        your alerts opt-in, and every pick you have saved to your
        account. The copies of your picks and profile on this device
        are yours and stay unless you erase them below.</p>
        <div id="del-zone">
          <button class="btn danger" type="button" id="acc-del1">Delete my account and data</button>
        </div>
        <p class="small" style="margin:.9rem 0 0">The full list of what
        an account holds, where, and how to delete it: the
        <a href="privacy.html">privacy policy</a>.</p>
      </div>
    </div>`;
    refreshSyncLine();

    const wardFinder = WardFinder.mount(zone.querySelector("#ap-ward"), {
      idPrefix: "ap1", people, label: "Your ward",
      current: row.ward ?? VoteStore.getWard(), noneLabel: "No ward set",
    });
    const watchFinder = WardFinder.mount(zone.querySelector("#ap-watch"), {
      idPrefix: "ap2", people, label: "Also watch a second ward (optional)",
      current: row.watch_ward ?? VoteStore.getWatchWard(),
      exclude: row.ward ?? VoteStore.getWard(), noneLabel: "No second ward",
      inputLabel: "Postal code of the area to watch",
      collapseWhenEmpty: true,
    });
    zone.querySelectorAll("#ap-ints .chip").forEach((b) =>
      b.addEventListener("click", () => b.setAttribute("aria-pressed",
        b.getAttribute("aria-pressed") === "true" ? "false" : "true")));

    zone.querySelector("#acc-profile").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = zone.querySelector("#ap-err");
      const fields = {
        name: zone.querySelector("#ap-name").value.trim(),
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
        notifyRecord();
      } catch (e2) {
        errLine(err, e2.message || "Saving didn't go through. Please try again.");
      }
    });

    zone.querySelector("#acc-export").addEventListener("click", async () => {
      const err = zone.querySelector("#exp-err");
      errLine(err, "");
      try {
        /* Fresh read of the caller's own row (RLS scopes it to the
           caller), plus the email of record from the session — the
           schema holds no email column (F-4); the provider is its
           source. Server record only: no picks, nothing from this
           device beyond what sync already placed in the row. */
        const row = (await fetchRow()) || accountProfile || {};
        let pickRows = [];
        try { pickRows = await fetchPicks(); } catch (e3) { pickRows = []; }
        let watchRowsExport = [];
        try { watchRowsExport = await fetchWatches(); }
        catch (e3) { watchRowsExport = []; }
        const payload = { ...row, email: session.user.email || "",
          picks: pickRows, watches: watchRowsExport };
        /* The postal area was dropped from the profile (owner
           decision, Oct 20, 2026); a row written by an earlier
           build may still carry the retired fsa column — it is
           never part of the export. */
        delete payload.fsa;
        const blob = new Blob(
          [JSON.stringify(payload, null, 2)],
          { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "deme-account-data.json";
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e2) {
        errLine(err, "The export didn't go through just now — please try again in a moment.");
      }
    });

    zone.querySelector("#acc-signout").addEventListener("click", async () => {
      try { await api("/auth/v1/logout", { method: "POST" }); } catch (e) {}
      session = null;
      accountProfile = null;
      saveSession();
      renderSignedOut("Signed out on this device. Your local profile and picks stay on this device, and your account keeps its copies for your next sign-in.");
      refreshAlertsBox();
      notifyRecord();
      notifyWatchSurfaces();
    });

    const delZone = zone.querySelector("#del-zone");
    zone.querySelector("#acc-del1").addEventListener("click", () => {
      delZone.innerHTML = `
        <p class="wf-note"><strong>This cannot be undone.</strong> Your
        account and its server-held data will be deleted.</p>
        <div class="field"><label for="del-pass">Enter your password to confirm</label>
          <input type="password" id="del-pass" autocomplete="current-password">
          <p class="small">Deleting is permanent, so we check it's
          really you. Your password goes only to our sign-in
          provider, exactly as it does when you sign in.</p></div>
        <div class="captcha-slot" id="del-captcha"></div>
        <p class="toolbar" style="margin:.6rem 0 0">
          <button class="btn danger" type="button" id="acc-del2">Yes — delete my account and data</button>
          <button class="btn secondary" type="button" id="acc-del-cancel">Keep my account</button>
        </p>
        <div id="del-err"></div>`;
      /* The CAPTCHA widget mounts here so the step-up check keeps
         working once protection is on (the password grant is a
         sign-in request there too). Inert while no key is set. */
      const delCaptcha = mountCaptcha(delZone.querySelector("#del-captcha"));
      delZone.querySelector("#acc-del-cancel").addEventListener("click", renderSignedIn);
      delZone.querySelector("#acc-del2").addEventListener("click", async () => {
        const err = delZone.querySelector("#del-err");
        /* RT-03 step-up: the session in this browser is ambient —
           on a shared computer, whoever sits down next inherits
           it. Prove knowledge of the account password before the
           destructive call; a failed check deletes nothing. The
           session the check returns is deliberately NOT adopted:
           this session authorizes the delete, and both end with
           the account. */
        const pw = delZone.querySelector("#del-pass").value;
        if (!pw) {
          errLine(err, "Enter your password above — deleting is permanent, so we check it's really you first.");
          return;
        }
        if (DEME_CAPTCHA_KEY && (!delCaptcha || !delCaptcha.token)) {
          errLine(err, "Please complete the verification check above, then try again.");
          return;
        }
        errLine(err, "");
        try {
          const body = { email: session.user.email, password: pw };
          if (DEME_CAPTCHA_KEY) body.gotrue_meta_security = { captcha_token: delCaptcha.token };
          await apiJSON("/auth/v1/token?grant_type=password", {
            method: "POST",
            body: JSON.stringify(body),
          }, "anon");
        } catch (e3) {
          resetCaptcha(delCaptcha);
          errLine(err, "That password didn't check out — nothing has been deleted.");
          return;
        }
        resetCaptcha(delCaptcha);
        try {
          const res = await api("/functions/v1/delete-account", { method: "POST", body: "{}" });
          if (!res.ok) throw new Error(`(${res.status})`);
          session = null;
          accountProfile = null;
          saveSession();
          try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
          renderSignedOut("Your account and its server-held data — including every pick saved to your account — are deleted. Your local profile and picks remain on this device — erase them any time with the button below.");
          refreshAlertsBox();
          /* The watches rows cascade-delete with the auth user
             (watches.user_id references auth.users on delete
             cascade) — nothing watch-specific to call here. */
          watchRows = [];
          try { localStorage.removeItem(WATCH_CACHE_KEY); } catch (e) {}
          notifyRecord();
          notifyWatchSurfaces();
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
    await renderSignedIn();
    refreshAlertsBox();
    await bootstrapPicks();
    await bootstrapWatches();
    settleAuthReady();
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
    /* One route, told once (OE-4; separate form route retired by
       owner decision, Oct 20, 2026): Council alerts are a benefit
       of the account above — you opt in when you create the
       account, or turn alerts on later in the account settings,
       and the digest follows the wards and topics on your
       profile. There is no separate form. */
    box.innerHTML = `<h3>Council alerts by email</h3>
      <p>Council alerts are part of a free Deme account: the digest
      follows the wards and topics on your profile, and you opt in
      when you create your account — or turn them on any time from
      <a href="#account-zone">your account</a> above. Sign-ups are
      open now — digests haven't started yet, and they begin with
      the new Council term.</p>
      <p class="small">When digests start, it will be one digest
      per Council agenda, never one email per item, and a person
      reviews every digest before it goes out. Nothing is sent
      until digests begin. Turn alerts off any time in your account
      settings; every digest also carries an unsubscribe link.</p>`;
  }
  function refreshAlertsBox() {
    const box = document.getElementById("profile-alerts");
    if (box && enabled()) renderAlerts(box);
    if (window.DemeRecord && window.DemeRecord.refreshProfileSummary) {
      window.DemeRecord.refreshProfileSummary();
    }
  }

  /* ---------------- password reset — landing (F-8) ----------------
     The reset email's link verifies at the provider and lands back
     on this page with the recovery session in the URL fragment
     (#access_token=…&type=recovery). boot() consumes the fragment
     before anything renders and clears it from the address bar —
     tokens shouldn't linger there — then shows the set-new-password
     form in place of the usual panels. A fragment carrying a
     provider error instead means the link expired or was already
     used. Setting the password goes through the authenticated user
     update on that recovery session, and success hands over to the
     normal signed-in flow (afterSignIn). */
  const RESET_STALE_NOTE = 'That reset link has expired or already '
    + 'been used. Get a fresh one with the "Forgot your password?" '
    + 'link under the sign-in form.';
  /* RT-04: an error fragment can equally arrive from an expired
     confirmation link. This note covers both doors, and the
     resend block renders with it, so the landing explains
     itself instead of dead-ending unexplained. */
  const LINK_STALE_NOTE = "That email link has expired or already "
    + "been used. If it was your confirmation link, resend a "
    + "fresh one below; if it was a reset link, get a fresh one "
    + "with the \"Forgot your password?\" link under the sign-in "
    + "form.";

  function parseRecoveryHash() {
    const h = window.location.hash || "";
    if (h.length < 2) return null;
    const params = new URLSearchParams(h.slice(1));
    const failed = params.get("error") || params.get("error_code");
    if (!failed && params.get("type") !== "recovery") return null;
    try {
      history.replaceState(null, "",
        window.location.pathname + window.location.search);
    } catch (e) { /* fragment stays; harmless */ }
    if (failed) return { kind: "error" };
    const access = params.get("access_token");
    if (!access) return { kind: "error" };
    return {
      kind: "session",
      access_token: access,
      refresh_token: params.get("refresh_token") || "",
      expires_in: Number(params.get("expires_in")) || 3600,
    };
  }

  function renderRecovery() {
    if (!zone) return;
    zone.innerHTML = `<div class="card record-card account-card">
      <p class="kicker">Accounts</p>
      <h2 style="font-size:1.25rem">Set a new password</h2>
      <p>You're setting a new password for
      <strong>${esc(session.user.email || "")}</strong>. Once it's
      set, you're signed in on this device.</p>
      <form id="acc-newpass" class="account-form" novalidate>
        <div class="field"><label for="np-pass">New password</label>
          <input type="password" id="np-pass" autocomplete="new-password" required>
          <p class="small">Set and checked by our sign-in provider —
          Deme never sees or stores it.</p></div>
        <div class="field"><label for="np-pass2">Type the new password again</label>
          <input type="password" id="np-pass2" autocomplete="new-password" required></div>
        <div id="np-err"></div>
        <p style="margin:.8rem 0 0"><button class="btn" type="submit">Set new password</button></p>
      </form>
      <p class="small" style="margin:.9rem 0 0">What an account holds,
      where it is held, and how to delete it is set out in the
      <a href="privacy.html">privacy policy</a>.</p>
    </div>`;
    zone.querySelector("#acc-newpass").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = zone.querySelector("#np-err");
      const pass = zone.querySelector("#np-pass").value;
      const pass2 = zone.querySelector("#np-pass2").value;
      if (!pass || !pass2) {
        errLine(err, "Choose a new password and type it in both boxes.");
        return;
      }
      if (pass !== pass2) {
        errLine(err, "The two passwords don't match yet — type the same new password in both boxes.");
        return;
      }
      if (pass.length < 10) {
        errLine(err, "That password is too short — passwords need at least 10 characters.");
        return;
      }
      errLine(err, "");
      try {
        await authedJSON("/auth/v1/user", {
          method: "PUT",
          body: JSON.stringify({ password: pass }),
        });
        await afterSignIn();
      } catch (e2) {
        if (e2.status === 401 || e2.status === 403) {
          session = null;
          saveSession();
          renderSignedOut(RESET_STALE_NOTE);
          refreshAlertsBox();
        } else {
          errLine(err, mapAuthError(e2, "Setting the new password didn't go through. Please try again."));
        }
      }
    });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    if (booted) { settleAuthReady(); return; }
    booted = true;
    /* Pages without the account panel (Home) still boot: the
       session restore and the picks/watches bootstraps below are
       what Home's watch toggles read, and every panel render is
       zone-guarded into a no-op there. (Oct 21, 2026: boot used
       to return early without a panel, which left Home's toggles
       permanently signed-out.) */
    if (!enabled()) { renderDisabled(); settleAuthReady(); return; }

    /* Accounts are live, so the "no server and no account" line no
       longer describes the whole page: swap in the re-scoped copy
       (full text in WARD-FINDER-REPORT.md). This only ever runs when
       the account layer is activated. */
    const note = document.getElementById("local-note");
    if (note) {
      note.textContent = "Signed in, your picks save to your account "
        + "and stay on this device too; signed out, they live only in "
        + "this browser. With an account, your name, email, wards, "
        + "topics and picks are also held on our server so they can "
        + "follow you — the privacy policy lists exactly what's held "
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
    /* A password-reset landing (F-8) outranks the stored session —
       the visitor arrived from a link in their own inbox. Its error
       form (expired or used link) falls through to the stored
       session if there is one, and otherwise explains itself on the
       signed-out panel. */
    const recovery = parseRecoveryHash();
    let landed = false;
    if (recovery && recovery.kind === "session") {
      session = {
        access_token: recovery.access_token,
        refresh_token: recovery.refresh_token,
        expires_at: Date.now() + recovery.expires_in * 1000,
        user: null,
      };
      try {
        session.user = await apiJSON("/auth/v1/user");
        saveSession();
        renderRecovery();
        landed = true;
      } catch (e) {
        session = null;
        saveSession();
      }
    }
    if (!landed) {
      if (session) {
        if (session.expires_at < Date.now() + 30000) {
          if (!await refreshSession()) {
            session = null;
            saveSession();
          }
        }
      }
      if (session) {
        /* Stored-session restore runs the SAME profile bootstrap
           as a form sign-in (afterSignIn): fetch the row AND
           mirror it into this device's VoteStore. A bare fetchRow
           here left a returning user on a fresh device/browser
           with an empty local store — every ward/topic surface
           read "No home ward set · No topics followed" — until a
           form sign-in happened to run the bootstrap.
           bootstrapProfile owns the arbitration (newer of server
           row / local profile wins) and lastSyncedStamp, exactly
           as on the sign-in path; a failure leaves the panel on
           its null-profile fallback, as the bare fetch did.
           Picks are untouched here: applyToLocal writes profile
           fields only, and bootstrapPicks below runs after, in
           the same order as the sign-in path. */
        try {
          await bootstrapProfile();
        } catch (e) { accountProfile = null; /* row loads on a later visit */ }
        await renderSignedIn();
      } else if (recovery && recovery.kind === "error") {
        renderSignedOut(LINK_STALE_NOTE, { resend: true });
      } else if (recovery) {
        renderSignedOut(RESET_STALE_NOTE);
      } else {
        renderSignedOut();
      }
    }
    if (session) { await bootstrapPicks(); await bootstrapWatches(); }
    settleAuthReady();
    notifyWatchSurfaces();
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

  return { enabled, renderAlerts, alertsOptIn, isSignedIn,
    authReady, syncPick, bootstrapPicks,
    syncWatch, getWatches, isWatching, isStaleWatch, bootstrapWatches };
})();

window.DemeAccount = DemeAccount;
