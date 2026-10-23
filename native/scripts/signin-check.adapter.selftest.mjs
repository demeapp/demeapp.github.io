#!/usr/bin/env node
// Tests the PAGE-SIDE adapter against a STUB of the live page: a tiny fake DOM plus a fake "account.js"
// and fake backend written from the owner's description. It proves the adapter's logic and that nothing
// sensitive is returned; it does NOT prove the real page matches the stub.
//   node native/scripts/signin-check.adapter.selftest.mjs
import vm from 'node:vm';
import * as adapter from './signin-check.adapter.mjs';
import { sanitize } from './signin-check.mjs';

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const EMAIL = 'canary.user+ci@example.test', PASSWORD = 'Canary-Passw0rd-XYZ123', ACCESS = 'ACCESS.CANARY.VALUE', CAPTCHA = 'CAPTCHA-CANARY-TOKEN';
const SUPA = 'https://stub.supabase.test';

function makePage(cfg = {}) {
  const calls = [];
  const store = new Map();
  let signedIn = !!cfg.initialSignedIn;
  const setSession = (email) => store.set('deme.account.v1', JSON.stringify({ access_token: ACCESS, user: { id: 'uid-1', email } }));
  if (signedIn) setSession(EMAIL);

  class El {
    constructor(id, tag = 'INPUT') { this.id = id; this.tagName = tag; this.value = ''; this.checked = false; this.options = []; this.form = null; this._q = {}; this.onclick = null; }
    dispatchEvent() {} click() { if (this.onclick) this.onclick(); } querySelector(sel) { return this._q[sel] || null; }
    requestSubmit() { if (this.onsubmit) this.onsubmit(); } checkValidity() { return !cfg.invalidForm; }
  }
  const makeCaptcha = (id) => {
    const c = new El(id, 'DIV');
    if (cfg.turnstile === 'noiframe') return { c, input: null };
    const input = new El(id + '-resp'); c._q['input[name="cf-turnstile-response"]'] = input; c._q['iframe'] = { tag: 'iframe' };
    return { c, input };
  };
  const solve = (cap) => { if (cap.input && cfg.turnstile !== 'never') setTimeout(() => { cap.input.value = CAPTCHA; }, 300); };
  const suCap = makeCaptcha('su-captcha'), siCap = makeCaptcha('si-captcha'); solve(suCap); solve(siCap);

  const out = {};
  for (const id of ['su-email', 'su-pass', 'su-name', 'si-email', 'si-pass']) out[id] = new El(id);
  out['su-ward'] = new El('su-ward', 'SELECT'); out['su-ward'].options = [{ value: '' }, { value: '3' }];
  out['su-alerts'] = new El('su-alerts'); out['su-alerts'].checked = true; out['su-watch'] = new El('su-watch'); out['su-watch'].checked = true;
  const suForm = new El('su-form', 'FORM'), siForm = new El('acc-signin', 'FORM');
  out['su-email'].form = suForm; out['si-email'].form = siForm;
  out['su-captcha'] = suCap.c; out['si-captcha'] = siCap.c; out['acc-signin'] = siForm;
  out['account-zone'] = new El('account-zone', 'DIV');
  const signoutBtn = new El('acc-signout', 'BUTTON');
  const zoneOnly = { 'account-zone': out['account-zone'], 'acc-signout': signoutBtn };

  const respond = (status, body) => ({ status, clone() { return { json: () => Promise.resolve(body) }; }, json: () => Promise.resolve(body) });
  const backend = (url, init) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ path, auth: init && init.headers && init.headers.Authorization, body: init && init.body });
    const bearerOk = init && init.headers && init.headers.Authorization === 'Bearer ' + ACCESS;
    if (path.startsWith('/auth/v1/signup')) {
      const m = cfg.signup || 'confirm';
      if (m === 'confirm') return respond(200, { user: { id: 'u1', identities: [{}] } });
      if (m === 'noconfirm') { setSession(JSON.parse(init.body).email); signedIn = true; return respond(200, { access_token: ACCESS, user: { id: 'uid-1', email: EMAIL, identities: [{}] } }); }
      if (m === 'exists') return respond(200, { user: { id: 'u2', identities: [] } });
      if (m === 'ratelimit') return respond(429, { error_code: 'over_request_rate_limit' });
      return respond(400, { error_code: 'captcha_failed' });
    }
    if (path.startsWith('/auth/v1/token')) {
      const m = cfg.signin || 'ok';
      if (m === 'ok') { setSession(JSON.parse(init.body).email); signedIn = true; return respond(200, { access_token: ACCESS, user: { id: 'uid-1', email: EMAIL } }); }
      if (m === 'unconfirmed') return respond(400, { error_code: 'email_not_confirmed' });
      return respond(400, { error_code: 'invalid_credentials' });
    }
    if (path.startsWith('/auth/v1/logout')) return respond(204, null);
    if (path.startsWith('/rest/v1/picks')) return bearerOk ? respond(200, path.includes('item_ref=eq.') && cfg.pick ? [{ position: 'support' }] : []) : respond(401, {});
    if (path.startsWith('/functions/v1/delete-account')) return bearerOk ? respond(cfg.deleteStatus || 200, {}) : respond(401, {});
    return respond(404, {});
  };
  const submit = (cap, emailEl, passEl, endpoint) => () => {
    const tok = cap.input && cap.input.value;
    if (!tok || !emailEl.value || !passEl.value) return;
    ctx.window.fetch(SUPA + endpoint, { method: 'POST', body: JSON.stringify({ email: emailEl.value, password: passEl.value, gotrue_meta_security: { captcha_token: tok } }) });
    cap.input.value = ''; solve(cap);
  };
  suForm.onsubmit = submit(suCap, out['su-email'], out['su-pass'], '/auth/v1/signup');
  siForm.onsubmit = submit(siCap, out['si-email'], out['si-pass'], '/auth/v1/token?grant_type=password');
  signoutBtn.onclick = () => { ctx.window.fetch(SUPA + '/auth/v1/logout', { method: 'POST', body: '{}' }); store.delete('deme.account.v1'); signedIn = false; };

  const ctx = vm.createContext({
    document: { getElementById: (id) => (signedIn ? zoneOnly : out)[id] || null },
    Event: class { constructor(t) { this.type = t; } }, setTimeout, Date, URL, JSON, Promise, Array, Object, String, encodeURIComponent,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    location: { href: 'https://demeapp.github.io/my-record.html', pathname: '/my-record.html' },
    DEME_SUPABASE_URL: SUPA, DEME_SUPABASE_ANON_KEY: 'anon-stub', DEME_CAPTCHA_KEY: 'site-stub',
    fetch: (input, init) => Promise.resolve(backend(String(input), init || {})),
  });
  ctx.window = ctx;
  if (cfg.noCaptchaKey) delete ctx.DEME_CAPTCHA_KEY;
  const run = async (op, args) => JSON.parse(await vm.runInContext(adapter[op](args), ctx));
  return { run, calls, ctx, store };
}
const cred = { email: EMAIL, password: PASSWORD, seconds: 3, early: 1 };
const all = [];
const rec = (op, o) => { all.push(JSON.stringify(o)); return o; };

// preflight
let p = makePage();
let r = rec('preflight', await p.run('preflight', {}));
check('preflight: ready when globals and #account-zone exist', r.state === 'ready');
r = rec('preflight', await makePage({ noCaptchaKey: true }).run('preflight', {}));
check('preflight: names a missing global', r.state === 'missing' && r.missing.includes('DEME_CAPTCHA_KEY'));

// turnstile probe
p = makePage({ turnstile: 'solves' });
r = rec('signOut', await p.run('signOut', {}));
check('signOut on an already signed-out page', r.state === 'signed-out');
r = rec('probe', await p.run('turnstileProbe', { seconds: 3, early: 1 }));
check('turnstileProbe: widget solves -> token', r.state === 'token');
r = rec('probe', await makePage({ turnstile: 'never' }).run('turnstileProbe', { seconds: 1, early: 1 }));
check('turnstileProbe: widget never solves -> timeout', r.state === 'timeout');
r = rec('probe', await makePage({ turnstile: 'noiframe' }).run('turnstileProbe', { seconds: 1, early: 1 }));
check('turnstileProbe: no widget at all -> blocked', r.state === 'blocked');

// sign out from a signed-in page
p = makePage({ initialSignedIn: true });
r = rec('signOut', await p.run('signOut', {}));
check('signOut from a signed-in page clears UI and stored session', r.state === 'signed-out' && !p.store.has('deme.account.v1'));

// full flow (the confirmation-OFF path; unexercised in production while confirmation is on)
p = makePage({ signup: 'noconfirm', signin: 'ok', pick: true });
await p.run('signOut', {});
r = rec('signUp', await p.run('signUp', cred));
check('signUp (no confirmation) -> signed-up, HTTP 200', r.state === 'signed-up' && r.status === 200 && r.turnstile === 'ok');
const body = p.calls.find((c) => c.path.startsWith('/auth/v1/signup')).body;
check('signUp: the page received credentials and a captcha token; profile toggles forced off', body.includes(PASSWORD) && body.includes(CAPTCHA) && p.ctx.document.getElementById('su-alerts') === null);
r = rec('signOut', await p.run('signOut', {}));
check('signOut after sign-up', r.state === 'signed-out');
check('signup toggles were unchecked before submit', p.ctx.document.getElementById('su-alerts').checked === false && p.ctx.document.getElementById('su-watch').checked === false);
r = rec('signIn', await p.run('signIn', cred));
check('signIn -> signed-in, HTTP 200', r.state === 'signed-in' && r.status === 200);
r = rec('verify', await p.run('verifySession', {}));
check('verifySession -> ok, UI shows account, picks read 200', r.state === 'ok' && r.ui === true && r.picksStatus === 200);
r = rec('weighIn', await p.run('weighIn', { item: 'x' }));
check('weighIn -> ui-missing until record.js details exist', r.state === 'ui-missing');
r = rec('readPick', await p.run('readPick', { item: 'item-1' }));
check('readPick -> persisted when the backend returns a row', r.state === 'persisted');
r = rec('readPick', await makePage({ signup: 'noconfirm', pick: false }).run('readPick', { item: 'x' }));
check('readPick -> missing when not signed in', r.state === 'missing');
const before = p.calls.length;
r = rec('delete', await p.run('deleteAccount', { email: 'someone.else@example.test' }));
check('deleteAccount REFUSES a different email and makes no call', r.state === 'fail' && p.calls.length === before);
r = rec('delete', await p.run('deleteAccount', { email: EMAIL.toUpperCase() }));
check('deleteAccount deletes the matching account (case-insensitive)', r.state === 'deleted' && p.calls.some((c) => c.path.startsWith('/functions/v1/delete-account')));
r = rec('delete', await makePage().run('deleteAccount', { email: EMAIL }));
check('deleteAccount with no session -> not-signed-in', r.state === 'not-signed-in');

// sign-up outcomes
for (const [mode, want, code] of [['confirm', 'confirmation-required'], ['exists', 'already-registered'], ['ratelimit', 'rate-limited', 'over_request_rate_limit'], ['captchafail', 'rejected', 'captcha_failed']]) {
  p = makePage({ signup: mode }); r = rec('signUp', await p.run('signUp', cred));
  check(`signUp scenario ${mode} -> ${want}`, r.state === want && (!code || r.code === code), JSON.stringify(r));
}
r = rec('signUp', await makePage({ signup: 'confirm', turnstile: 'never' }).run('signUp', { ...cred, seconds: 1 }));
check('signUp with no Turnstile token -> rejected + turnstile timeout, no request sent', r.state === 'rejected' && r.turnstile === 'timeout');
p = makePage({ invalidForm: true }); r = rec('signUp', await p.run('signUp', cred));
check('signUp when the form cannot validate -> ui-missing', r.state === 'ui-missing');

// sign-in outcomes
r = rec('signIn', await makePage({ signin: 'invalid' }).run('signIn', cred));
check('signIn invalid credentials -> rejected 400 invalid_credentials', r.state === 'rejected' && r.status === 400 && r.code === 'invalid_credentials');
r = rec('signIn', await makePage({ signin: 'unconfirmed' }).run('signIn', cred));
check('signIn unconfirmed email -> confirmation-required', r.state === 'confirmation-required');

// vocabulary and secrecy
const ops = { preflight: {}, signOut: {}, turnstileProbe: { seconds: 1, early: 1 }, signUp: cred, signIn: cred, verifySession: {}, weighIn: { item: 'x' }, readPick: { item: 'x' }, deleteAccount: { email: EMAIL } };
p = makePage({ signup: 'noconfirm', signin: 'ok', pick: true });
let bad = 0;
for (const [op, args] of Object.entries(ops)) {
  const raw = await vm.runInContext(adapter[op](args), p.ctx); all.push(raw);
  if (sanitize(op, raw).state === 'malformed') bad++;
}
check('every op returns a state inside the script vocabulary', bad === 0, `(${bad} malformed)`);
const joined = all.join('|') + JSON.stringify(p.ctx.__dcLog || []);
check('nothing sensitive is returned or logged by the page-side hook (password, tokens, email)', ![PASSWORD, ACCESS, CAPTCHA, EMAIL].some((x) => joined.includes(x)));
check('hook entries hold only path, status and flags', (p.ctx.__dcLog || []).every((e) => Object.keys(e).sort().join() === 'ec,emptyIdent,p,s,sess'));

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
