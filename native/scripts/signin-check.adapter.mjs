// Page-side adapter for signin-check.mjs, written against assets/js/account.js as described by the
// owner (ids, endpoints, localStorage key "deme.account.v1"). Each op is a real function here (so Node
// syntax-checks it) that is serialized and evaluated INSIDE the live page; it returns a JSON string
// {state, ...}. signin-check.mjs keeps only a fixed vocabulary of states/codes/status numbers, so
// tokens, passwords and session data cannot reach the log. Credentials are used inside the page only:
// never written to the DOM beyond the site's own form fields, never returned.
// Unverified against the real page: every selector and flow below comes from a description.

export const startPath = '/my-record.html';

// ---- runs inside the page; returns the helper toolbox ----
function helpers() {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var waitFor = async function (fn, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) { var v = fn(); if (v) return v; await sleep(250); }
    return fn() || null;
  };
  var $ = function (id) { return document.getElementById(id); };
  var setVal = function (el, v) {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  // Record ONLY path, status and a few booleans/error codes of auth calls: never bodies or tokens.
  if (!window.__dcHook) {
    window.__dcLog = [];
    var origFetch = window.fetch;
    window.fetch = function (input) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = ''; try { p = new URL(url, location.href).pathname; } catch (e) {}
      return origFetch.apply(this, arguments).then(function (res) {
        try {
          var entry = { p: p, s: res.status, sess: false, emptyIdent: false, ec: '' };
          res.clone().json().then(function (b) {
            entry.sess = !!(b && b.access_token);
            entry.emptyIdent = !!(b && b.user && Array.isArray(b.user.identities) && b.user.identities.length === 0);
            entry.ec = b && typeof b.error_code === 'string' ? b.error_code : (b && typeof b.code === 'string' ? b.code : '');
          }).catch(function () {});
          window.__dcLog.push(entry);
        } catch (e) {}
        return res;
      });
    };
    window.__dcHook = true;
  }
  var lastLog = function (path) {
    for (var i = window.__dcLog.length - 1; i >= 0; i--) if (window.__dcLog[i].p === path) return window.__dcLog[i];
    return null;
  };
  var session = function () {
    try { var s = JSON.parse(localStorage.getItem('deme.account.v1') || 'null'); return s && typeof s === 'object' ? s : null; }
    catch (e) { return null; }
  };
  var tokenOf = function (s) { return (s && (s.access_token || (s.session && s.session.access_token))) || ''; };
  var uidOf = function (s) { return (s && ((s.user && s.user.id) || s.user_id || (s.session && s.session.user && s.session.user.id))) || ''; };
  var emailOf = function (s) { return (s && ((s.user && s.user.email) || s.email || (s.session && s.session.user && s.session.user.email))) || ''; };
  // Turnstile (explicit render into a container): ok = the widget's hidden response input is filled.
  var captcha = async function (containerId, seconds, earlySeconds) {
    var c = $(containerId);
    if (!c) return 'ui-missing';
    var has = function () { var i = c.querySelector('input[name="cf-turnstile-response"]'); return i && i.value && i.value.length > 0; };
    var early = Date.now() + (earlySeconds || 10) * 1000;
    while (Date.now() < early) { if (has()) return 'ok'; if (c.querySelector('iframe')) break; await sleep(250); }
    if (!has() && !c.querySelector('iframe') && !c.querySelector('input[name="cf-turnstile-response"]')) return 'blocked';
    return (await waitFor(has, seconds * 1000)) ? 'ok' : 'timeout';
  };
  var rest = async function (path, init) {
    var t = tokenOf(session());
    if (!t) return null;
    init = init || {};
    init.headers = Object.assign({ apikey: DEME_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + t }, init.headers || {});
    return fetch(DEME_SUPABASE_URL + path, init);
  };
  return { sleep: sleep, waitFor: waitFor, $: $, setVal: setVal, lastLog: lastLog, session: session, tokenOf: tokenOf,
    uidOf: uidOf, emailOf: emailOf, captcha: captcha, rest: rest };
}

// ---- page-side ops: (args, H) -> JSON string ----
const J = (o) => JSON.stringify(o);

async function preflightPage(a, H) {
  var missing = [];
  if (typeof DEME_SUPABASE_URL !== 'string') missing.push('DEME_SUPABASE_URL');
  if (typeof DEME_SUPABASE_ANON_KEY !== 'string') missing.push('DEME_SUPABASE_ANON_KEY');
  if (typeof DEME_CAPTCHA_KEY !== 'string') missing.push('DEME_CAPTCHA_KEY');
  if (!(await H.waitFor(function () { return H.$('account-zone'); }, 15000))) missing.push('#account-zone');
  return JSON.stringify({ state: missing.length ? 'missing' : 'ready', missing: missing });
}

async function signOutPage(a, H) {
  await H.waitFor(function () { return H.$('acc-signin') || H.$('su-email') || H.$('acc-signout'); }, 15000);
  if (H.$('acc-signout')) {
    H.$('acc-signout').click();
    await H.waitFor(function () { return !H.$('acc-signout') && (H.$('acc-signin') || H.$('su-email')); }, 15000);
  }
  try { localStorage.removeItem('deme.account.v1'); } catch (e) {}
  var ok = !H.$('acc-signout') && (H.$('acc-signin') || H.$('su-email')) && !H.session();
  return JSON.stringify({ state: ok ? 'signed-out' : 'unconfirmed' });
}

async function turnstileProbePage(a, H) {
  if (!(await H.waitFor(function () { return H.$('acc-signin'); }, 15000))) return JSON.stringify({ state: 'ui-missing' });
  var c = await H.captcha('si-captcha', a.seconds, a.early);
  return JSON.stringify({ state: c === 'ok' ? 'token' : c });
}

async function signUpPage(a, H) {
  var ready = await H.waitFor(function () { return H.$('su-email') && H.$('su-pass'); }, 15000);
  if (!ready) return JSON.stringify({ state: 'ui-missing' });
  var form = H.$('su-email').form;
  if (!form) return JSON.stringify({ state: 'ui-missing' });
  H.setVal(H.$('su-email'), a.email);
  H.setVal(H.$('su-pass'), a.password);
  var nm = H.$('su-name'); if (nm && !nm.value) H.setVal(nm, 'Deme CI check');
  var wd = H.$('su-ward');
  if (wd && wd.tagName === 'SELECT' && !wd.value) {
    for (var i = 0; i < wd.options.length; i++) { if (wd.options[i].value) { wd.value = wd.options[i].value; wd.dispatchEvent(new Event('change', { bubbles: true })); break; } }
  }
  ['su-alerts', 'su-watch'].forEach(function (id) { var t = H.$(id); if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); } });
  if (!form.checkValidity()) return JSON.stringify({ state: 'ui-missing' });
  var cs = await H.captcha('su-captcha', a.seconds, a.early);
  if (cs === 'ui-missing') return JSON.stringify({ state: 'ui-missing' });
  if (cs !== 'ok') return JSON.stringify({ state: 'rejected', turnstile: cs });
  window.__dcLog.length = 0;
  form.requestSubmit();
  var e = await H.waitFor(function () { return H.lastLog('/auth/v1/signup'); }, 30000);
  if (!e) return JSON.stringify({ state: 'unobserved' });
  await H.sleep(400);
  var out = { turnstile: 'ok', status: e.s, code: e.ec };
  if (e.s === 429) out.state = 'rate-limited';
  else if (e.s === 422 && e.ec === 'user_already_exists') out.state = 'already-registered';
  else if (e.s === 200 || e.s === 201) out.state = e.sess ? 'signed-up' : (e.emptyIdent ? 'already-registered' : 'confirmation-required');
  else out.state = 'rejected';
  return JSON.stringify(out);
}

async function signInPage(a, H) {
  var ready = await H.waitFor(function () { return H.$('si-email') && H.$('si-pass') && H.$('acc-signin'); }, 15000);
  if (!ready) return JSON.stringify({ state: 'ui-missing' });
  var form = H.$('acc-signin');
  H.setVal(H.$('si-email'), a.email);
  H.setVal(H.$('si-pass'), a.password);
  var cs = await H.captcha('si-captcha', a.seconds, a.early);
  if (cs === 'ui-missing') return JSON.stringify({ state: 'ui-missing' });
  if (cs !== 'ok') return JSON.stringify({ state: 'rejected', turnstile: cs });
  window.__dcLog.length = 0;
  form.requestSubmit();
  var e = await H.waitFor(function () { return H.lastLog('/auth/v1/token'); }, 30000);
  if (!e) return JSON.stringify({ state: 'unobserved' });
  await H.sleep(400);
  var out = { turnstile: 'ok', status: e.s, code: e.ec };
  if (e.s === 429) out.state = 'rate-limited';
  else if (e.ec === 'email_not_confirmed') out.state = 'confirmation-required';
  else if (e.s === 200) out.state = (await H.waitFor(function () { return H.$('acc-signout'); }, 15000)) ? 'signed-in' : 'rejected';
  else out.state = 'rejected';
  return JSON.stringify(out);
}

async function verifySessionPage(a, H) {
  var ui = !!(await H.waitFor(function () { return H.$('acc-signout'); }, 10000));
  var s = H.session(), uid = H.uidOf(s);
  if (!H.tokenOf(s) || !uid) return JSON.stringify({ state: 'unobserved', ui: ui });
  var r = await H.rest('/rest/v1/picks?user_id=eq.' + encodeURIComponent(uid) + '&select=item_ref&limit=1');
  return JSON.stringify({ state: r && r.status === 200 && ui ? 'ok' : 'fail', ui: ui, picksStatus: r ? r.status : 0 });
}

// NEEDS record.js details: the weigh-in card markup keyed by item_ref and the position control.
// Until those are supplied this step reports ui-missing (blocked, not a failure). Also: no upcoming
// items are published during the election recess, so this step cannot run yet in any case.
async function weighInPage() {
  return JSON.stringify({ state: 'ui-missing' });
}

async function readPickPage(a, H) {
  var uid = H.uidOf(H.session());
  if (!uid) return JSON.stringify({ state: 'missing' });
  var r = await H.rest('/rest/v1/picks?user_id=eq.' + encodeURIComponent(uid) + '&item_ref=eq.' + encodeURIComponent(a.item) + '&select=position');
  var rows = [];
  try { rows = r && r.status === 200 ? await r.json() : []; } catch (e) {}
  return JSON.stringify({ state: Array.isArray(rows) && rows.length > 0 ? 'persisted' : 'missing' });
}

// Cleanup. Calls the delete-account function with the session's own bearer token (this BYPASSES the
// site's re-authentication screen; unverified that the function accepts that). Refuses unless the
// signed-in user's email equals the test email, so it can never delete any other account.
async function deleteAccountPage(a, H) {
  var s = H.session();
  if (!H.tokenOf(s)) return JSON.stringify({ state: 'not-signed-in' });
  var em = H.emailOf(s);
  if (!em || String(em).toLowerCase() !== String(a.email).toLowerCase()) return JSON.stringify({ state: 'fail' });
  var r = await H.rest('/functions/v1/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return JSON.stringify({ state: r && (r.status === 200 || r.status === 204) ? 'deleted' : 'fail' });
}

// ---- serialization into a page expression ----
const wrap = (fn, args) => '(async function () { var H = (' + helpers.toString() + ')(); return await (' + fn.toString() + ')(' + J(args || {}) + ', H); })()';
export const preflight = (a) => wrap(preflightPage, a);
export const signOut = (a) => wrap(signOutPage, a);
export const turnstileProbe = (a) => wrap(turnstileProbePage, a);
export const signUp = (a) => wrap(signUpPage, a);
export const signIn = (a) => wrap(signInPage, a);
export const verifySession = (a) => wrap(verifySessionPage, a);
export const weighIn = (a) => wrap(weighInPage, a);
export const readPick = (a) => wrap(readPickPage, a);
export const deleteAccount = (a) => wrap(deleteAccountPage, a);
