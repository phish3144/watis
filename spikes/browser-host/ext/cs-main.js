// MAIN world, document_start: can the page world be reached, and does Meta's loader appear?
document.documentElement.setAttribute('data-probe-main', 'ran')
const started = Date.now()
const poll = setInterval(() => {
  const req = typeof window.require
  if (req === 'function' || Date.now() - started > 20000) {
    clearInterval(poll)
    document.documentElement.setAttribute(
      'data-probe-require',
      `${req} after ${Date.now() - started} ms`,
    )
  }
}, 100)
