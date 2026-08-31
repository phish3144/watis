import { contextBridge, ipcRenderer } from 'electron'
import type { Settings, SettingsPatch } from '@shared/settings'

/** Preload for our own panel. Typed, minimal, explicit about what it exposes. */
const api = {
  getVersions: (): Promise<{ app: string; electron: string; chrome: string; node: string }> =>
    ipcRenderer.invoke('app:versions'),
  getWorkerHealth: (): Promise<{ archive: boolean; contentIndex: boolean }> =>
    ipcRenderer.invoke('app:worker-health'),
  getPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('app:paths'),
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
