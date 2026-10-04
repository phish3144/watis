import { useEffect, useMemo, useRef, useState } from 'react'
import type { MessageRow } from '@shared/model/rows'
import type { HitPreview, NameHit, SearchHit } from '../../../workers/archive/repository'
import { archive, bridge } from '../api'
import { ChatView } from './ChatsView'
import { useChats, useSenderNames, type ChatInfo } from '../hooks'
import { jidLabel, seconds, when, exactly } from '../format'
import { CloseIcon, ExternalIcon, SearchIcon } from '../icons'
import { SEARCH_SYNTAX } from '../help'
import { HelpLink } from '../helpui'
import { t, type StringKey } from '../strings'
import { Avatar, Chip, EmptyState, Highlight, IconButton, Spinner } from '../ui'

/**
 * Search is the reason the archive exists, so it is the first view and its field has the focus.
 *
 * One field, a row of filters underneath, and results that say plainly where each hit came from —
 * which chat, who wrote it, when, and whether it was the message itself, the text in a picture or
 * a page of a PDF. Everything else the old panel put next to the search lives in its own view now.
 */

const PAGE = 30

const FILTERS: readonly { key: string; label: StringKey; token: string }[] = [
  { key: 'all', label: 'search.filter.all', token: '' },
  { key: 'body', label: 'search.filter.body', token: 'source:body' },
  { key: 'ocr', label: 'search.filter.ocr', token: 'source:ocr' },
  { key: 'pdf', label: 'search.filter.pdf', token: 'source:pdf' },
  { key: 'transcript', label: 'search.filter.transcript', token: 'source:transcript' },
  { key: 'file', label: 'search.filter.file', token: 'has:file' },
]

interface Results {
  query: string
  names: NameHit[]
  hits: SearchHit[]
  messages: Map<string, MessageRow>
  previews: Map<string, HitPreview>
  done: boolean
}

function termsOf(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((word) => word && !/^\w+:/.test(word))
    .map((word) => word.replace(/^"|"$/g, ''))
}

async function load(
  query: string,
  offset: number,
  withNames: boolean,
): Promise<Omit<Results, 'query'>> {
  const { hits } = await archive<{ hits: SearchHit[] }>({
    op: 'search',
    query,
    limit: PAGE,
    offset,
  })
  const ids = hits.map((hit) => hit.msgId).filter((id): id is string => Boolean(id))
  const [names, messages, previews] = await Promise.all([
    withNames
      ? archive<{ names: NameHit[] }>({ op: 'names', query: termsOf(query).join(' '), limit: 4 })
          .then((r) => r.names)
          .catch(() => [])
      : Promise.resolve([]),
    ids.length
      ? archive<{ messages: MessageRow[] }>({ op: 'messages', ids }).then((r) => r.messages)
      : Promise.resolve([]),
    hits.some((hit) => hit.source !== 'body')
      ? archive<{ previews: HitPreview[] }>({
          op: 'hitPreviews',
          hits: hits.map((hit) => ({ msgId: hit.msgId, mediaId: hit.mediaId, source: hit.source })),
          terms: termsOf(query),
        }).then((r) => r.previews)
      : Promise.resolve([]),
  ])
  return {
    names: termsOf(query).length ? names : [],
    hits,
    messages: new Map(messages.map((m) => [m.id, m])),
    previews: new Map(previews.map((p) => [p.key, p])),
    done: hits.length < PAGE,
  }
}

export function SearchView({
  onOpenChat,
  wide,
}: {
  onOpenChat: (chatId: string, anchor?: { ts: number; id: string }) => void
  /** With room to spare, a hit opens in context beside the list instead of replacing it. */
  wide: boolean
}): React.JSX.Element {
  const [selected, setSelected] = useState<
    { chatId: string; anchor?: { ts: number; id: string } | undefined; key: string } | undefined
  >(undefined)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('all')
  const [results, setResults] = useState<Results | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const { byId } = useChats()
  const input = useRef<HTMLInputElement>(null)

  const query = useMemo(() => {
    const token = FILTERS.find((f) => f.key === filter)?.token ?? ''
    return [text.trim(), token].filter(Boolean).join(' ')
  }, [text, filter])

  useEffect(() => {
    input.current?.focus()
  }, [])

  // Debounced: a query per keystroke would race itself and flicker the list.
  useEffect(() => {
    if (!text.trim() && filter === 'all') {
      setResults(undefined)
      setError(undefined)
      return
    }
    let current = true
    const timer = setTimeout(() => {
      setBusy(true)
      load(query, 0, filter === 'all')
        .then((loaded) => {
          if (current) {
            setResults({ query, ...loaded })
            setError(undefined)
          }
        })
        .catch((e: unknown) => {
          if (current) setError(String(e instanceof Error ? e.message : e))
        })
        .finally(() => {
          if (current) setBusy(false)
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query, text, filter])

  const more = (): void => {
    if (!results) return
    setBusy(true)
    void load(results.query, results.hits.length, false)
      .then((next) => {
        setResults({
          ...results,
          hits: [...results.hits, ...next.hits],
          messages: new Map([...results.messages, ...next.messages]),
          previews: new Map([...results.previews, ...next.previews]),
          done: next.done,
        })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const senders = useSenderNames(
    results ? [...results.messages.values()].map((m) => m.senderJid) : [],
  )

  const column = (
    <div
      className={`flex min-h-0 flex-col ${
        wide ? 'w-[min(36rem,48%)] shrink-0 border-r border-wa-hairline' : 'flex-1'
      }`}
    >
      <div className="space-y-2.5 px-4 pb-3 pt-1">
        <label className="flex items-center gap-2 rounded-full bg-wa-surface px-3.5 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.06)] focus-within:ring-2 focus-within:ring-wa-accent">
          <SearchIcon className="h-4 w-4 shrink-0 text-wa-muted" />
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-wa-muted"
          />
          {busy && <Spinner />}
          {text && (
            <button
              type="button"
              aria-label={t('search.clear')}
              onClick={() => {
                setText('')
                input.current?.focus()
              }}
              className="text-wa-muted hover:text-wa-text"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              active={filter === f.key}
              onClick={() => {
                setFilter(f.key)
              }}
            >
              {t(f.label)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error && (
          <p className="rounded-xl bg-wa-surface p-3 text-xs text-wa-danger">
            {t('common.error', { error })}
          </p>
        )}
        {!results && !error && <SearchHelp />}
        {results?.hits.length === 0 && results.names.length === 0 && (
          <EmptyState icon={<SearchIcon />} title={t('search.none')}>
            {t('search.none.hint')}
          </EmptyState>
        )}
        {results && results.names.length > 0 && (
          <section className="mb-4">
            <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-wa-muted">
              {t('search.names')}
            </h2>
            <ul className="overflow-hidden rounded-2xl bg-wa-surface">
              {results.names.map((name) => (
                <li key={`${name.kind}:${name.id}`}>
                  <button
                    type="button"
                    disabled={name.kind !== 'chat'}
                    onClick={() => {
                      onOpenChat(name.id)
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-wa-raised disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <Avatar name={name.label} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{name.label}</div>
                      <div className="truncate text-xs text-wa-muted">
                        {name.kind === 'chat'
                          ? t('search.name.chat')
                          : (name.detail ?? t('search.name.contact'))}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {results && results.hits.length > 0 && (
          <section>
            <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-wa-muted">
              {t('search.messages')}
            </h2>
            <ul className="space-y-2">
              {results.hits.map((hit) => (
                <HitCard
                  key={`${hit.source}:${hit.msgId ?? hit.mediaId ?? ''}`}
                  hit={hit}
                  chat={hit.chatId ? byId.get(hit.chatId) : undefined}
                  message={hit.msgId ? results.messages.get(hit.msgId) : undefined}
                  preview={results.previews.get(`${hit.source}:${hit.msgId ?? hit.mediaId ?? ''}`)}
                  senders={senders}
                  terms={termsOf(results.query)}
                  selected={selected?.key === `${hit.source}:${hit.msgId ?? hit.mediaId ?? ''}`}
                  onOpen={(chatId, anchor) => {
                    if (wide) {
                      setSelected({
                        chatId,
                        anchor,
                        key: `${hit.source}:${hit.msgId ?? hit.mediaId ?? ''}`,
                      })
                    } else onOpenChat(chatId, anchor)
                  }}
                />
              ))}
            </ul>
            {!results.done && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={more}
                  disabled={busy}
                  className="rounded-full px-4 py-1.5 text-xs font-medium text-wa-accent hover:bg-wa-accent-soft"
                >
                  {t('search.more')}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )

  if (!wide) return column
  return (
    <div className="flex min-h-0 flex-1">
      {column}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? (
          <ChatView
            key={selected.key}
            chatId={selected.chatId}
            info={byId.get(selected.chatId) ?? { name: jidLabel(selected.chatId), kind: null }}
            anchor={selected.anchor}
          />
        ) : (
          <EmptyState icon={<SearchIcon />} title={t('search.preview')}>
            {t('search.preview.hint')}
          </EmptyState>
        )}
      </div>
    </div>
  )
}

function SearchHelp(): React.JSX.Element {
  return (
    <div>
      <EmptyState icon={<SearchIcon />} title={t('search.empty.title')}>
        {t('search.empty.body')}
      </EmptyState>
      <details className="rounded-2xl bg-wa-surface px-4 py-3 text-xs text-wa-muted">
        <summary className="cursor-pointer font-medium text-wa-text">{t('search.tips')}</summary>
        {/* The same list the help article shows (help.ts), so the two cannot disagree. */}
        <ul className="mt-2 space-y-1.5 leading-relaxed">
          {SEARCH_SYNTAX.filter((entry) => entry.tip).map((entry) => (
            <li key={entry.example}>
              <code className="rounded bg-wa-raised px-1 py-0.5 text-wa-text">{entry.example}</code>{' '}
              – {entry.meaning}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          <HelpLink topic="suchen" />
        </p>
      </details>
    </div>
  )
}

function sourceLabel(hit: SearchHit, preview: HitPreview | undefined): string | undefined {
  if (hit.source === 'body') return undefined
  const base = t(`source.${hit.source}` as StringKey)
  if (preview?.page !== undefined) return `${base} · ${t('source.page', { n: preview.page })}`
  if (preview?.startSeconds !== undefined) return `${base} · ${seconds(preview.startSeconds)}`
  return base
}

function HitCard({
  hit,
  chat,
  message,
  preview,
  senders,
  terms,
  selected,
  onOpen,
}: {
  hit: SearchHit
  chat: ChatInfo | undefined
  message: MessageRow | undefined
  preview: HitPreview | undefined
  senders: Map<string, string>
  terms: string[]
  selected: boolean
  onOpen: (chatId: string, anchor?: { ts: number; id: string }) => void
}): React.JSX.Element {
  const chatName = chat?.name ?? jidLabel(hit.chatId)
  const sender = message?.fromMe
    ? t('chat.you')
    : message?.senderJid
      ? (senders.get(message.senderJid) ?? jidLabel(message.senderJid))
      : undefined
  const text = hit.source === 'body' ? (message?.body ?? '') : (preview?.text ?? '')
  const label = sourceLabel(hit, preview)
  const open = (): void => {
    if (hit.chatId) {
      onOpen(hit.chatId, message ? { ts: message.ts, id: message.id } : undefined)
    }
  }

  return (
    <li
      className={`group relative rounded-2xl bg-wa-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition hover:shadow-md ${
        selected ? 'ring-2 ring-wa-accent' : ''
      }`}
    >
      <button type="button" onClick={open} className="block w-full p-3 pr-11 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold">{chatName}</span>
          {hit.ts !== null && (
            <time className="shrink-0 text-[11px] text-wa-muted" title={exactly(hit.ts)}>
              {when(hit.ts)}
            </time>
          )}
        </div>
        <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-wa-text">
          {sender && chat?.kind === 'group' && <span className="text-wa-muted">{sender}: </span>}
          <Highlight text={text || (preview?.filename ?? '')} terms={terms} />
        </p>
        {label && (
          <span className="mt-2 inline-block rounded-full bg-wa-accent-soft px-2 py-0.5 text-[11px] font-medium text-wa-accent">
            {label}
          </span>
        )}
      </button>
      {hit.chatId && (
        <div className="absolute right-1.5 top-1.5 opacity-60 group-hover:opacity-100">
          <IconButton
            label={t('search.openInWhatsApp')}
            onClick={() => {
              void bridge('openChat', {
                chatId: hit.chatId,
                ...(hit.msgId ? { msgId: hit.msgId } : {}),
              })
            }}
          >
            <ExternalIcon className="h-4 w-4" />
          </IconButton>
        </div>
      )}
    </li>
  )
}
