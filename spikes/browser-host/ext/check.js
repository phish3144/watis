// Top-level extension page: does it see the frame's OPFS and its Web Lock?
const out = {}
try {
  const dir = await navigator.storage.getDirectory()
  const fh = await dir.getFileHandle('marker.txt')
  out.marker = await (await fh.getFile()).text()
} catch (e) {
  out.markerError = String(e)
}
try {
  const state = await navigator.locks.query()
  out.heldLocks = state.held.map((l) => l.name)
} catch (e) {
  out.lockError = String(e)
}
try {
  out.persisted = await navigator.storage.persisted()
} catch (e) {
  out.persistError = String(e)
}
document.documentElement.setAttribute('data-check', JSON.stringify(out))
document.title = 'done'
