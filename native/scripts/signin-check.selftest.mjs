#!/usr/bin/env node
// Self-test for signin-check.mjs: fake adb, fake DevTools server, and a TEST adapter whose
// page-side "operations" are answered by scripted scenarios. Proves orchestration, exit codes and
// that canary secrets never reach the output. It does NOT test the real page-side adapter.
//   node native/scripts/signin-check.selftest.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitize } from './signin-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'signin-check.mjs');
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

const EMAIL = 'canary.user+ci@example.test';
const PASSWORD = 'Canary-Passw0rd-XYZ123';
// built at runtime so no literal token-shaped string sits in the source
const TOKEN = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJjYW5hcnkifQ', 'c2lnbmF0dXJlMTIz'].join('.');
const ITEM = 'item-canary-42';
const CANARIES = [EMAIL, PASSWORD, TOKEN, 'c2lnbmF0dXJl'];

// sanitize(): fixed vocabularies only
check('sanitize: unknown state -> malformed', sanitize('weighIn', JSON.stringify({ state: TOKEN })).state === 'malformed');
check('sanitize: extra fields dropped', JSON.stringify(sanitize('signIn', JSON.stringify({ state: 'signed-in', token: TOKEN, session: { a: 1 }, status: 200 }))) === '{"state":"signed-in","status":200}');
check('sanitize: unknown code -> "other"', sanitize('signIn', JSON.stringify({ state: 'rejected', code: PASSWORD })).code === 'other');
check('sanitize: non-JSON -> malformed', sanitize('signIn', TOKEN).state === 'malformed');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signin-selftest-'));
const fakeAdb = path.join(tmp, 'adb');
fs.writeFileSync(fakeAdb, `#!/usr/bin/env bash
case "$*" in
  "shell pidof "*) echo 4242;;
  "shell getprop ro.build.version.sdk") echo "\${FAKE_SDK:-35}";;
  "shell cat /proc/net/unix") echo "0000: 2 0 0 1 1 1 1 @webview_devtools_remote_4242";;
  forward\\ tcp:*) exit 0;;
  "forward --remove "*) exit 0;;
  *) exit 1;;
esac
`, { mode: 0o755 });
const adapterPath = path.join(tmp, 'adapter.mjs');
fs.writeFileSync(adapterPath, `export const startPath = '/';
${['preflight', 'signOut', 'turnstileProbe', 'signUp', 'signIn', 'verifySession', 'weighIn', 'readPick', 'deleteAccount'].map((n) => `export const ${n} = (a) => '/*OP:${n}*/ ' + JSON.stringify(a || {});`).join('\n')}
`);

const OK = {
  turnstileProbe: { state: 'token' }, preflight: { state: 'ready' }, signOut: { state: 'signed-out' },
  signUp: { state: 'signed-up', turnstile: 'ok', status: 200 }, signIn: { state: 'signed-in', turnstile: 'ok', status: 200 },
  verifySession: { state: 'ok', ui: true, picksStatus: 200 }, weighIn: { state: 'done' },
  readPick: { state: 'persisted' }, deleteAccount: { state: 'deleted' },
};
const sc = { responses: {}, seen: [] };
const server = http.createServer((req, res) => {
  if (req.url === '/json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([{ id: 'P', type: 'page', url: 'https://demeapp.github.io/', webSocketDebuggerUrl: `ws://localhost:${server.address().port}/devtools/page/P` }])); }
  else { res.statusCode = 404; res.end(); }
});
server.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.on('data', (buf) => {
    if ((buf[0] & 0x0f) !== 1) return;
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
    const mask = buf.subarray(off, off + 4); off += 4;
    const payload = Buffer.alloc(len); for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i % 4];
    const msg = JSON.parse(payload.toString());
    const expr = msg.params.expression;
    let value;
    const m = /^\/\*OP:(\w+)\*\//.exec(expr);
    if (m) { sc.seen.push({ op: m[1], expr }); const r = sc.responses[m[1]]; value = typeof r === 'string' ? r : JSON.stringify(r); }
    else if (expr === 'document.readyState') value = 'complete';
    else if (expr === 'location.pathname') value = '/';
    const body = Buffer.from(JSON.stringify({ id: msg.id, result: { result: { type: 'string', value } } }));
    const header = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
    socket.write(Buffer.concat([header, body]));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

function run(responses, envOverride = {}) {
  sc.responses = { ...OK, ...responses }; sc.seen = [];
  return new Promise((resolve) => {
    const env = { ...process.env, ADB: fakeAdb, BRIDGE_PORT: String(port), BRIDGE_WAIT_SECONDS: '4', SIGNIN_TURNSTILE_SECONDS: '2',
      SIGNIN_ADAPTER: adapterPath, SIGNIN_CHECK_MODE: 'full', SIGNIN_CHECK_EMAIL: EMAIL, SIGNIN_CHECK_PASSWORD: PASSWORD, SIGNIN_CHECK_ITEM: ITEM, ...envOverride };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    const child = spawn(process.execPath, [script], { env });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}
const clean = (out) => CANARIES.every((c) => !out.includes(c));
const ops = () => sc.seen.map((s) => s.op);

let r = await run({});
check('1 happy path -> PASS exit 0', r.code === 0 && /VERDICT: PASS/.test(r.out) && /CLEANUP: deleted/.test(r.out));
check('1 steps in order', ops().join(',') === 'preflight,signOut,signUp,signOut,signIn,verifySession,weighIn,readPick,deleteAccount', ops().join(','));
check('1 credentials and item reached the page, not the log', sc.seen.find((s) => s.op === 'signUp').expr.includes(PASSWORD) && sc.seen.find((s) => s.op === 'weighIn').expr.includes(ITEM) && clean(r.out));

r = await run({ signUp: { state: 'rejected', turnstile: 'timeout' } });
check('2 Turnstile timeout on sign-up -> BLOCKED exit 2, TURNSTILE line, no cleanup call', r.code === 2 && /TURNSTILE: timeout/.test(r.out) && /CLEANUP: skipped/.test(r.out) && !ops().includes('deleteAccount'));
r = await run({ signIn: { state: 'rejected', turnstile: 'interactive' }, deleteAccount: { state: 'not-signed-in' } });
check('2b Turnstile blocks sign-in after the account exists -> exit 2 and cleanup attempted', r.code === 2 && /TURNSTILE: interactive/.test(r.out) && /CLEANUP: account may remain/.test(r.out) && ops().includes('deleteAccount'));
r = await run({ signUp: { state: 'confirmation-required', turnstile: 'ok', status: 200 } });
check('3 confirmation required -> exit 2, leftover noted', r.code === 2 && /EMAIL_CONFIRMATION_REQUIRED/.test(r.out) && /unconfirmed sign-up/.test(r.out));
r = await run({ signUp: { state: 'already-registered', turnstile: 'ok', status: 422, code: 'user_already_exists' } });
check('4 already registered -> exit 2 STALE_ACCOUNT', r.code === 2 && /STALE_ACCOUNT/.test(r.out) && clean(r.out));
r = await run({ signIn: { state: 'rejected', turnstile: 'ok', status: 400, code: 'invalid_credentials' }, deleteAccount: { state: 'not-signed-in' } });
check('5 sign-in rejected -> FAIL exit 1 with status and code', r.code === 1 && /SIGNIN_REJECTED/.test(r.out) && /\(HTTP 400\) code=invalid_credentials/.test(r.out) && /CLEANUP: account may remain/.test(r.out));
r = await run({ verifySession: { state: 'fail', ui: true, picksStatus: 401 } });
check('6 picks read 401 -> FAIL exit 1', r.code === 1 && /SESSION_NOT_VERIFIED/.test(r.out) && /CLEANUP: deleted/.test(r.out));
r = await run({ verifySession: { state: 'ok', ui: false, picksStatus: 200 } });
check('6b account UI missing -> FAIL exit 1', r.code === 1 && /SESSION_NOT_VERIFIED/.test(r.out));
r = await run({ readPick: { state: 'missing' } });
check('7 pick not persisted -> FAIL exit 1', r.code === 1 && /PICK_NOT_PERSISTED/.test(r.out));
r = await run({ preflight: { state: 'missing', missing: ['adapter:signUp', 'DEME_SUPABASE_URL', 'bad name with spaces!', TOKEN] } });
check('8 adapter incomplete -> exit 2 listing safe names only', r.code === 2 && /ADAPTER: incomplete \(missing: adapter:signUp, DEME_SUPABASE_URL\)/.test(r.out) && clean(r.out) && !ops().includes('signUp'));
r = await run({ weighIn: { state: TOKEN }, signIn: { state: 'signed-in', status: 200, code: PASSWORD, token: TOKEN, session: { access_token: TOKEN } } });
check('9 leaky adapter: nothing sensitive printed, run fails', r.code === 1 && /STEP weigh-in: malformed/.test(r.out) && clean(r.out));
r = await run({ signUp: `not json ${TOKEN} ${PASSWORD}` });
check('9b non-JSON adapter output with secrets: nothing printed, BLOCKED', r.code === 2 && clean(r.out));
r = await run({}, { SIGNIN_CHECK_EMAIL: undefined });
check('10 missing email -> exit 2, names only (per-leg name offered)', r.code === 2 && /Missing environment: SIGNIN_CHECK_EMAIL_API35 or SIGNIN_CHECK_EMAIL/.test(r.out) && clean(r.out));
r = await run({}, { SIGNIN_CHECK_PASSWORD: 'abc123' });
check('11 short password -> exit 2, value never echoed', r.code === 2 && /PASSWORD_TOO_SHORT/.test(r.out) && !r.out.includes('abc123'));
r = await run({ signIn: { state: 'rate-limited', turnstile: 'ok', status: 429, code: 'over_request_rate_limit' } });
check('12 rate limited -> exit 2', r.code === 2 && /RATE_LIMITED/.test(r.out));
r = await run({ deleteAccount: { state: 'fail' } });
check('13 PASS but cleanup failed -> exit 0 with loud CLEANUP line', r.code === 0 && /CLEANUP: account may remain \(fail\)/.test(r.out));
// ---- new in this revision: modes, per-leg email, new page states ----
const OTHER = 'other.canary@example.test';
const base = { SIGNIN_CHECK_EMAIL: undefined, SIGNIN_CHECK_PASSWORD: undefined, SIGNIN_CHECK_ITEM: undefined };
r = await run({}, { ...base, SIGNIN_CHECK_MODE: 'turnstile' });
check('15 turnstile mode needs no credentials: token -> PASS, read-only op sequence', r.code === 0 && /TURNSTILE: ok/.test(r.out) && /VERDICT: PASS/.test(r.out) && ops().join(',') === 'preflight,signOut,turnstileProbe', ops().join(','));
r = await run({}, { ...base, SIGNIN_CHECK_MODE: undefined });
check('15b default mode is turnstile (nothing is written)', r.code === 0 && ops().join(',') === 'preflight,signOut,turnstileProbe' && !ops().includes('signUp'));
r = await run({ turnstileProbe: { state: 'timeout' } }, { ...base, SIGNIN_CHECK_MODE: 'turnstile' });
check('16 no Turnstile token -> BLOCKED exit 2 with TURNSTILE line', r.code === 2 && /TURNSTILE: timeout/.test(r.out));
r = await run({ turnstileProbe: { state: 'blocked' } }, { ...base, SIGNIN_CHECK_MODE: 'turnstile' });
check('16b widget blocked -> exit 2', r.code === 2 && /TURNSTILE: blocked/.test(r.out));
r = await run({ turnstileProbe: { state: 'ui-missing' } }, { ...base, SIGNIN_CHECK_MODE: 'turnstile' });
check('16c sign-in UI not found -> exit 2 PAGE_UI_NOT_FOUND', r.code === 2 && /PAGE_UI_NOT_FOUND/.test(r.out));
r = await run({}, { SIGNIN_CHECK_MODE: 'bogus' });
check('17 unknown mode -> exit 2', r.code === 2 && /BAD_MODE/.test(r.out));
r = await run({}, { FAKE_SDK: '36', SIGNIN_CHECK_EMAIL: undefined, SIGNIN_CHECK_EMAIL_API36: EMAIL, SIGNIN_CHECK_EMAIL_API35: OTHER });
check('18 per-leg email: API 36 device uses the API36 secret, not API35', r.code === 0 && sc.seen.find((x) => x.op === 'signUp').expr.includes(EMAIL) && !sc.seen.find((x) => x.op === 'signUp').expr.includes(OTHER) && clean(r.out) && !r.out.includes(OTHER));
r = await run({}, { FAKE_SDK: '36', SIGNIN_CHECK_EMAIL: undefined, SIGNIN_CHECK_EMAIL_API35: OTHER });
check('18b per-leg email missing for this API level -> exit 2 naming the variable, never echoing others', r.code === 2 && /SIGNIN_CHECK_EMAIL_API36 or SIGNIN_CHECK_EMAIL/.test(r.out) && !r.out.includes(OTHER));
r = await run({ weighIn: { state: 'no-item' } });
check('19 no upcoming item -> exit 2 NO_UPCOMING_ITEM, account still cleaned up', r.code === 2 && /NO_UPCOMING_ITEM/.test(r.out) && /CLEANUP: deleted/.test(r.out));
r = await run({ weighIn: { state: 'ui-missing' } });
check('19b weigh-in UI not mapped -> exit 2, cleaned up', r.code === 2 && /PAGE_UI_NOT_FOUND/.test(r.out) && /CLEANUP: deleted/.test(r.out));
r = await run({ signUp: { state: 'unobserved' } });
check('20 sign-up request not observed -> exit 2', r.code === 2 && /REQUEST_NOT_OBSERVED/.test(r.out));
r = await run({ signUp: { state: 'ui-missing' } });
check('20b sign-up UI missing -> exit 2', r.code === 2 && /PAGE_UI_NOT_FOUND/.test(r.out));
r = await run({ verifySession: { state: 'unobserved', ui: true } });
check('20c session shape unknown -> exit 2 SESSION_SHAPE_UNKNOWN', r.code === 2 && /SESSION_SHAPE_UNKNOWN/.test(r.out));
r = await run({});
check('21 delete step receives the test email (so the adapter can refuse any other account)', sc.seen.find((x) => x.op === 'deleteAccount').expr.includes(EMAIL));

const t0 = Date.now();
r = await run({}, { ADB: path.join(tmp, 'no-such-adb'), BRIDGE_WAIT_SECONDS: '60' });
check('14 adb missing -> fast exit 2', r.code === 2 && /ADB_NOT_FOUND/.test(r.out) && Date.now() - t0 < 5000);

server.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
