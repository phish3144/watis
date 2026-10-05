// Runs in the extension origin, framed inside web.whatsapp.com.
const report = { coi: self.crossOriginIsolated, href: location.href }
const send = () => parent.postMessage(report, 'https://web.whatsapp.com')
try {
  const dir = await navigator.storage.getDirectory()
  const marker = String(Math.random()).slice(2)
  const fh = await dir.getFileHandle('marker.txt', { create: true })
  const w = await fh.createWritable()
  await w.write(marker)
  await w.close()
  report.marker = marker
} catch (e) {
  report.markerError = String(e)
}
try {
  // Held for the life of this frame, so a top-level page can see whether it shares the lock manager.
  navigator.locks.request('watis-probe', () => new Promise(() => {}))
  report.lock = 'requested'
} catch (e) {
  report.lockError = String(e)
}
try {
  const worker = new Worker('worker.js', { type: 'module' })
  const result = await new Promise((resolve) => {
    worker.onmessage = (e) => resolve(e.data)
    worker.onerror = (e) =>
      resolve({ workerError: { type: e.type, message: e.message, filename: e.filename } })
    setTimeout(() => resolve({ workerError: 'timeout' }), 20000)
  })
  report.sqlite = result
} catch (e) {
  report.sqliteError = String(e)
}
for (const p of ['worker.js', 'sqlite/index.mjs']) {
  try {
    const r = await fetch(p)
    report[`fetch ${p}`] = `${r.status} ${r.headers.get('content-type')}`
  } catch (e) {
    report[`fetch ${p}`] = String(e)
  }
}
try {
  const classic = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'])))
  report.blobWorker = await new Promise((r) => {
    classic.onmessage = () => r('ok')
    classic.onerror = (e) => r(`error ${e.message}`)
    setTimeout(() => r('timeout'), 5000)
  })
} catch (e) {
  report.blobWorker = String(e)
}
try {
  const plain = new Worker('plain-worker.js')
  report.plainWorker = await new Promise((r) => {
    plain.onmessage = () => r('ok')
    plain.onerror = (e) => r(`error ${e.message}`)
    setTimeout(() => r('timeout'), 5000)
  })
} catch (e) {
  report.plainWorker = String(e)
}
send()
