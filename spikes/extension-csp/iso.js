(async () => {
  const el = document.documentElement;
  const get = (k) => el.getAttribute('data-watis-' + k);
  const report = {
    isolatedRan: true,
    isolatedSeesChromeRuntime: typeof chrome !== 'undefined' && !!(chrome && chrome.runtime && chrome.runtime.id),
    mainEarlyRan: get('main-early-ran'),
    mainLateRan: get('main-late-ran'),
    mainEval: get('main-eval'),
    mainNewFunction: get('main-fn'),
    mainInlineScriptTag: el.hasAttribute('data-watis-inline-tag') ? 'RAN' : (get('inline-tag') || 'BLOCKED-silently'),
    mainSeesChromeRuntime: get('main-sees-chrome-runtime'),
    mainGlobals: get('main-globals'),
    idbFromMain: get('idb-main'),
  };
  try {
    const dbs = await indexedDB.databases();
    report.idbFromIsolated = JSON.stringify(dbs.map(d => d.name + '@' + d.version));
  } catch (e) { report.idbFromIsolated = 'THREW:' + e.name + ':' + e.message }
  try { report.localStorageFromIsolated = JSON.stringify(Object.keys(localStorage).slice(0, 12)) }
  catch (e) { report.localStorageFromIsolated = 'THREW:' + e.name }
  try { report.originFromIsolated = location.origin } catch (e) {}
  el.setAttribute('data-watis-report', JSON.stringify(report));
  console.log('WATIS-REPORT ' + JSON.stringify(report));
})();
