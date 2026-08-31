import { contextBridge, ipcRenderer } from 'electron'
import type { Settings, SettingsPatch } from '@shared/settings'
import type { HealthState } from '@shared/health/degraded'
import type { BridgeReady } from '../bridge/protocol'
import type { ImporterStats } from '../main/archive/importer'
import type { BackfillSnapshot } from '../main/backfill/state-machine'
import type { StorageOverview } from '@shared/extras/storage-overview'

export interface ExportScheduleState {
  lastRunMs?: number
  lastError?: string
  lastResult?: { chats: number; messages: number }
  nextDueMs?: number
}

export type BackfillState = BackfillSnapshot & { pauseReason?: 'bridge' | 'in-use' | undefined }

/** Preload for our own panel. Typed, minimal, explicit about what it exposes. */
const api = {
  getVersions: (): Promise<{ app: string; electron: string; chrome: string; node: string }> =>
    ipcRenderer.invoke('app:versions'),
  getWorkerHealth: (): Promise<{ archive: boolean; contentIndex: boolean }> =>
    ipcRenderer.invoke('app:worker-health'),
  getPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('app:paths'),
  getHealth: (): Promise<HealthState> => ipcRenderer.invoke('app:health'),
  getImportStats: (): Promise<ImporterStats | null> => ipcRenderer.invoke('app:import-stats'),
  getStorage: (): Promise<StorageOverview> => ipcRenderer.invoke('app:storage'),
  getSpellcheckLanguages: (): Promise<string[]> => ipcRenderer.invoke('app:spellcheck-languages'),

  /** Files on disk: where a blob is, opening it, showing it, and dragging it out. */
  files: {
    blobPath: (mediaId: string): Promise<string | null> =>
      ipcRenderer.invoke('app:blob-path', { mediaId }),
    open: (path: string): Promise<string> => ipcRenderer.invoke('app:open-path', { path }),
    reveal: (path: string): Promise<boolean> => ipcRenderer.invoke('app:reveal', { path }),
    /** Fire-and-forget: a native drag has no result to wait for. */
    startDrag: (path: string): void => {
      ipcRenderer.send('app:drag-out', { path })
    },
  },
  clearCaches: (): Promise<StorageOverview> => ipcRenderer.invoke('app:clear-caches'),
  getIndexStatus: (): Promise<unknown> => ipcRenderer.invoke('app:index-status'),
  reindex: (kind: string): Promise<unknown> => ipcRenderer.invoke('app:reindex', { kind }),

  /** Export and backup. Both run in the archive worker; main only relays. */
  exportSchedule: {
    state: (): Promise<ExportScheduleState | null> => ipcRenderer.invoke('app:export-schedule'),
    runNow: (): Promise<boolean> => ipcRenderer.invoke('app:export-now'),
  },
  backup: (targetDir: string, includeBlobs = true): Promise<unknown> =>
    ipcRenderer.invoke('app:backup', { targetDir, includeBlobs }),

  /** The three read-only bridge commands the UI may ask for. Nothing here writes. */
  bridge: {
    snapshot: (): Promise<unknown> => ipcRenderer.invoke('bridge:snapshot'),
    openChat: (chatId: string, msgId?: string): Promise<unknown> =>
      ipcRenderer.invoke('bridge:open-chat', { chatId, msgId }),
    loadOlder: (chatId: string): Promise<unknown> =>
      ipcRenderer.invoke('bridge:load-older', {
        chatId,
      }),
  },

  /** The backfill. Started by the user, never on its own — see ADR 0006. */
  backfill: {
    state: (): Promise<BackfillState> => ipcRenderer.invoke('backfill:state'),
    start: (chatIds: string[]): Promise<BackfillSnapshot> =>
      ipcRenderer.invoke('backfill:start', { chatIds }),
    stop: (): Promise<boolean> => ipcRenderer.invoke('backfill:stop'),
  },
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('app:settings'),
  updateSettings: (patch: SettingsPatch): Promise<Settings> =>
    ipcRenderer.invoke('app:update-settings', patch),

  /** The archive data plane. Shapes live in @shared/ipc/archive-protocol. */
  archive: (request: unknown): Promise<unknown> => ipcRenderer.invoke('archive:request', request),

  onSettings: (listener: (settings: Settings) => void): (() => void) => {
    const handler = (_event: unknown, value: Settings): void => {
      listener(value)
    }
    ipcRenderer.on('app:settings', handler)
    return () => ipcRenderer.removeListener('app:settings', handler)
  },
  onBackfill: (listener: (snapshot: BackfillSnapshot) => void): (() => void) => {
    const handler = (_event: unknown, value: BackfillSnapshot): void => {
      listener(value)
    }
    ipcRenderer.on('app:backfill', handler)
    return () => ipcRenderer.removeListener('app:backfill', handler)
  },
  onBridge: (listener: (report: BridgeReady) => void): (() => void) => {
    const handler = (_event: unknown, value: BridgeReady): void => {
      listener(value)
    }
    ipcRenderer.on('app:bridge', handler)
    return () => ipcRenderer.removeListener('app:bridge', handler)
  },
  onHealth: (listener: (state: HealthState) => void): (() => void) => {
    const handler = (_event: unknown, value: HealthState): void => {
      listener(value)
    }
    ipcRenderer.on('app:health', handler)
    return () => ipcRenderer.removeListener('app:health', handler)
  },
  onUnread: (listener: (counts: { unread: number; mutedUnread: number }) => void): (() => void) => {
    const handler = (_event: unknown, value: { unread: number; mutedUnread: number }): void => {
      listener(value)
    }
    ipcRenderer.on('app:unread', handler)
    return () => ipcRenderer.removeListener('app:unread', handler)
  },
}

contextBridge.exposeInMainWorld('watis', api)
export type AppPreloadApi = typeof api
