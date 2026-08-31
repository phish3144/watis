import { z } from 'zod'

/**
 * Every user-facing switch in one place, with a schema.
 *
 * The renderer never writes settings directly; it sends a patch over IPC that is validated
 * against this schema in main. An invalid patch is dropped and logged rather than applied.
 */

export const settingsSchema = z.object({
  // --- Fenster und Tray -------------------------------------------------
  closeToTray: z.boolean(),
  startMinimised: z.boolean(),
  autostart: z.boolean(),
  globalShortcut: z.string().max(64),
  zoomLevel: z.number().min(-5).max(5),

  // --- Benachrichtigungen -----------------------------------------------
  notifications: z.boolean(),
  /** No toast when the chat is already visible and the window has focus. */
  suppressWhenVisible: z.boolean(),
  /** One toast per chat per N milliseconds, with a count instead of a flood. */
  coalesceWindowMs: z.number().int().min(0).max(60_000),
  mutedChatsNotify: z.boolean(),
  dndEnabled: z.boolean(),
  dndFrom: z.string().regex(/^\d{2}:\d{2}$/),
  dndTo: z.string().regex(/^\d{2}:\d{2}$/),

  // --- Darstellung -------------------------------------------------------
  compactMode: z.boolean(),
  fontScale: z.number().min(0.8).max(1.6),
  customCssEnabled: z.boolean(),

  // --- Entrümpeln --------------------------------------------------------
  hideChannels: z.boolean(),
  hideStatus: z.boolean(),
  hideMetaAi: z.boolean(),

  // --- Eingabe -----------------------------------------------------------
  /** true: Enter inserts a newline, Ctrl+Enter sends. */
  enterInsertsNewline: z.boolean(),
  /**
   * BCP-47 tags for the spell checker. Empty switches it off entirely, which on Windows also means
   * no dictionary download — Chromium fetches hunspell dictionaries from a Google host, and the
   * project allows outbound traffic only to WhatsApp and GitHub Releases.
   */
  spellcheckLanguages: z.array(z.string().max(16)).max(6),
  /** `deviceId` for setSinkId. Empty means the system default. */
  audioOutputDeviceId: z.string().max(200),
  /** Register for whatsapp:// links. Per-user registry only; never HKLM. */
  handleWhatsappLinks: z.boolean(),

  // --- Dateien -----------------------------------------------------------
  downloadDir: z.string(),
  /** ~/Downloads/WhatsApp/<Chat>/<YYYY-MM-DD>_<Name> */
  sortDownloadsByChat: z.boolean(),
  notifyOnDownload: z.boolean(),

  // --- Inhaltsindex ------------------------------------------------------
  /** The tray's pause switch for OCR and text extraction. */
  indexPaused: z.boolean(),
  /** Seconds of inactivity before indexing starts. */
  indexIdleThresholdSeconds: z.number().int().min(5).max(3600),
  /** Index on battery too. Off by default: OCR is the most expensive thing the app does. */
  indexOnBattery: z.boolean(),
  indexConcurrency: z.number().int().min(1).max(4),

  // --- Export und Backup -------------------------------------------------
  /** Timed export into a folder something like restic or rsync then picks up. */
  scheduledExportEnabled: z.boolean(),
  scheduledExportDir: z.string(),
  scheduledExportFormats: z.array(z.enum(['json', 'html', 'txt'])).min(1),
  /** Hours between runs. Daily by default; anything shorter is churn for no gain. */
  scheduledExportEveryHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14),
})

export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = {
  closeToTray: true,
  startMinimised: false,
  autostart: false,
  globalShortcut: 'CommandOrControl+Shift+W',
  zoomLevel: 0,

  notifications: true,
  suppressWhenVisible: true,
  coalesceWindowMs: 3000,
  mutedChatsNotify: false,
  dndEnabled: false,
  dndFrom: '22:00',
  dndTo: '07:00',

  compactMode: false,
  fontScale: 1,
  customCssEnabled: false,

  hideChannels: false,
  hideStatus: false,
  hideMetaAi: false,

  enterInsertsNewline: false,
  spellcheckLanguages: [],
  audioOutputDeviceId: '',
  handleWhatsappLinks: false,

  downloadDir: '',
  sortDownloadsByChat: true,
  notifyOnDownload: true,

  indexPaused: false,
  indexIdleThresholdSeconds: 60,
  indexOnBattery: false,
  indexConcurrency: 1,

  scheduledExportEnabled: false,
  scheduledExportDir: '',
  scheduledExportFormats: ['json'],
  scheduledExportEveryHours: 24,
}

/** Merges a stored object with the defaults, dropping anything that does not validate. */
export function parseSettings(raw: unknown): Settings {
  const result = settingsSchema.safeParse({ ...defaultSettings, ...(raw as object) })
  return result.success ? result.data : defaultSettings
}

export const settingsPatchSchema = settingsSchema.partial()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
