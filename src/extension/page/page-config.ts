/**
 * MAIN world, `document_start`. The build places the desktop's page shims (notifications, Enter
 * key, image viewer zoom) directly above this code, as literal source — WhatsApp's CSP forbids
 * `eval`, so a shim that arrived as a string could never be run from here (ADR 0010).
 *
 * What this file adds is the one channel the desktop has and the extension lacks: on the desktop,
 * main flips a page flag with `executeJavaScript`; here the relay in the isolated world cannot
 * touch page globals, so it sends a CustomEvent and this listener sets the flag.
 */

declare const window: { __watisEnterKeyInsertsNewline?: boolean }

interface PageConfig {
  enterInsertsNewline?: boolean
}

document.addEventListener('watis:page-config', (event) => {
  const detail = (event as CustomEvent<unknown>).detail
  if (typeof detail !== 'string') return
  let config: PageConfig
  try {
    config = JSON.parse(detail) as PageConfig
  } catch {
    return
  }
  if (typeof config.enterInsertsNewline === 'boolean') {
    window.__watisEnterKeyInsertsNewline = config.enterInsertsNewline
  }
})
