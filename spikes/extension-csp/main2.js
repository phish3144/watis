;(() => {
  const out = {}
  out.hasDefine = typeof window.__d
  out.hasRequireLazy = typeof window.requireLazy
  // Meta's loader keeps a module registry; probe how reachable it is from MAIN world.
  try {
    let seen = 0,
      names = []
    const orig = window.__d
    out.defineIsFunction = typeof orig === 'function'
    // Count already-registered modules by re-registering a probe and watching arity.
    out.defineArity = typeof orig === 'function' ? orig.length : null
  } catch (e) {
    out.defineProbe = 'THREW:' + e.name
  }
  try {
    out.wasm =
      typeof WebAssembly !== 'undefined'
        ? (() => {
            try {
              new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
              return 'COMPILED'
            } catch (e) {
              return 'THREW:' + e.name
            }
          })()
        : 'NO-WEBASSEMBLY'
  } catch (e) {
    out.wasm = 'THREW:' + e.name
  }
  // The architectural question: can MAIN talk to ISOLATED? MAIN has no chrome.* APIs.
  window.addEventListener('message', (ev) => {
    if (ev.source === window && ev.data && ev.data.__watisPing) {
      window.postMessage({ __watisPong: true, payload: out }, '*')
    }
  })
  document.documentElement.setAttribute('data-watis2-main', JSON.stringify(out))
})()
