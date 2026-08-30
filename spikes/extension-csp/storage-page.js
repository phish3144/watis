(async () => {
  const r = { origin: location.origin, crossOriginIsolated: self.crossOriginIsolated };
  const est0 = await navigator.storage.estimate();
  r.quotaBefore = est0.quota; r.usageBefore = est0.usage;
  r.persistedBefore = await navigator.storage.persisted();
  try { r.persistResult = await navigator.storage.persist() } catch (e) { r.persistResult = 'THREW:' + e.name }
  r.persistedAfter = await navigator.storage.persisted();
  const est1 = await navigator.storage.estimate();
  r.quotaAfter = est1.quota;
  // OPFS + the synchronous access handle SQLite-WASM needs (worker only)
  const workerSrc = `onmessage = async () => {
    const out = {};
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('probe.bin', { create: true });
      const sah = await fh.createSyncAccessHandle();
      const chunk = new Uint8Array(1024 * 1024).fill(65);
      let written = 0;
      try { for (let i = 0; i < 256; i++) { sah.write(chunk, { at: written }); written += chunk.length } }
      catch (e) { out.writeStoppedAt = written; out.writeError = e.name + ':' + String(e.message).slice(0,120) }
      out.bytesWritten = written;
      out.sizeOnDisk = sah.getSize();
      sah.close();
      out.syncAccessHandle = 'OK';
    } catch (e) { out.syncAccessHandle = 'THREW:' + e.name + ':' + String(e.message).slice(0,120) }
    postMessage(out);
  }`;
  const w = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
  r.worker = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.onerror = (e) => res('WORKER-ERR:' + e.message); w.postMessage(1); setTimeout(() => res('TIMEOUT'), 60000) });
  const est2 = await navigator.storage.estimate();
  r.usageAfter = est2.usage; r.quotaFinal = est2.quota;
  document.getElementById('o').textContent = JSON.stringify(r, null, 1);
  console.log('STORAGE-PROBE ' + JSON.stringify(r));
})();
