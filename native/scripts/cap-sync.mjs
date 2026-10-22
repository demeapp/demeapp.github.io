#!/usr/bin/env node
// Runs `cap sync` with the chosen data mode: node scripts/cap-sync.mjs [live|bundled]
// Default is LIVE; bundled only when asked for explicitly.
import { spawnSync } from "node:child_process";
const mode = process.argv[2] === "bundled" ? "bundled" : "live";
console.log(`Data mode: ${mode}`);
const r = spawnSync("npx", ["cap", "sync"], {
  stdio: "inherit",
  env: { ...process.env, DEME_DATA_MODE: mode },
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
