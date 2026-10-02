import { useCallback, useEffect, useState } from 'react'
import {
  openLarge,
  openWhatsApp,
  hasWhatsAppPermission,
  requestWhatsAppPermission,
  watchArchiveHome,
} from './api'
import { usePanelStatus, useSettings, type PanelStatus } from './hooks'
import { count } from './format'
import { ChatIcon, ExpandIcon, ImageIcon, MoreIcon, SearchIcon } from './icons'
import { t, type StringKey } from './strings'
import { Button, IconButton, Sheet } from './ui'
import { ChatsView } from './views/ChatsView'
import { MediaView } from './views/MediaView'
import { SearchView } from './views/SearchView'
import { SettingsView } from './views/SettingsView'

/**
 * The panel (ADR 0010): four places, one status line.
 *
 * The desktop panel put the mirror status, the backfill, the first-run hints, the chat list, the
 * message list, the search and the gallery into a single view, and the settings into one long
 * scroll. Here each job has its own place — search, chats, media, settings — reached from a bar at
 * the bottom, and the archive's state is a single sentence at the top that opens the details only
 * when somebody wants them.
 */

type View = 'search' | 'chats' | 'media' | 'settings'

const NAV: readonly {
  view: View
  label: StringKey
  Icon: (p: { className?: string }) => React.JSX.Element
}[] = [
  { view: 'search', label: 'nav.search', Icon: SearchIcon },
  { view: 'chats', label: 'nav.chats', Icon: ChatIcon },
  { view: 'media', label: 'nav.media', Icon: ImageIcon },
  { view: 'settings', label: 'nav.settings', Icon: MoreIcon },
]

export function PanelApp(): React.JSX.Element {
  const [view, setView] = useState<View>('search')
  const [openChat, setOpenChat] = useState<
    { chatId: string; anchor?: { ts: number; id: string } | undefined } | undefined
  >(undefined)
  const [showStatus, setShowStatus] = useState(false)
  const [welcome, setWelcome] = useState(location.hash === '#willkommen')
  const [settings, patch] = useSettings()
  const status = usePanelStatus()
  const wide = useWide()

  useEffect(() => watchArchiveHome(), [])

  useEffect(() => {
    const choice = settings?.theme ?? 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.dataset.theme =
        choice === 'dark' || (choice === 'system' && media.matches) ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
    }
  }, [settings?.theme])

  const showChat = useCallback((chatId: string, anchor?: { ts: number; id: string }) => {
    setOpenChat({ chatId, anchor })
    setView('chats')
  }, [])

  const views = (
    <main className="flex min-h-0 flex-1 flex-col">
      {view === 'search' && <SearchView onOpenChat={showChat} wide={wide} />}
      {view === 'chats' && (
        <ChatsView
          wide={wide}
          open={openChat}
          onOpen={(chatId) => {
            setOpenChat({ chatId })
          }}
          onClose={() => {
            setOpenChat(undefined)
          }}
        />
      )}
      {view === 'media' && <MediaView onOpenChat={showChat} />}
      {view === 'settings' && settings && (
        <SettingsView settings={settings} patch={patch} status={status} />
      )}
    </main>
  )

  const go = (target: View): void => {
    if (target === 'chats' && view === 'chats' && !wide) setOpenChat(undefined)
    setView(target)
  }

  const welcomeCard = welcome && (
    <Welcome
      onDone={() => {
        setWelcome(false)
        history.replaceState(null, '', location.pathname)
      }}
    />
  )

  const sheet = showStatus && (
    <StatusSheet
      status={status}
      onClose={() => {
        setShowStatus(false)
      }}
    />
  )

  if (wide) {
    // The browser-tab layout: navigation down the left, the view across the rest.
    return (
      <div className="flex h-screen bg-wa-panel text-wa-text">
        <aside className="flex w-56 shrink-0 flex-col border-r border-wa-hairline bg-wa-surface px-3 py-4">
          <h1 className="px-3 pb-5 text-lg font-semibold tracking-tight">{t('app.name')}</h1>
          <nav className="space-y-1" aria-label="Bereiche">
            {NAV.map(({ view: target, label, Icon }) => (
              <button
                key={target}
                type="button"
                aria-current={view === target ? 'page' : undefined}
                onClick={() => {
                  go(target)
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                  view === target
                    ? 'bg-wa-accent-soft font-semibold text-wa-accent'
                    : 'text-wa-muted hover:bg-wa-raised hover:text-wa-text'
                }`}
              >
                <Icon className="h-5 w-5" />
                {t(label === 'nav.settings' ? 'nav.settings.long' : label)}
              </button>
            ))}
          </nav>
          <div className="mt-auto">
            <StatusPill
              status={status}
              onClick={() => {
                setShowStatus(true)
              }}
            />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col pt-4">
          {welcomeCard}
          {views}
        </div>
        {sheet}
      </div>
    )
  }

  // The side-panel layout, next to WhatsApp Web: everything stacked, navigation at the bottom.
  return (
    <div className="flex h-screen flex-col bg-wa-panel text-wa-text">
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <h1 className="text-[15px] font-semibold tracking-tight">{t('app.name')}</h1>
        <div className="flex min-w-0 items-center gap-1">
          <StatusPill
            status={status}
            onClick={() => {
              setShowStatus(true)
            }}
          />
          <IconButton label={t('app.openLarge')} onClick={() => void openLarge()}>
            <ExpandIcon className="h-4 w-4" />
          </IconButton>
        </div>
      </header>
      {welcomeCard}
      {views}
      <nav
        className="grid grid-cols-4 border-t border-wa-hairline bg-wa-surface"
        aria-label="Bereiche"
      >
        {NAV.map(({ view: target, label, Icon }) => (
          <button
            key={target}
            type="button"
            aria-current={view === target ? 'page' : undefined}
            onClick={() => {
              go(target)
            }}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] transition ${
              view === target ? 'font-semibold text-wa-accent' : 'text-wa-muted hover:text-wa-text'
            }`}
          >
            <Icon className="h-5 w-5" />
            {t(label)}
          </button>
        ))}
      </nav>
      {sheet}
    </div>
  )
}

/**
 * Wide enough for two panes. The panel runs in two places — a side panel beside WhatsApp, a few
 * hundred pixels wide, and a browser tab of its own — and each gets the layout that suits it.
 */
function useWide(): boolean {
  const query = '(min-width: 860px)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = (): void => {
      setWide(media.matches)
    }
    media.addEventListener('change', update)
    return () => {
      media.removeEventListener('change', update)
    }
  }, [])
  return wide
}

type Tone = 'ok' | 'wait' | 'bad'

function summarise(status: PanelStatus): { tone: Tone; text: string } {
  if (status.host?.error) return { tone: 'bad', text: t('status.problem') }
  if (!status.whatsappOpen) return { tone: 'wait', text: t('status.noTab') }
  if (!status.bridge?.ok) return { tone: 'wait', text: t('status.waiting') }
  return { tone: 'ok', text: t('status.archiving') }
}

const TONE: Record<Tone, string> = {
  ok: 'bg-wa-accent',
  wait: 'bg-wa-warning',
  bad: 'bg-wa-danger',
}

function StatusPill({
  status,
  onClick,
}: {
  status: PanelStatus
  onClick: () => void
}): React.JSX.Element {
  const { tone, text } = summarise(status)
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-w-0 items-center gap-2 rounded-full bg-wa-surface px-3 py-1 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:shadow"
      aria-haspopup="dialog"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[tone]}`} aria-hidden="true" />
      <span className="truncate">{text}</span>
    </button>
  )
}

function StatusSheet({
  status,
  onClose,
}: {
  status: PanelStatus
  onClose: () => void
}): React.JSX.Element {
  const rows: [string, string][] = [
    [
      t('status.bridge'),
      !status.whatsappOpen
        ? t('status.bridge.none')
        : status.bridge?.ok
          ? t('status.bridge.ok')
          : t('status.bridge.waiting'),
    ],
    [
      t('status.archive'),
      status.host?.where === 'tab'
        ? t('status.archive.tab')
        : status.host?.where === 'panel'
          ? t('status.archive.panel')
          : t('status.archive.none'),
    ],
  ]
  if (status.stats) {
    rows.push([
      '',
      t('status.counts', {
        messages: count(status.stats.messages),
        chats: count(status.stats.chats),
        media: count(status.stats.media),
      }),
    ])
  }
  if (status.importer) {
    rows.push([t('status.written'), count(status.importer.written)])
    rows.push([t('status.queued'), count(status.importer.queued)])
    if (status.importer.dropped > 0)
      rows.push([t('status.dropped'), count(status.importer.dropped)])
  }
  if (status.media) {
    rows.push([
      t('status.media'),
      t('status.media.detail', {
        fetched: status.media.fetched,
        skipped: status.media.skipped,
        failed: status.media.failed,
      }),
    ])
  }
  return (
    <Sheet title={t('status.title')} onClose={onClose}>
      <dl className="divide-y divide-wa-hairline rounded-2xl bg-wa-surface px-4">
        {rows.map(([label, value], i) => (
          <div key={i} className="flex justify-between gap-3 py-2.5 text-[13px]">
            <dt className="text-wa-muted">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {status.host?.error && <p className="mt-3 text-xs text-wa-danger">{status.host.error}</p>}
      {!status.whatsappOpen && (
        <div className="mt-4 flex justify-center">
          <Button variant="primary" onClick={() => void openWhatsApp()}>
            {t('status.openWhatsApp')}
          </Button>
        </div>
      )}
    </Sheet>
  )
}

function Welcome({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [permission, setPermission] = useState(true)
  useEffect(() => {
    void hasWhatsAppPermission().then(setPermission)
  }, [])
  return (
    <section className="mx-4 mb-3 rounded-2xl bg-wa-accent-soft p-4">
      <h2 className="text-sm font-semibold">{t('welcome.title')}</h2>
      <p className="mt-1 text-xs leading-relaxed">{t('welcome.body')}</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed">
        <li>{t('welcome.step1')}</li>
        <li>{t('welcome.step2')}</li>
        <li>{t('welcome.step3')}</li>
      </ol>
      {!permission && (
        <p className="mt-3 text-xs">
          {t('welcome.permission')}{' '}
          <button
            type="button"
            className="font-semibold text-wa-accent underline"
            onClick={() => void requestWhatsAppPermission().then(setPermission)}
          >
            {t('welcome.grant')}
          </button>
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={() => void openWhatsApp()}>
          {t('status.openWhatsApp')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('welcome.dismiss')}
        </Button>
      </div>
    </section>
  )
}
