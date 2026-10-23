#!/usr/bin/env node
// Android sign-in check (DEBUG builds only). Drives the live site inside the app's WebView over
// the Chrome DevTools protocol: sign up a throwaway account, sign out, sign in, verify the session,
// weigh in on one item, confirm it persisted, then delete the account.
// Sibling of bridge-check.mjs. Usage: node native/scripts/signin-check.mjs | tee signin-check.log
// MODES (SIGNIN_CHECK_MODE): "turnstile" (DEFAULT, read-only: signs out locally and asks whether the
//   sign-in Turnstile widget produces a token inside the app; creates nothing, needs no credentials) or
//   "full" (explicit opt-in: signs up and deletes a REAL user on the production backend each run).
// Exit codes: 0 PASS | 1 FAIL (an app step failed) | 2 BLOCKED (environment: no Turnstile token,
//             confirmation required, rate limit, stale account, adapter incomplete, adb/socket/page problems)
// SECRETS: the password, email, tokens and session data are never printed. Only fixed state names,
// HTTP status numbers and allow-listed error codes can reach the output (see sanitize()).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = process.env.PACKAGE || 'io.github.demeapp.deme';
const HOST = process.env.EXPECT_HOST || 'demeapp.github.io';
const PORT = Number(process.env.BRIDGE_PORT || 9222);
const WAIT_MS = Number(process.env.BRIDGE_WAIT_SECONDS || 90) * 1000;
const ADB = process.env.ADB || 'adb';
const TURNSTILE_S = Number(process.env.SIGNIN_TURNSTILE_SECONDS || 60);
const MODE = process.env.SIGNIN_CHECK_MODE || 'turnstile';
let EMAIL = '';
const PASSWORD = process.env.SIGNIN_CHECK_PASSWORD || '';
const ITEM = process.env.SIGNIN_CHECK_ITEM || '';
const ADAPTER = process.env.SIGNIN_ADAPTER || path.join(here, 'signin-check.adapter.mjs');

// ---- output discipline: everything printed goes through redact() ----
const SECRETS = [PASSWORD, ...Object.keys(process.env).filter((k) => k.startsWith('SIGNIN_CHECK_EMAIL')).map((k) => process.env[k])]
  .filter((s) => s && s.length >= 4);
function redact(s) {
  let t = String(s);
  for (const x of SECRETS) t = t.split(x).join('[redacted]');
  return t.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[redacted]');
}
const out = (line) => console.log(redact(line));

// ---- what a page-side operation may return (anything else becomes "malformed") ----
const OPS = {
  preflight: ['ready', 'missing'],
  signOut: ['signed-out'],
  turnstileProbe: ['token', 'timeout', 'blocked', 'ui-missing'],
  signUp: ['signed-up', 'confirmation-required', 'already-registered', 'rejected', 'rate-limited', 'ui-missing', 'unobserved'],
  signIn: ['signed-in', 'confirmation-required', 'rejected', 'rate-limited', 'ui-missing', 'unobserved'],
  verifySession: ['ok', 'fail', 'unobserved'],
  weighIn: ['done', 'fail', 'no-item', 'ui-missing'],
  readPick: ['persisted', 'missing'],
  deleteAccount: ['deleted', 'not-signed-in', 'fail', 'ui-missing'],
};
const TURNSTILE_STATES = ['ok', 'timeout', 'interactive', 'blocked'];
const CODES = ['captcha_failed', 'invalid_credentials', 'email_not_confirmed', 'user_already_exists',
  'over_request_rate_limit', 'over_email_send_rate_limit', 'weak_password', 'validation_failed', 'signup_disabled'];
const MISSING_NAME = /^[A-Za-z0-9_.:#-]{1,40}$/;

export function sanitize(op, raw) {
  let o; try { o = JSON.parse(raw); } catch { return { state: 'malformed' }; }
  if (!o || typeof o !== 'object' || !OPS[op].includes(o.state)) return { state: 'malformed' };
  const r = { state: o.state };
  const isStatus = (n) => Number.isInteger(n) && n >= 100 && n < 600;
  if (isStatus(o.status)) r.status = o.status;
  if (isStatus(o.picksStatus)) r.picksStatus = o.picksStatus;
  if (typeof o.code === 'string') r.code = CODES.includes(o.code) ? o.code : 'other';
  if (typeof o.turnstile === 'string') r.turnstile = TURNSTILE_STATES.includes(o.turnstile) ? o.turnstile : 'blocked';
  if (typeof o.ui === 'boolean') r.ui = o.ui;
  if (Array.isArray(o.missing)) r.missing = o.missing.filter((x) => typeof x === 'string' && MISSING_NAME.test(x)).slice(0, 12);
  return r;
}

// ---- minimal persistent CDP session ----
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('websocket'));
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); clearTimeout(p.t); p.resolve(m); }
      };
    });
  }
  evaluate(expression, timeoutMs) {
    return new Promise((resolve) => {
      const id = ++this.id;
      const t = setTimeout(() => { this.pending.delete(id); resolve({ timeout: true }); }, timeoutMs);
      this.pending.set(id, { resolve, t });
      this.ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function adb(args) {
  const r = spawnSync(ADB, args, { encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout || '').trim() };
}
let forwarded = false, cdp = null;
function finish(code, verdict, reason) {
  if (reason) out(`REASON: ${reason}`);
  out(`VERDICT: ${verdict}`);
  if (cdp) cdp.close();
  if (forwarded) adb(['forward', '--remove', `tcp:${PORT}`]);
  process.exit(code);
}
const BLOCKED = (reason) => finish(2, 'BLOCKED', reason);
const FAIL = (reason) => finish(1, 'FAIL', reason);

async function connect() {
  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') BLOCKED('NODE_22_REQUIRED');
  if (spawnSync(ADB, ['version'], { encoding: 'utf8' }).error) BLOCKED('ADB_NOT_FOUND');
  const deadline = Date.now() + WAIT_MS;
  let pid = '';
  while (Date.now() < deadline) {
    const p = (adb(['shell', 'pidof', PKG]).out.split(/\s+/)[0] || '');
    if (/^\d+$/.test(p)) { pid = p; break; }
    await sleep(1000);
  }
  if (!pid) BLOCKED('APP_NOT_RUNNING');
  let socket = '', all = [];
  while (Date.now() < deadline) {
    all = adb(['shell', 'cat', '/proc/net/unix']).out.match(/webview_devtools_remote_\d+/g) || [];
    if (all.includes(`webview_devtools_remote_${pid}`)) { socket = `webview_devtools_remote_${pid}`; break; }
    await sleep(1000);
  }
  if (!socket && all.length === 1) socket = all[0];
  if (!socket) BLOCKED('NO_DEVTOOLS_SOCKET (debug build?)');
  if (adb(['forward', `tcp:${PORT}`, `localabstract:${socket}`]).code !== 0) BLOCKED('ADB_FORWARD_FAILED');
  forwarded = true;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(5000) })).json();
      const page = targets.find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(`https://${HOST}/`));
      if (page) {
        const m = /(\/devtools\/page\/[^?#\s]+)/.exec(page.webSocketDebuggerUrl || '');
        cdp = new Cdp(`ws://127.0.0.1:${PORT}${m ? m[1] : '/devtools/page/' + page.id}`);
        await cdp.open();
        return deadline;
      }
    } catch { /* keep polling */ }
    await sleep(1000);
  }
  BLOCKED('NO_LOADED_PAGE');
}

async function waitComplete(deadline) {
  while (Date.now() < deadline) {
    const r = await cdp.evaluate('document.readyState', 5000);
    if (r.result && r.result.result && r.result.result.value === 'complete') return;
    await sleep(500);
  }
  BLOCKED('PAGE_NOT_COMPLETE');
}

async function runOp(adapter, op, args) {
  const slow = op === 'signUp' || op === 'signIn' || op === 'turnstileProbe';
  const expr = adapter[op](args);
  const res = await cdp.evaluate(expr, (slow ? TURNSTILE_S * 1000 + 30000 : 30000));
  if (res.timeout) return { state: 'malformed', timedOut: true };
  const v = res.result && res.result.result ? res.result.result.value : undefined;
  return sanitize(op, typeof v === 'string' ? v : '');
}

function turnstileBlocked(r) {
  if (r.turnstile && r.turnstile !== 'ok') { out(`TURNSTILE: ${r.turnstile}`); return true; }
  return false;
}

async function main() {
  if (MODE !== 'turnstile' && MODE !== 'full') BLOCKED('BAD_MODE (use turnstile or full)');
  if (MODE === 'full') {
    const missingEnv = [!PASSWORD && 'SIGNIN_CHECK_PASSWORD', !ITEM && 'SIGNIN_CHECK_ITEM'].filter(Boolean);
    if (missingEnv.length) { out(`Missing environment: ${missingEnv.join(', ')}`); BLOCKED('ENV'); }
    if (PASSWORD.length < 10) BLOCKED('PASSWORD_TOO_SHORT (need 10+ characters)');
  }

  const deadline = await connect();
  out('STEP connect: ok');
  if (MODE === 'full') {
    const sdk = (adb(['shell', 'getprop', 'ro.build.version.sdk']).out.match(/\d+/) || [''])[0];
    const legVar = sdk ? `SIGNIN_CHECK_EMAIL_API${sdk}` : '';
    EMAIL = (legVar && process.env[legVar]) || process.env.SIGNIN_CHECK_EMAIL || '';
    if (!EMAIL) { out(`Missing environment: ${legVar ? legVar + ' or ' : ''}SIGNIN_CHECK_EMAIL`); BLOCKED('ENV'); }
  }
  const adapter = await import(pathToFileURL(ADAPTER).href);
  const startPath = adapter.startPath || '/';
  const here = await cdp.evaluate('location.pathname', 5000);
  if (!(here.result && here.result.result && here.result.result.value === startPath)) {
    await cdp.evaluate(`location.assign(${JSON.stringify(startPath)})`, 5000);
    await sleep(1500);
  }
  await waitComplete(deadline);

  const pre = await runOp(adapter, 'preflight', {});
  if (pre.state === 'missing') { out(`ADAPTER: incomplete (missing: ${(pre.missing || []).join(', ') || 'unknown'})`); BLOCKED('ADAPTER_INCOMPLETE'); }
  if (pre.state !== 'ready') BLOCKED('ADAPTER_MALFORMED');
  out('STEP preflight: ready');

  if (MODE === 'turnstile') {
    const so0 = await runOp(adapter, 'signOut', {});
    if (so0.state !== 'signed-out') BLOCKED('SIGNOUT_UNCONFIRMED');
    out('STEP sign-out (start): ok');
    const tp = await runOp(adapter, 'turnstileProbe', { seconds: TURNSTILE_S });
    out(`STEP turnstile-probe: ${tp.state}`);
    if (tp.state === 'token') { out('TURNSTILE: ok'); finish(0, 'PASS'); }
    if (tp.state === 'timeout' || tp.state === 'blocked') { out(`TURNSTILE: ${tp.state}`); BLOCKED('TURNSTILE'); }
    BLOCKED(tp.state === 'ui-missing' ? 'PAGE_UI_NOT_FOUND' : 'PROBE_MALFORMED');
  }

  const creds = { email: EMAIL, password: PASSWORD, seconds: TURNSTILE_S };
  let created = false, leftover = false, verdict = null;
  const stop = (kind, reason) => { verdict = { kind, reason }; };

  const so = await runOp(adapter, 'signOut', {});
  if (so.state !== 'signed-out') BLOCKED('SIGNOUT_UNCONFIRMED');
  out('STEP sign-out (start): ok');

  run: {
    const su = await runOp(adapter, 'signUp', creds);
    if (turnstileBlocked(su)) { stop('BLOCKED', 'TURNSTILE'); break run; }
    if (su.state === 'malformed') { stop('BLOCKED', 'SIGNUP_MALFORMED'); break run; }
    if (su.state === 'ui-missing') { stop('BLOCKED', 'PAGE_UI_NOT_FOUND'); break run; }
    if (su.state === 'unobserved') { stop('BLOCKED', 'REQUEST_NOT_OBSERVED'); break run; }
    out(`STEP sign-up: ${su.state}${su.status ? ' (HTTP ' + su.status + ')' : ''}${su.code ? ' code=' + su.code : ''}`);
    if (su.state === 'confirmation-required') { leftover = true; stop('BLOCKED', 'EMAIL_CONFIRMATION_REQUIRED'); break run; }
    if (su.state === 'already-registered') { stop('BLOCKED', 'STALE_ACCOUNT (a previous run did not clean up)'); break run; }
    if (su.state === 'rate-limited') { stop('BLOCKED', 'RATE_LIMITED'); break run; }
    if (su.state === 'rejected') { stop('FAIL', 'SIGNUP_REJECTED'); break run; }
    created = true;

    const so2 = await runOp(adapter, 'signOut', {});
    if (so2.state !== 'signed-out') { stop('BLOCKED', 'SIGNOUT_UNCONFIRMED'); break run; }
    out('STEP sign-out: ok');

    const si = await runOp(adapter, 'signIn', creds);
    if (turnstileBlocked(si)) { stop('BLOCKED', 'TURNSTILE'); break run; }
    if (si.state === 'malformed') { stop('BLOCKED', 'SIGNIN_MALFORMED'); break run; }
    if (si.state === 'ui-missing') { stop('BLOCKED', 'PAGE_UI_NOT_FOUND'); break run; }
    if (si.state === 'unobserved') { stop('BLOCKED', 'REQUEST_NOT_OBSERVED'); break run; }
    out(`STEP sign-in: ${si.state}${si.status ? ' (HTTP ' + si.status + ')' : ''}${si.code ? ' code=' + si.code : ''}`);
    if (si.state === 'confirmation-required') { stop('BLOCKED', 'EMAIL_CONFIRMATION_REQUIRED'); break run; }
    if (si.state === 'rate-limited') { stop('BLOCKED', 'RATE_LIMITED'); break run; }
    if (si.state !== 'signed-in') { stop('FAIL', 'SIGNIN_REJECTED'); break run; }

    const vs = await runOp(adapter, 'verifySession', {});
    out(`STEP verify-session: ${vs.state} (account UI: ${vs.ui === true ? 'shows account' : 'no'}; picks read HTTP ${vs.picksStatus || 'none'})`);
    if (vs.state === 'unobserved') { stop('BLOCKED', 'SESSION_SHAPE_UNKNOWN'); break run; }
    if (vs.state !== 'ok' || vs.ui !== true || vs.picksStatus !== 200) { stop('FAIL', 'SESSION_NOT_VERIFIED'); break run; }

    const wi = await runOp(adapter, 'weighIn', { item: ITEM });
    out(`STEP weigh-in: ${wi.state}`);
    if (wi.state === 'no-item') { stop('BLOCKED', 'NO_UPCOMING_ITEM'); break run; }
    if (wi.state === 'ui-missing') { stop('BLOCKED', 'PAGE_UI_NOT_FOUND'); break run; }
    if (wi.state !== 'done') { stop('FAIL', 'WEIGH_IN_FAILED'); break run; }
    const rp = await runOp(adapter, 'readPick', { item: ITEM });
    out(`STEP re-read pick: ${rp.state}`);
    if (rp.state !== 'persisted') { stop('FAIL', 'PICK_NOT_PERSISTED'); break run; }
    stop('PASS', null);
  }

  if (created) {
    const del = await runOp(adapter, 'deleteAccount', { email: EMAIL });
    out(del.state === 'deleted' ? 'CLEANUP: deleted' : `CLEANUP: account may remain (${del.state})`);
  } else if (leftover) {
    out('CLEANUP: account may remain (unconfirmed sign-up)');
  } else {
    out('CLEANUP: skipped (no account was created)');
  }
  if (!verdict) BLOCKED('UNKNOWN');
  if (verdict.kind === 'PASS') finish(0, 'PASS');
  if (verdict.kind === 'FAIL') FAIL(verdict.reason);
  BLOCKED(verdict.reason);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => BLOCKED('UNEXPECTED_ERROR'));
}
