#!/usr/bin/env node
// Self-test for bridge-check.mjs using a FAKE adb and a FAKE DevTools server.
// It proves the script's logic and exit codes, NOT real WebView behavior.
//   node native/scripts/bridge-check.selftest.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROBE_EXPRESSION } from './bridge-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'bridge-check.mjs');
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

// --- 0. the probe expression itself runs and reports the expected keys ---
function runProbe(window) {
  return JSON.parse(vm.runInNewContext(PROBE_EXPRESSION, { window, location: { href: 'https://demeapp.github.io/' }, document: { readyState: 'complete' } }));
}
const native = runProbe({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { App: {}, SplashScreen: {} }, isPluginAvailable: (n) => n === 'App' } });
check('probe: native android', native.isNative === true && native.platform === 'android' && native.hasAppPlugin === true && native.appPluginAvailable === true);
const web = runProbe({});
check('probe: plain web page', web.hasCapacitor === false && web.isNative === false && web.platform === null);

// --- fake adb ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-selftest-'));
const fakeAdb = path.join(tmp, 'adb');
fs.writeFileSync(fakeAdb, `#!/usr/bin/env bash
case "$*" in
  "shell pidof "*) [ -n "$FAKE_NOPID" ] || echo "\${FAKE_PID:-4242}";;
  "shell cat /proc/net/unix") echo "Num RefCnt Protocol Flags Type St Inode Path"
    [ -n "$FAKE_NOSOCKET" ] || echo "0000: 2 0 0 1 1 1 1 @webview_devtools_remote_\${FAKE_PID:-4242}";;
  forward\\ tcp:*) exit 0;;
  "forward --remove "*) exit 0;;
  *) echo "fake adb: unhandled: $*" >&2; exit 1;;
esac
`, { mode: 0o755 });

// --- fake DevTools server ---
const state = { targets: () => [], probe: () => '{}' };
const server = http.createServer((req, res) => {
  if (req.url === '/json' || req.url === '/json/list') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(state.targets())); }
  else { res.statusCode = 404; res.end(); }
});
server.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.on('data', (buf) => {
    if ((buf[0] & 0x0f) !== 1) return; // ignore close/ping frames
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
    const mask = buf.subarray(off, off + 4); off += 4;
    const payload = Buffer.alloc(len); for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i % 4];
    const msg = JSON.parse(payload.toString());
    const body = Buffer.from(JSON.stringify({ id: msg.id, result: { result: { type: 'string', value: state.probe() } } }));
    const header = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
    socket.write(Buffer.concat([header, body]));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const pageTarget = (p) => [{ id: 'PAGE1', type: 'page', url: 'https://demeapp.github.io/', webSocketDebuggerUrl: `ws://localhost:${p}/devtools/page/PAGE1` }];
const probeJson = (o) => JSON.stringify({ url: 'https://demeapp.github.io/', readyState: 'complete', hasCapacitor: true, isNative: true, platform: 'android', plugins: ['App', 'SplashScreen'], hasAppPlugin: true, appPluginAvailable: true, ...o });

function run(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ADB: fakeAdb, BRIDGE_PORT: String(port), BRIDGE_WAIT_SECONDS: '4', ...env } });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

// A: native bridge present -> 0
state.targets = () => pageTarget(port); state.probe = () => probeJson({});
let r = await run({}); check('A native bridge present -> exit 0', r.code === 0 && /VERDICT: PASS/.test(r.out) && /RAW_CDP_RESPONSE/.test(r.out));

// B: page loaded, no Capacitor -> 1
state.probe = () => probeJson({ hasCapacitor: false, isNative: false, platform: null, plugins: null, hasAppPlugin: false });
r = await run({}); check('B bridge absent -> exit 1', r.code === 1 && /VERDICT: FAIL/.test(r.out));

// C: only an error page (e.g. DNS) -> 2, and the targets are reported
state.targets = () => [{ id: 'E', type: 'page', url: 'chrome-error://chromewebdata/', webSocketDebuggerUrl: `ws://localhost:${port}/devtools/page/E` }];
r = await run({}); check('C error page only -> exit 2 with targets listed', r.code === 2 && /chrome-error/.test(r.out) && /VERDICT: INFRA/.test(r.out));

// D: page still loading for two polls, then complete -> 0
state.targets = () => pageTarget(port); let n = 0;
state.probe = () => probeJson({ readyState: n++ < 2 ? 'loading' : 'complete' });
r = await run({}); check('D waits for readyState complete -> exit 0', r.code === 0 && n >= 3, `(evaluations: ${n})`);

// E: no DevTools socket (release build) -> 2
state.probe = () => probeJson({});
r = await run({ FAKE_NOSOCKET: '1' }); check('E no WebView socket -> exit 2', r.code === 2 && /debug build/i.test(r.out));

// F: app not running -> 2
r = await run({ FAKE_NOPID: '1' }); check('F app not running -> exit 2', r.code === 2 && /not running/.test(r.out));

// G: adb missing -> fast exit 2 (must not wait out the timeout)
const t0 = Date.now();
r = await run({ ADB: path.join(tmp, 'no-such-adb'), BRIDGE_WAIT_SECONDS: '60' });
check('G adb missing -> fast exit 2', r.code === 2 && /adb not found/.test(r.out) && Date.now() - t0 < 5000);

server.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
