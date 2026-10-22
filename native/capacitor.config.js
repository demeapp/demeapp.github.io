// Capacitor reads this file (CommonJS) on `cap sync` / `cap add`.
// DATA MODE (owner decision, Oct 21 2026): LIVE is the default.
//   live (default): the app loads https://demeapp.github.io directly (always current).
//   bundled:        the app ships a copy of the site + /data/ snapshot (opt-in only):
//                   DEME_DATA_MODE=bundled, i.e. `npm run sync:bundled`.
// A plain `npm run sync` or a bare `npx cap sync` therefore stays LIVE.
// The mode is baked into the native project at sync time: rebuild the app after changing it.
const mode = (process.env.DEME_DATA_MODE || "live").toLowerCase();
if (mode !== "bundled" && mode !== "live") {
  throw new Error(`DEME_DATA_MODE must be "live" or "bundled" (got "${mode}")`);
}

const config = {
  appId: "io.github.demeapp.deme",
  appName: "Deme",
  webDir: "www",
  server: { allowNavigation: ["demeapp.github.io"] },
  plugins: { SplashScreen: { backgroundColor: "#0E2A47", showSpinner: false } },
  // iOS safe area: without this the page starts at the very top of the screen and the
  // election banner sits under the Dynamic Island. "automatic" insets the page below the
  // status bar/Island; the band behind it uses --marble from assets/css/deme.css.
  ios: { contentInset: "automatic", backgroundColor: "#F4F7FA" },
};
if (mode === "live") config.server.url = "https://demeapp.github.io";

module.exports = config;
