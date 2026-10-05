import { parseSettings, type Settings } from '@shared/settings'
import { isWithinQuietHours } from '@shared/quiet-hours'
import { dateStamp, sanitiseComponent, sanitiseFilename } from '@shared/files/sanitise'
import { ext, isFirefox, sendToTab } from '../ext'
import {
  SETTINGS_KEY,
  STATUS,
  isMessage,
  type PageNotification,
  type UnreadCounts,
} from '../protocol'

/**
 * The extension's background: Chromium runs it as a service worker, Firefox as an event page
 * (ADR 0010). Either may be stopped after half a minute of quiet, so it keeps nothing that matters
 * in variables — status goes to `storage.session`, settings come from `storage.local` — and does
 * nothing that has to outlive one event. The archive is not here; it lives with the WhatsApp tab.
 *
 * What it does is the desktop's main-process furniture, as far as a browser allows: the unread
 * badge on the toolbar icon, notifications with coalescing and quiet hours, opening the panel, and
 * (Chromium only) sorting WhatsApp downloads into a folder per chat.
 */

async function settings(): Promise<Settings> {
  const stored = await ext.storage.local.get(SETTINGS_KEY)
  return parseSettings(stored[SETTINGS_KEY])
}

// --- the panel --------------------------------------------------------------------------------

interface FirefoxSidebar {
  toggle(): Promise<void>
}

function setUpPanel(): void {
  const sidePanel = (ext as { sidePanel?: typeof chrome.sidePanel }).sidePanel
  if (sidePanel) {
    // Chromium: the toolbar button opens the side panel next to WhatsApp, like the desktop panel.
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    return
  }
  const sidebar = (ext as { sidebarAction?: FirefoxSidebar }).sidebarAction
  ext.action.onClicked.addListener(() => {
    if (sidebar) {
      void sidebar.toggle()
      return
    }
    // Neither API: open the panel as a page of its own.
    void ext.tabs.create({ url: ext.runtime.getURL('panel.html') })
  })
}

setUpPanel()

// --- first run and housekeeping ---------------------------------------------------------------

const INSTALLED_KEY = 'watis:installed'

ext.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install') return
  void (async () => {
    // Firefox reports a temporary add-on loaded again after a restart as a fresh install, although
    // its archive is still there (the add-on id is fixed). Removing an extension clears its
    // storage, so this marker survives exactly when the archive does.
    const stored = await ext.storage.local.get(INSTALLED_KEY)
    if (stored[INSTALLED_KEY]) return
    await ext.storage.local.set({ [INSTALLED_KEY]: Date.now() })
    // A first run should say what this is and where it lives, not leave an icon to be discovered.
    await ext.tabs.create({ url: ext.runtime.getURL('panel.html#willkommen') })
  })()
})

/**
 * Frame tokens are single-use and removed when the frame connects. One left behind by a tab that
 * closed mid-load is pruned after an hour — never sooner, so a page loading right now keeps its own.
 */
async function pruneFrameTokens(): Promise<void> {
  const all = await ext.storage.local.get(null)
  const stale = Object.entries(all)
    .filter(([key, value]) => {
      if (!key.startsWith('watis:frame:')) return false
      const at = (value as { at?: unknown } | null)?.at
      return typeof at !== 'number' || Date.now() - at > 60 * 60 * 1000
    })
    .map(([key]) => key)
  if (stale.length > 0) await ext.storage.local.remove(stale)
}

ext.runtime.onStartup.addListener(() => void pruneFrameTokens())

// --- badge ------------------------------------------------------------------------------------

async function showUnread(counts: UnreadCounts): Promise<void> {
  const n = counts.unread
  await ext.action.setBadgeBackgroundColor({ color: '#008069' })
  await ext.action.setBadgeText({ text: n <= 0 ? '' : n > 99 ? '99+' : String(n) })
  await ext.storage.session.set({ [STATUS.unread]: counts })
}

// --- notifications ----------------------------------------------------------------------------

/**
 * Coalescing state. Held in memory on purpose: a burst lasts seconds, and if the background is
 * stopped in the middle of one the worst outcome is one extra toast — not worth a storage write per
 * message.
 */
const bursts = new Map<string, { count: number; latest: PageNotification; tabId: number }>()

async function suppressed(
  config: Settings,
  notification: PageNotification,
  tab: chrome.tabs.Tab | undefined,
): Promise<boolean> {
  if (!config.notifications) return true
  if (config.dndEnabled && isWithinQuietHours(new Date(), config.dndFrom, config.dndTo)) return true
  if (config.suppressWhenVisible && tab?.active && tab.windowId !== undefined) {
    const window = await ext.windows.get(tab.windowId)
    const stored = await ext.storage.session.get(STATUS.activeChat)
    const open = stored[STATUS.activeChat] as string | undefined
    // An empty title means no chat is open, which must not match anything.
    if (window.focused && open?.trim() && open.trim() === notification.title.trim()) return true
  }
  return false
}

function present(tabId: number, notification: PageNotification, count: number): void {
  const body =
    count > 1 ? `${notification.body}\n(+${String(count - 1)} weitere)` : notification.body
  void ext.notifications.create(`${String(tabId)}:${notification.id}`, {
    type: 'basic',
    title: notification.title,
    message: body,
    iconUrl: notification.icon.startsWith('data:') ? notification.icon : 'icons/icon-128.png',
  })
}

async function notify(
  notification: PageNotification,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const config = await settings()
  if (tab?.id === undefined || (await suppressed(config, notification, tab))) return
  const tabId = tab.id
  const key = notification.tag || notification.title
  if (config.coalesceWindowMs <= 0) {
    present(tabId, notification, 1)
    return
  }
  const burst = bursts.get(key)
  if (burst) {
    burst.count += 1
    burst.latest = notification
    return
  }
  // The first one shows at once; whatever follows inside the window is summarised at its end.
  present(tabId, notification, 1)
  bursts.set(key, { count: 1, latest: notification, tabId })
  setTimeout(() => {
    const entry = bursts.get(key)
    bursts.delete(key)
    if (entry && entry.count > 1) present(entry.tabId, entry.latest, entry.count)
  }, config.coalesceWindowMs)
}

ext.notifications.onClicked.addListener((notificationId) => {
  const [tab, ...rest] = notificationId.split(':')
  const tabId = Number(tab)
  const id = rest.join(':')
  if (!Number.isInteger(tabId)) return
  void (async () => {
    const target = await ext.tabs.update(tabId, { active: true })
    if (target?.windowId !== undefined) await ext.windows.update(target.windowId, { focused: true })
    // WhatsApp's own onclick opens the right chat — the same path the desktop takes.
    await sendToTab(tabId, { kind: 'notify-event', id, type: 'click' })
    await ext.notifications.clear(notificationId)
  })()
})

// --- downloads (Chromium) ---------------------------------------------------------------------

/**
 * `~/Downloads/WhatsApp/<Chat>/<YYYY-MM-DD>_<Name>`, as on the desktop. Only Chromium lets an
 * extension rename a download as it starts; Firefox has no such hook, and there the browser's own
 * naming stands (ADR 0010, "Was fehlt").
 */
function setUpDownloads(): void {
  const determining = ext.downloads.onDeterminingFilename as
    typeof chrome.downloads.onDeterminingFilename | undefined
  if (isFirefox || !determining) return
  determining.addListener((item, suggest) => {
    const fromWhatsApp =
      item.url.startsWith('blob:https://web.whatsapp.com/') ||
      item.referrer.startsWith('https://web.whatsapp.com/')
    if (!fromWhatsApp || item.byExtensionId) return undefined
    void (async () => {
      const config = await settings()
      const stored = await ext.storage.session.get([STATUS.activeChat, 'watis:download-name'])
      const open = stored[STATUS.activeChat] as string | undefined
      // No chat open (an empty title) sorts into the fallback folder, like a missing one.
      const chat = open === undefined || open === '' ? 'Unsortiert' : open
      const named = stored['watis:download-name'] as { name: string; at: number } | undefined
      const name = named && Date.now() - named.at < 10_000 ? named.name : item.filename || 'Datei'
      const file = `${dateStamp(new Date())}_${sanitiseFilename(name)}`
      const folder = config.sortDownloadsByChat
        ? `WhatsApp/${sanitiseComponent(chat, { fallback: 'Unsortiert' })}`
        : 'WhatsApp'
      suggest({ filename: `${folder}/${file}`, conflictAction: 'uniquify' })
    })()
    return true
  })
}

setUpDownloads()

// --- reports from the WhatsApp tab -----------------------------------------------------------

ext.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isMessage(message)) return undefined
  switch (message.kind) {
    case 'unread':
      void showUnread(message.counts)
      break
    case 'bridge-ready':
      void ext.storage.session.set({ [STATUS.bridge]: { ...message.report, at: Date.now() } })
      break
    case 'importer':
      void ext.storage.session.set({ [STATUS.importer]: { ...message.stats, at: Date.now() } })
      break
    case 'host-status':
      void ext.storage.session.set({ [STATUS.host]: message.status })
      break
    case 'media-stats':
      void ext.storage.session.set({ [STATUS.media]: { ...message.stats, at: Date.now() } })
      break
    case 'active-chat':
      void ext.storage.session.set({ [STATUS.activeChat]: message.title })
      break
    case 'download-name':
      void ext.storage.session.set({
        'watis:download-name': { name: message.name, at: Date.now() },
      })
      break
    case 'notify':
      void notify(message.notification, sender.tab)
      break
    case 'notify-close':
      if (sender.tab?.id !== undefined) {
        void ext.notifications.clear(`${String(sender.tab.id)}:${message.id}`)
      }
      break
  }
  return undefined
})

// Content scripts may read the session status too (the relay does not need to, but the panel in
// Firefox's sidebar is an extension page and can anyway). Chromium defaults it to trusted contexts.
void ext.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
