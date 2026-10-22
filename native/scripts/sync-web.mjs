#!/usr/bin/env node
// Prepares native/www.   node scripts/sync-web.mjs [live|bundled]   (default: live)
//  live:    the app loads the live site, so www only needs a tiny placeholder page.
//           Nothing from the site is copied (no 34k-file copy, no big app).
//  bundled: copies the site (repo root) into www and applies the native overlay.
// The website itself is never modified; Pages keeps deploying from the repo root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const mode = process.argv[2] === 'bundled' ? 'bundled' : 'live';
const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, '..');
const repoRoot = path.resolve(nativeDir, '..');
const www = path.join(nativeDir, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

if (mode === 'live') {
  // Capacitor needs a web directory with an index.html. With server.url set it is
  // never shown unless something goes wrong; the text is the approved offline copy.
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deme</title></head>
<body style="margin:0;padding:3rem 1.25rem;font-family:system-ui,sans-serif;background:#0E2A47;color:#FFFFFF">
<p>You're offline. The record needs a connection to load. Check your signal and try again.</p>
<p><a style="color:#2FBF8F" href="https://demeapp.github.io/">Try again</a></p>
</body></html>
`;
  fs.writeFileSync(path.join(www, 'index.html'), page);
  console.log('Mode: live. Wrote placeholder native/www (index.html only); no site files copied. The app loads https://demeapp.github.io.');
  process.exit(0);
}

// ---- bundled mode ----
if (!fs.existsSync(path.join(repoRoot, 'index.html'))) {
  console.error(`index.html not found in ${repoRoot}. Run this from <repo>/native.`);
  process.exit(1);
}
// Top-level names that are NOT part of the app: tooling, repo plumbing, web-only PWA files.
const EXCLUDE = new Set([
  'native', 'tools', '.git', '.github', 'node_modules', '.gitignore', '.nojekyll',
  '.well-known', 'sw.js', 'manifest.webmanifest', 'offline.html',
]);
// Copy top-level entries one by one: Node refuses to copy a folder into itself.
for (const name of fs.readdirSync(repoRoot)) {
  if (EXCLUDE.has(name)) continue;
  fs.cpSync(path.join(repoRoot, name), path.join(www, name), { recursive: true });
}
// Native overlay replaces assets/js/pwa.js with the app version (no service worker).
fs.cpSync(path.join(nativeDir, 'overlay'), www, { recursive: true });

let files = 0, bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
})(www);

let sha = 'unknown';
try { sha = execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}

console.log(`Mode: bundled. Synced site @ ${sha} -> native/www: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
if (bytes > 100 * 1048576) console.warn('WARNING: over 100 MB. Check store size limits before building.');
console.log('Reminder: the app ships a SNAPSHOT of /data/. Run the integrity gate (check_vote_integrity.py) on the repo first.');
