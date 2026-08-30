import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload for the WhatsApp view. Runs in the isolated world and is a pure message channel —
 * nothing more.
 *
 * The read-only bridge that reads WhatsApp's internal stores lives in the PAGE world and
 * arrives in phase 3; internal modules are only reachable there. This file will never touch
 * them, and it will never write.
 *
 * Sandboxed, so this must stay CommonJS: sandboxed preloads cannot use ESM imports.
 */
const api = {
  /** Reports the document title so main can parse the unread count from it. */
  reportTitle: (title: string): void => {
    ipcRenderer.send('wa:title', title)
  },
}

contextBridge.exposeInMainWorld('watis', api)

export type WaPreloadApi = typeof api

window.addEventListener('DOMContentLoaded', () => {
  const report = (): void => {
    api.reportTitle(document.title)
  }
  report()
  const titleElement = document.querySelector('title')
  if (titleElement) {
    new MutationObserver(report).observe(titleElement, { childList: true })
  }
})
