/**
 * The extension API, the same way in Chrome, Edge and Firefox (ADR 0010).
 *
 * Firefox provides `browser.*` with promises; Chromium provides `chrome.*`, which returns promises
 * in Manifest V3 when no callback is passed. Both implement the same WebExtensions surface for
 * everything this project uses, so the code is written against `chrome`'s types and resolved to
 * whichever object the browser actually has. Browser-specific APIs (`sidePanel` in Chromium,
 * `sidebarAction` in Firefox) are reached through `optional()` and always have a fallback.
 */

declare const browser: typeof chrome | undefined

export const ext: typeof chrome = typeof browser !== 'undefined' ? browser : chrome

/** True in Firefox. Used only where the two genuinely differ, never to pick a code path by habit. */
export const isFirefox: boolean = typeof browser !== 'undefined'

/**
 * Sends to the other extension contexts and treats "nobody is listening" as an ordinary answer.
 *
 * `runtime.sendMessage` rejects when no context has a listener — at startup, before the archive
 * host has come up, that is the normal case and not an error worth a stack trace.
 */
export async function send<T = unknown>(message: unknown): Promise<T | undefined> {
  try {
    return await ext.runtime.sendMessage<unknown, T>(message)
  } catch (error) {
    if (/Receiving end does not exist|Could not establish connection/i.test(String(error))) {
      return undefined
    }
    throw error
  }
}

/** Sends into one tab's content script. Same "nobody listening" tolerance as `send`. */
export async function sendToTab<T = unknown>(
  tabId: number,
  message: unknown,
): Promise<T | undefined> {
  try {
    return await ext.tabs.sendMessage<unknown, T>(tabId, message)
  } catch (error) {
    if (/Receiving end does not exist|Could not establish connection/i.test(String(error))) {
      return undefined
    }
    throw error
  }
}

/** Every open WhatsApp Web tab, most recently used first. */
export async function whatsappTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await ext.tabs.query({ url: 'https://web.whatsapp.com/*' })
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
}
