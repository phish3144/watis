import { mkdir, utimes } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Notification, shell } from 'electron'
import type { Session } from 'electron'
import { settings } from '../config/store'
import { platform } from '@platform/current'
import { log } from '../logging'
import { buildDownloadPath, resolveCollision, sanitiseFilename } from './filename'

/**
 * Downloads without a dialog, into a predictable folder.
 *
 * The important detail, measured on Electron 44: `downloadItem.getFilename()` returns the literal
 * string "download" for any blob: download whose suggested name contains a non-ASCII character.
 * WhatsApp decrypts media in-page and downloads it through `<a download>` on a blob: URL, so for
 * a German archive that is the normal case, not an edge case — every file would be called
 * "download", "download (1)", "download (2)". The real name therefore comes from the preload,
 * which reads it off the anchor before the click, and this module only falls back to Electron's
 * value when nothing better arrived.
 */

export interface DownloadContext {
  /** Name of the chat currently on screen, for the folder. */
  activeChat(): string
  /** Filename captured from the DOM by the preload, most recent first. */
  takeSuggestedName(): string | undefined
}

const PLACEHOLDER_NAMES = new Set(['download', 'download.bin', ''])

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'text/plain': '.txt',
    'application/zip': '.zip',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  }
  return map[mime.split(';')[0]?.trim() ?? ''] ?? ''
}

export function installDownloadHandler(session: Session, context: DownloadContext): void {
  session.on('will-download', (_event, item) => {
    const config = settings()
    const electronName = item.getFilename()
    const suggested = context.takeSuggestedName()

    // Prefer the DOM-derived name; fall back to Electron's only when it is not the placeholder.
    // An empty DOM name must fall through to the fallback, so this is not a ?? case.
    const fromDom = suggested?.trim() ?? ''
    const fallback = PLACEHOLDER_NAMES.has(electronName.toLowerCase())
      ? `WhatsApp-Datei${extensionFromMime(item.getMimeType())}`
      : electronName
    const filename = fromDom === '' ? fallback : fromDom

    const { directory, filename: dated } = buildDownloadPath({
      root: config.downloadDir,
      chatName: context.activeChat(),
      filename: sanitiseFilename(filename),
      date: new Date(),
      sortByChat: config.sortDownloadsByChat,
    })

    let savePath: string
    try {
      savePath = resolveCollision(directory, dated)
    } catch (error: unknown) {
      log.error(`could not place download: ${String(error)}`)
      item.cancel()
      return
    }

    // mkdir must finish before Electron writes, so it is done synchronously-in-spirit: the
    // promise is started here and the save path set immediately; Electron buffers until the
    // first write, and a missing directory would surface as a failed item we then report.
    void mkdir(dirname(savePath), { recursive: true }).catch((error: unknown) => {
      log.error(`could not create download folder: ${String(error)}`)
    })

    item.setSavePath(savePath)
    log.info(`download -> ${savePath}`)

    item.once('done', (_doneEvent, state) => {
      if (state !== 'completed') {
        log.warn(`download ${state}: ${savePath}`)
        return
      }
      void finishDownload(savePath, config.notifyOnDownload)
    })
  })
}

async function finishDownload(savePath: string, notify: boolean): Promise<void> {
  // Give the file the time it was received, not the time it was written.
  const now = new Date()
  try {
    await utimes(savePath, now, now)
  } catch (error: unknown) {
    log.debug(`could not set mtime: ${String(error)}`)
  }

  if (!notify || !Notification.isSupported()) return

  const toast = new Notification({
    title: 'Datei gespeichert',
    body: savePath.split(/[\\/]/).pop() ?? savePath,
    // Buttons rather than only a click target: "open" and "show in folder" are different
    // intentions, and guessing which one somebody meant from a single click gets it wrong half
    // the time. Windows shows these in the toast; macOS puts them behind the alert's action
    // button; a platform with neither still has the click, which opens the file.
    actions: [
      { type: 'button', text: 'Öffnen' },
      { type: 'button', text: 'Im Ordner zeigen' },
    ],
  })
  toast.on('click', () => {
    void shell.openPath(savePath)
  })
  toast.on('action', (_event, index) => {
    if (index === 1) platform().showItemInFolder(savePath)
    else void shell.openPath(savePath)
  })
  toast.show()
}

/** Used by the tray menu and the settings panel. */
export function revealDownload(savePath: string): void {
  platform().showItemInFolder(savePath)
}
