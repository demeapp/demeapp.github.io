#!/usr/bin/env node
// Copies the website (repo root) into native/www and applies the native overlay.
// The website itself is never modified; Pages keeps deploying from the repo root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, '..');
const repoRoot = path.resolve(nativeDir, '..');
const www = path.join(nativeDir, 'www');

// Top-level names that are NOT part of the app: tooling, repo plumbing, and the
// web-only PWA files (the app has no use for a service worker or web manifest).
const EXCLUDE = new Set([
  'native', 'tools', '.git', '.github', 'node_modules', '.gitignore', '.nojekyll',
  '.well-known', 'sw.js', 'manifest.webmanifest', 'offline.html',
]);

if (!fs.existsSync(path.join(repoRoot, 'index.html'))) {
  console.error(`index.html not found in ${repoRoot}. Run this from <repo>/native.`);
  process.exit(1);
}

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
// Copy top-level entries one by one: Node refuses to copy a folder into itself,
// and native/www lives inside the repo root.
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

console.log(`Synced site @ ${sha} -> native/www: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
if (bytes > 100 * 1048576) console.warn('WARNING: over 100 MB. Check store size limits before building.');
console.log('Reminder: the app ships a SNAPSHOT of /data/. Run the integrity gate (check_vote_integrity.py) on the repo first.');
