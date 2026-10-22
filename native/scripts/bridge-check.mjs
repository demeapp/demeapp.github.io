#!/usr/bin/env node
// Android bridge check (DEBUG builds only). Asks the running app's WebView, over the
// Chrome DevTools protocol, whether the Capacitor native bridge is present.
// Needs: Node 22+ (global fetch and WebSocket), adb on PATH, a running emulator/device
// with the debug APK installed and launched.   Usage: node native/scripts/bridge-check.mjs
// Exit codes: 0 PASS (native bridge present) | 1 FAIL (page loaded, bridge absent) |
//             2 INFRA (no process, socket, page, or a timeout: the question was not answered)
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PROBE_EXPRESSION = `(function () {
  var C = window.Capacitor;
  var plugins = C && C.Plugins ? Object.keys(C.Plugins) : null;
  return JSON.stringify({
    url: location.href,
    readyState: document.readyState,
    hasCapacitor: typeof C !== 'undefined',
    isNative: !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()),
    platform: C && typeof C.getPlatform === 'function' ? C.getPlatform() : null,
    plugins: plugins,
    hasAppPlugin: !!(C && C.Plugins && C.Plugins.App),
    appPluginAvailable: !!(C && typeof C.isPluginAvailable === 'function' && C.isPluginAvailable('App'))
  });
})()`;

const PKG = process.env.PACKAGE || 'io.github.demeapp.deme';
const HOST = process.env.EXPECT_HOST || 'demeapp.github.io';
const PORT = Number(process.env.BRIDGE_PORT || 9222);
const WAIT_MS = Number(process.env.BRIDGE_WAIT_SECONDS || 90) * 1000;
const ADB = process.env.ADB || 'adb';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function adb(args) {
  const r = spawnSync(ADB, args, { encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
let forwarded = false;
function finish(code, verdict, msg) {
  if (msg) console.log(msg);
  console.log(`VERDICT: ${verdict}`);
  if (forwarded) adb(['forward', '--remove', `tcp:${PORT}`]);
  process.exit(code);
}

function cdpEvaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('CDP evaluate timed out')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer); try { ws.close(); } catch {}
      resolve(msg);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket error')); };
  });
}

async function main() {
  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
    return finish(2, 'INFRA', 'Node 22+ is required (global WebSocket and fetch).');
  }
  const probeAdb = spawnSync(ADB, ['version'], { encoding: 'utf8' });
  if (probeAdb.error) return finish(2, 'INFRA', `adb not found (${ADB}). Put adb on PATH or set ADB=/path/to/adb.`);
  const deadline = Date.now() + WAIT_MS;

  // 1. app process
  let pid = '';
  while (Date.now() < deadline) {
    const r = adb(['shell', 'pidof', PKG]);
    pid = (r.out.split(/\s+/)[0] || '').trim();
    if (/^\d+$/.test(pid)) break;
    pid = '';
    await sleep(1000);
  }
  if (!pid) return finish(2, 'INFRA', `App process ${PKG} not running. Launch the app before this step.`);
  console.log(`app pid: ${pid}`);

  // 2. the WebView DevTools socket (debug builds only)
  let socketName = '';
  let sockets = [];
  while (Date.now() < deadline) {
    const r = adb(['shell', 'cat', '/proc/net/unix']);
    sockets = (r.out.match(/webview_devtools_remote_\d+/g) || []);
    if (sockets.includes(`webview_devtools_remote_${pid}`)) { socketName = `webview_devtools_remote_${pid}`; break; }
    await sleep(1000);
  }
  if (!socketName && sockets.length === 1) {
    socketName = sockets[0];
    console.log(`pid socket not found; using the only WebView socket present: ${socketName}`);
  }
  if (!socketName) {
    return finish(2, 'INFRA', `No webview_devtools_remote_${pid} socket (found: ${JSON.stringify(sockets)}). Is this a debug build?`);
  }

  // 3. forward and find the page
  const fw = adb(['forward', `tcp:${PORT}`, `localabstract:${socketName}`]);
  if (fw.code !== 0) return finish(2, 'INFRA', `adb forward failed: ${fw.err || fw.out}`);
  forwarded = true;

  let lastTargets = [];
  let last = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(5000) });
      const targets = await res.json();
      lastTargets = targets.map((t) => ({ type: t.type, url: t.url }));
      const page = targets.find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(`https://${HOST}/`));
      if (page) {
        const m = /(\/devtools\/page\/[^?#\s]+)/.exec(page.webSocketDebuggerUrl || '');
        const path = m ? m[1] : `/devtools/page/${page.id}`;
        const msg = await cdpEvaluate(`ws://127.0.0.1:${PORT}${path}`, PROBE_EXPRESSION);
        last = msg;
        const value = msg && msg.result && msg.result.result ? msg.result.result.value : undefined;
        let probe = null;
        try { probe = JSON.parse(value); } catch {}
        if (probe && probe.readyState === 'complete') {
          console.log(`RAW_CDP_RESPONSE: ${JSON.stringify(msg)}`);
          console.log(`PROBE: ${JSON.stringify(probe)}`);
          if (probe.hasCapacitor && probe.isNative && probe.platform === 'android') {
            return finish(0, 'PASS', `Native bridge present. App plugin: ${probe.hasAppPlugin ? 'yes' : 'NO'} (needed by a deep-link router).`);
          }
          return finish(1, 'FAIL', 'Page loaded but the Capacitor native bridge is not reporting android/native.');
        }
      }
    } catch (e) {
      // target list or DevTools not ready yet; keep polling until the deadline
    }
    await sleep(1000);
  }
  if (last) console.log(`RAW_CDP_RESPONSE (last, page never reached readyState complete): ${JSON.stringify(last)}`);
  return finish(2, 'INFRA', `No loaded page on https://${HOST}/ before the timeout. Targets seen: ${JSON.stringify(lastTargets)}. (chrome-error:// means the page failed to load, e.g. DNS.)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => finish(2, 'INFRA', `Unexpected error: ${e && e.message}`));
}
