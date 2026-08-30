(async () => {
  const report = {};
  // 1. MAIN <-> ISOLATED channel (the only way a MAIN-world bridge reaches extension APIs)
  report.channel = await new Promise((res) => {
    const t = setTimeout(() => res('TIMEOUT'), 3000);
    window.addEventListener('message', (ev) => {
      if (ev.source === window && ev.data && ev.data.__watisPong) { clearTimeout(t); res('OK:' + JSON.stringify(ev.data.payload)) }
    });
    window.postMessage({ __watisPing: true }, '*');
  });
  // 2. Is a content-script fetch bound by the PAGE's connect-src? example.com is not in WhatsApp's CSP.
  const tryFetch = async (u) => {
    try { const r = await fetch(u, { method: 'GET' }); return `${r.status} len=${(await r.text()).length}` }
    catch (e) { return 'THREW:' + e.name + ':' + String(e.message).slice(0, 80) }
  };
  report.fetchSameOrigin = await tryFetch('https://web.whatsapp.com/favicon.ico');
  report.fetchOffCspHost = await tryFetch('https://example.com/');
  // 3. WASM inside the ISOLATED world (page CSP allows only wasm-unsafe-eval)
  try { new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0])); report.wasmIsolated = 'COMPILED' }
  catch (e) { report.wasmIsolated = 'THREW:' + e.name }
  // 4. eval inside the ISOLATED world
  try { report.evalIsolated = eval('6*7') } catch (e) { report.evalIsolated = 'THREW:' + e.name }
  report.mainReport = document.documentElement.getAttribute('data-watis2-main');
  console.log('WATIS2 ' + JSON.stringify(report));
})();
