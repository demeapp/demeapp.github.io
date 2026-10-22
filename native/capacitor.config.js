// Capacitor reads this file (CommonJS) when you run `cap sync` / `cap add`.
// Data mode is flipped here by environment, with no change to any other file:
//   bundled (default): the app ships a copy of the site, including a snapshot of /data/.
//   live:              the app loads https://demeapp.github.io directly (always current).
// Use `npm run sync` (bundled) or `npm run sync:live`. A new app build is still
// needed after switching, because the mode is baked into the native project.
const mode = (process.env.DEME_DATA_MODE || "bundled").toLowerCase();
if (mode !== "bundled" && mode !== "live") {
  throw new Error(`DEME_DATA_MODE must be "bundled" or "live" (got "${mode}")`);
}

const config = {
  appId: "io.github.demeapp.deme",
  appName: "Deme",
  webDir: "www",
  server: { allowNavigation: ["demeapp.github.io"] },
  plugins: { SplashScreen: { backgroundColor: "#0E2A47", showSpinner: false } },
};
if (mode === "live") config.server.url = "https://demeapp.github.io";

module.exports = config;
