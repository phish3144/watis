import {
  parseSettings,
  settingsPatchSchema,
  type Settings,
  type SettingsPatch,
} from '@shared/settings'
import { dateStamp, sanitiseComponent, sanitiseFilename } from '@shared/files/sanitise'
import type { BridgeCommand } from '../../bridge/protocol'
import { ext, sendToTab, whatsappTabs } from '../ext'
import { ArchiveHost } from '../host/archive-host'
import { SETTINGS_KEY, STATUS, type ExtensionStatus, type Reply } from '../protocol'
import { t } from './strings'

/**
 * The panel's only door to everything else (ADR 0010).
 *
 * Archive requests go to the WhatsApp tab, whose relay hands them to the archive frame. When no
 * WhatsApp tab is open, the panel opens the archive itself — searching should not need WhatsApp to
 * be running — and gives it back the moment a tab appears, so the mirror always writes into the
 * archive the tab holds.
 */

// --- the archive -------------------------------------------------------------------------------

let ownHost: ArchiveHost | undefined

async function hostLocally(want: boolean): Promise<void> {
  if (want && !ownHost) {
    ownHost = new ArchiveHost({
      where: 'panel',
      report: (report) => {
        if (report.kind === 'status') void ext.storage.session.set({ [STATUS.host]: report.status })
      },
    })
    await ownHost.start()
  } else if (!want && ownHost) {
    ownHost.stop()
    ownHost = undefined
  }
}

/** Keeps the archive where it belongs: with the tab if there is one, here if there is not. */
export function watchArchiveHome(): () => void {
  const check = async (): Promise<void> => {
    const [tab] = await whatsappTabs()
    await hostLocally(tab?.id === undefined)
  }
  void check()
  const timer = setInterval(() => void check(), 3_000)
  return () => {
    clearInterval(timer)
  }
}

async function toArchive(message: unknown): Promise<Reply> {
  const [tab] = await whatsappTabs()
  if (tab?.id !== undefined) {
    const reply = await sendToTab<Reply>(tab.id, message)
    if (reply) return reply
    return { ok: false, error: 'Der WhatsApp-Tab antwortet nicht. Vielleicht lädt er gerade neu.' }
  }
  if (!ownHost) await hostLocally(true)
  const host = ownHost
  if (!host) return { ok: false, error: 'Das Archiv ist nicht geöffnet.' }
  const kind = (message as { kind: string }).kind
  if (kind === 'archive') return host.request((message as { request: unknown }).request)
  if (kind === 'export-database') return host.exportDatabase()
  return { ok: false, error: 'Dafür muss WhatsApp Web offen sein.' }
}

function unwrap(reply: Reply): unknown {
  if (!reply.ok) throw new Error(reply.error)
  return reply.value
}

export async function archive<T>(request: Record<string, unknown>): Promise<T> {
  return unwrap(await toArchive({ kind: 'archive', request })) as T
}

export async function fetchMedia(mediaId: string): Promise<void> {
  unwrap(await toArchive({ kind: 'fetch-media', mediaId }))
}

/**
 * Transcribes a voice message in the WhatsApp tab (Firefox, ADR 0012). The tab has to be open: it
 * holds the only page Firefox lets whisper.cpp run in.
 */
export async function transcribeInTab(mediaId: string, path: string): Promise<string> {
  const [tab] = await whatsappTabs()
  if (tab?.id === undefined) throw new Error(t('transcription.needTab'))
  const reply = await sendToTab<Reply>(tab.id, { kind: 'transcribe', mediaId, path })
  return unwrap(reply ?? { ok: false, error: 'Der WhatsApp-Tab antwortet nicht.' }) as string
}

/**
 * A consistent copy of the database as an OPFS file, for a backup to take along. The caller
 * removes it afterwards ({@link removeOpfs}); it is as large as the database.
 */
export async function exportDatabaseFile(): Promise<{ file: File; path: string }> {
  const { path } = unwrap(await toArchive({ kind: 'export-database' })) as { path: string }
  return { file: await readOpfs(path), path }
}

// --- the bridge --------------------------------------------------------------------------------

/** One read-only command to the bridge in the WhatsApp tab — opening a chat, for instance. */
export async function bridge(
  op: BridgeCommand['op'],
  args?: Record<string, unknown>,
): Promise<unknown> {
  const [tab] = await whatsappTabs()
  if (tab?.id === undefined) throw new Error('WhatsApp Web ist nicht offen.')
  if (tab.windowId !== undefined) await ext.windows.update(tab.windowId, { focused: true })
  await ext.tabs.update(tab.id, { active: true })
  return unwrap(
    (await sendToTab<Reply>(
      tab.id,
      args ? { kind: 'bridge', op, args } : { kind: 'bridge', op },
    )) ?? {
      ok: false,
      error: 'Der WhatsApp-Tab antwortet nicht.',
    },
  )
}

/** The panel as a page of its own, in a full browser tab — the layout for working through the archive. */
export async function openLarge(): Promise<void> {
  const url = ext.runtime.getURL('panel.html')
  const [existing] = await ext.tabs.query({ url })
  if (existing?.id !== undefined) {
    await ext.tabs.update(existing.id, { active: true })
    if (existing.windowId !== undefined)
      await ext.windows.update(existing.windowId, { focused: true })
    return
  }
  await ext.tabs.create({ url })
}

export async function openWhatsApp(): Promise<void> {
  const [tab] = await whatsappTabs()
  if (tab?.id !== undefined) {
    await ext.tabs.update(tab.id, { active: true })
    if (tab.windowId !== undefined) await ext.windows.update(tab.windowId, { focused: true })
    return
  }
  await ext.tabs.create({ url: 'https://web.whatsapp.com/' })
}

// --- settings ----------------------------------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  const stored = await ext.storage.local.get(SETTINGS_KEY)
  return parseSettings(stored[SETTINGS_KEY])
}

/** Validated against the shared schema; an invalid patch is refused rather than half-applied. */
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const valid = settingsPatchSchema.safeParse(patch)
  if (!valid.success) throw new Error('invalid settings')
  const next = parseSettings({ ...(await loadSettings()), ...valid.data })
  await ext.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}

export function onSettings(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    const change = changes[SETTINGS_KEY]
    if (area === 'local' && change) listener(parseSettings(change.newValue))
  }
  ext.storage.onChanged.addListener(handler)
  return () => {
    ext.storage.onChanged.removeListener(handler)
  }
}

// --- status ------------------------------------------------------------------------------------

const STATUS_FIELDS = {
  bridge: STATUS.bridge,
  importer: STATUS.importer,
  unread: STATUS.unread,
  host: STATUS.host,
  media: STATUS.media,
} as const

export async function loadStatus(): Promise<ExtensionStatus> {
  const stored = await ext.storage.session.get(Object.values(STATUS_FIELDS))
  return Object.fromEntries(
    Object.entries(STATUS_FIELDS).map(([field, key]) => [field, stored[key]]),
  )
}

export function onStatus(listener: () => void): () => void {
  const keys = new Set<string>(Object.values(STATUS_FIELDS))
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'session' && Object.keys(changes).some((key) => keys.has(key))) listener()
  }
  ext.storage.onChanged.addListener(handler)
  return () => {
    ext.storage.onChanged.removeListener(handler)
  }
}

export async function whatsappOpen(): Promise<boolean> {
  return (await whatsappTabs()).length > 0
}

/** Firefox grants MV3 host permissions at the user's discretion; the panel asks when it lacks one. */
export async function hasWhatsAppPermission(): Promise<boolean> {
  try {
    return await ext.permissions.contains({ origins: ['https://web.whatsapp.com/*'] })
  } catch {
    return true
  }
}

export async function requestWhatsAppPermission(): Promise<boolean> {
  return ext.permissions.request({ origins: ['https://web.whatsapp.com/*'] })
}

// --- files -------------------------------------------------------------------------------------

/** Reads a file from the extension's OPFS — the panel shares it with the archive's worker. */
export async function readOpfs(path: string): Promise<File> {
  const parts = path.split('/')
  const name = parts.pop()
  if (!name) throw new Error(`not a file path: ${path}`)
  let dir = await navigator.storage.getDirectory()
  for (const part of parts) dir = await dir.getDirectoryHandle(part)
  return (await dir.getFileHandle(name)).getFile()
}

export async function removeOpfs(path: string): Promise<void> {
  const parts = path.split('/')
  const name = parts.pop()
  if (!name) return
  try {
    let dir = await navigator.storage.getDirectory()
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    await dir.removeEntry(name)
  } catch {
    // Already gone.
  }
}

const urls = new Map<string, string>()

/** An object URL for a stored blob, cached so a list that scrolls back does not read it twice. */
export async function blobUrl(path: string): Promise<string> {
  const cached = urls.get(path)
  if (cached) return cached
  const url = URL.createObjectURL(await readOpfs(path))
  urls.set(path, url)
  if (urls.size > 300) {
    const [oldest, stale] = urls.entries().next().value ?? []
    if (oldest && stale) {
      urls.delete(oldest)
      URL.revokeObjectURL(stale)
    }
  }
  return url
}

/** The OPFS path of an attachment, or null while it has not been fetched. */
export async function mediaPath(mediaId: string): Promise<string | null> {
  return (await archive<{ path: string | null }>({ op: 'blobPath', mediaId })).path
}

async function saveBlob(blob: Blob, filename: string, saveAs = false): Promise<void> {
  const url = URL.createObjectURL(blob)
  try {
    await ext.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' })
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 60_000)
  }
}

/** Saves an archived file as `WatIs/<Chat>/<YYYY-MM-DD>_<Name>` in the downloads folder. */
export async function saveMedia(options: {
  path: string
  chatName: string
  filename: string | null
  ts: number
}): Promise<void> {
  const file = await readOpfs(options.path)
  const fallback = options.path.split('/').pop() ?? 'Datei'
  const name = sanitiseFilename(options.filename ?? fallback)
  const folder = sanitiseComponent(options.chatName, { fallback: 'Unsortiert' })
  await saveBlob(file, `WatIs/${folder}/${dateStamp(new Date(options.ts * 1000))}_${name}`)
}

export const version: string = ext.runtime.getManifest().version
