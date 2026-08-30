function report() {
  const r = {
    crossOriginIsolated: self.crossOriginIsolated,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  };
  try { new SharedArrayBuffer(1024); r.sabAllocates = true } catch (e) { r.sabAllocates = 'THREW:' + e.name }
  try { r.wasmMemoryShared = !!(new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }).buffer instanceof SharedArrayBuffer) }
  catch (e) { r.wasmMemoryShared = 'THREW:' + e.name }
  return r;
}
chrome.runtime.onMessage.addListener((m) => { if (m && m.askOffscreen) chrome.runtime.sendMessage({ offscreenReport: report() }) });
chrome.runtime.sendMessage({ offscreenReport: report() });
