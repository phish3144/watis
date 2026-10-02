import { install } from './index'

/**
 * The desktop's bridge bundle: installs on evaluation, because `main/bridge/host.ts` evaluates it
 * exactly when it should run — after every `did-finish-load`.
 *
 * Kept apart from `index.ts` so that `install` can be imported without this side effect: the
 * browser extension decides for itself when to install (ADR 0010, `extension/page/bridge-entry.ts`).
 */

declare const window: { __watisBridge?: { stop: () => void } }

// Re-injection happens on every navigation, and WhatsApp Web navigates on its own. Without this
// the listeners would stack and every message would be mirrored several times over.
window.__watisBridge?.stop()
window.__watisBridge = install()
