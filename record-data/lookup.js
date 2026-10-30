/* Deme — postal-code representative lookup (front-end port of lookup.py).
 *
 * FSA granularity only, mirroring WardFinder's honesty rules:
 *   - only the first 3 characters of the code are ever read;
 *   - candidates under 1% land-area share are boundary noise and drop out,
 *     unless dropping them would leave nothing;
 *   - one surviving candidate  -> status "resolved";
 *   - more than one            -> status "candidates": the caller MUST let
 *     the user confirm their district; never auto-pick;
 *   - a district with no current member carries memberId: null and
 *     vacant: true — render the vacant-seat state, not an error.
 *
 * Data files (same directory): fsa-federal.json (verified tier),
 * fsa-provincial-provisional.json (provisional tier — see `status` inside;
 * do not present its resolutions as more certain than its basis states).
 * Nothing is stored and nothing leaves the browser.
 */
(function (global) {
  'use strict';
  var SLIVER = 0.01;

  function candidates(entries) {
    if (!entries || !entries.length) return { list: [], status: 'none' };
    var kept = entries.filter(function (e) { return e.share >= SLIVER; });
    if (!kept.length) kept = entries.slice();
    var carved = kept.some(function (e) { return e.basis === 'carve-candidate'; });
    if (carved) return { list: kept, status: 'candidates' };
    return { list: kept, status: kept.length === 1 ? 'resolved' : 'candidates' };
  }

  function makeResolver(federal, provincial, wards) {
    return function resolve(postalCode) {
      var code = String(postalCode || '').toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z]\d[A-Z](\d[A-Z]\d)?$/.test(code)) {
        return { ok: false, error: 'not-a-postal-code' };
      }
      var fsa = code.slice(0, 3);
      var fed = candidates(federal.fsa[fsa] || []);
      var prov = candidates(provincial.fsa[fsa] || []);
      var out = {
        ok: true,
        fsa: fsa,
        federal: { status: fed.status, candidates: fed.list },
        provincial: {
          status: prov.status,
          candidates: prov.list,
          layerStatus: provincial.status || 'PROVISIONAL'
        }
      };
      var w = wards && wards[fsa];
      if (w) {
        out.toronto = {
          status: w.length === 1 ? 'resolved' : 'candidates',
          wards: w
        };
      }
      return out;
    };
  }

  global.DemePostalLookup = { makeResolver: makeResolver, SLIVER: SLIVER };
})(typeof window !== 'undefined' ? window : this);
