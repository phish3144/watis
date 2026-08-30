(async () => {
  const mark = (k, v) => { try { document.documentElement.setAttribute('data-watis-' + k, String(v)) } catch (e) {} };
  mark('main-late-ran', '1');
  const interesting = Object.keys(window).filter(k => /webpack|__d$|require|moduleRaid|__x|Store/i.test(k));
  mark('main-globals', JSON.stringify(interesting.slice(0, 30)));
  try {
    const dbs = await indexedDB.databases();
    mark('idb-main', JSON.stringify(dbs.map(d => d.name + '@' + d.version)));
  } catch (e) { mark('idb-main', 'THREW:' + e.name + ':' + e.message) }
  console.log('WATIS-MAIN-LATE-OK');
})();
