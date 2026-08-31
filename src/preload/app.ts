import { contextBridge, ipcRenderer } from 'electron'
import type { Settings, SettingsPatch } from '@shared/settings'
import type { HealthState } from '@shared/health/degraded'
import type { BridgeReady } from '../bridge/protocol'
import type { ImporterStats } from '../main/archive/importer'

/** Preload for our own panel. Typed, minimal, explicit about what it exposes. */
const api = {
  getVersions: (): Promise<{ app: string; electron: string; chrome: string; node: string }> =>
    ipcRenderer.invoke('app:versions'),
  getWorkerHealth: (): Promise<{ archive: boolean; contentIndex: boolean }> =>
    ipcRenderer.invoke('app:worker-health'),
  getPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('app:paths'),
  getHealth: (): Promise<HealthState> => ipcRenderer.invoke('app:health'),
  getImportStats: (): Promise<ImporterStats | null> => ipcRenderer.invoke('app:import-stats'),

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
