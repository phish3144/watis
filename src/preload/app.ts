import { contextBridge, ipcRenderer } from 'electron'

/** Preload for our own React panel. Typed, minimal, and explicit about what it exposes. */
const api = {
  getVersions: (): Promise<{ app: string; electron: string; chrome: string; node: string }> =>
    ipcRenderer.invoke('app:versions'),
  getWorkerHealth: (): Promise<{ archive: boolean; contentIndex: boolean }> =>
    ipcRenderer.invoke('app:worker-health'),
  getPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('app:paths'),
}

contextBridge.exposeInMainWorld('watis', api)

export type AppPreloadApi = typeof api
