import { useCallback, useEffect, useState } from 'react'
import type { Settings, SettingsPatch } from '@shared/settings'
import type { ArchiveStats } from '@shared/ipc/archive-protocol'
import type { ChatRow } from '@shared/model/rows'
import type { ExtensionStatus } from '../protocol'
import {
  archive,
  loadSettings,
  loadStatus,
  onSettings,
  onStatus,
  saveSettings,
  whatsappOpen,
} from './api'

/** Settings, kept in sync with every other context that changes them. */
export function useSettings(): [Settings | undefined, (patch: SettingsPatch) => void] {
  const [settings, setSettings] = useState<Settings | undefined>(undefined)
  useEffect(() => {
    void loadSettings().then(setSettings)
    return onSettings(setSettings)
  }, [])
  const patch = useCallback((next: SettingsPatch) => {
    void saveSettings(next).then(setSettings)
  }, [])
  return [settings, patch]
}

export interface PanelStatus extends ExtensionStatus {
  whatsappOpen: boolean
  stats?: ArchiveStats | undefined
}

/**
 * Everything the status line needs. Read on mount and then watched — never only pushed, so a
 * panel opened late still knows (see protocol.ts, STATUS).
 */
export function usePanelStatus(): PanelStatus {
  const [status, setStatus] = useState<PanelStatus>({ whatsappOpen: false })
  useEffect(() => {
    let alive = true
    const refresh = async (): Promise<void> => {
      const [stored, open] = await Promise.all([loadStatus(), whatsappOpen()])
      let stats: ArchiveStats | undefined
      try {
        stats = await archive<ArchiveStats>({ op: 'stats' })
      } catch {
        stats = undefined
      }
      if (alive) setStatus({ ...stored, whatsappOpen: open, stats })
    }
    void refresh()
    const off = onStatus(() => void refresh())
    const timer = setInterval(() => void refresh(), 5_000)
    return () => {
      alive = false
      off()
      clearInterval(timer)
    }
  }, [])
  return status
}

export interface ChatInfo {
  name: string
  kind: ChatRow['kind']
}

/** Chat names by id, for labelling search hits and gallery items. Refreshed while open. */
export function useChats(): { chats: ChatRow[]; byId: Map<string, ChatInfo>; loaded: boolean } {
  const [chats, setChats] = useState<ChatRow[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const result = await archive<{ chats: ChatRow[] }>({ op: 'chats', limit: 1000 })
        if (alive) setChats(result.chats)
      } catch {
        // The archive is not reachable yet; the status line says why.
      } finally {
        if (alive) setLoaded(true)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 15_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  const byId = new Map(
    chats.map((chat) => [chat.id, { name: chat.name ?? chat.id, kind: chat.kind ?? null }]),
  )
  return { chats, byId, loaded }
}

const knownNames = new Map<string, string | null>()

/** Sender display names for the jids on screen, asked for once each. */
export function useSenderNames(jids: readonly (string | null | undefined)[]): Map<string, string> {
  const [, setVersion] = useState(0)
  const wanted = [...new Set(jids.filter((jid): jid is string => Boolean(jid)))]
  const missing = wanted.filter((jid) => !knownNames.has(jid))
  const key = missing.join('|')
  useEffect(() => {
    if (!key) return
    const ask = key.split('|')
    void archive<{ names: Record<string, string> }>({ op: 'senderNames', jids: ask }).then(
      (result) => {
        for (const jid of ask) knownNames.set(jid, result.names[jid] ?? null)
        setVersion((v) => v + 1)
      },
      () => undefined,
    )
  }, [key])
  const names = new Map<string, string>()
  for (const jid of wanted) {
    const name = knownNames.get(jid)
    if (name) names.set(jid, name)
  }
  return names
}
