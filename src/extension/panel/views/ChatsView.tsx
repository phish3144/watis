import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MessageRow } from '@shared/model/rows'
import { archive, bridge } from '../api'
import { useChats, useSenderNames, type ChatInfo } from '../hooks'
import { dayHeading, exactly, jidLabel, when } from '../format'
import { BackIcon, CalendarIcon, ChatIcon, ExternalIcon, SearchIcon } from '../icons'
import { Attachment } from '../media'
import { t } from '../strings'
import { Avatar, EmptyState, IconButton, Spinner } from '../ui'

/**
 * The chat list, and one chat read from the archive — not from WhatsApp, so it reaches back as far
 * as the archive does, past WhatsApp Web's own window.
 */

export function ChatsView({
  open,
  onOpen,
  onClose,
  wide,
}: {
  open: { chatId: string; anchor?: { ts: number; id: string } | undefined } | undefined
  onOpen: (chatId: string) => void
  onClose: () => void
  /** Side by side — list and conversation — when there is room for both. */
  wide: boolean
}): React.JSX.Element {
  const { chats, byId, loaded } = useChats()
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle
      ? chats.filter((chat) => (chat.name ?? chat.id).toLowerCase().includes(needle))
      : chats
  }, [chats, filter])

  const conversation = open ? (
    <ChatView
      key={`${open.chatId}:${open.anchor?.id ?? ''}`}
      chatId={open.chatId}
      info={byId.get(open.chatId) ?? { name: jidLabel(open.chatId), kind: null }}
      anchor={open.anchor}
      onBack={wide ? undefined : onClose}
    />
  ) : undefined

  if (conversation && !wide) return conversation

  const list = (
    <div
      className={`flex min-h-0 flex-col ${wide ? 'w-80 shrink-0 border-r border-wa-hairline' : 'flex-1'}`}
    >
      <div className="px-4 pb-3 pt-1">
        <label className="flex items-center gap-2 rounded-full bg-wa-surface px-3.5 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.06)] focus-within:ring-2 focus-within:ring-wa-accent">
          <SearchIcon className="h-4 w-4 text-wa-muted" />
          <input
            type="search"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
            }}
            placeholder={t('chats.filter')}
            aria-label={t('chats.filter')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-wa-muted"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loaded && chats.length === 0 && (
          <EmptyState icon={<ChatIcon />}>{t('chats.empty')}</EmptyState>
        )}
        <ul>
          {visible.map((chat) => (
            <li
              key={chat.id}
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' }}
            >
              <button
                type="button"
                aria-current={open?.chatId === chat.id ? 'true' : undefined}
                onClick={() => {
                  onOpen(chat.id)
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left ${
                  open?.chatId === chat.id ? 'bg-wa-accent-soft' : 'hover:bg-wa-surface'
                }`}
              >
                <Avatar name={chat.name ?? chat.id} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-medium">
                      {chat.name ?? jidLabel(chat.id)}
                    </span>
                    {chat.lastMsgTs && (
                      <span className="shrink-0 text-[11px] text-wa-muted">
                        {when(chat.lastMsgTs)}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-wa-muted">
                    {chat.kind === 'group' ? t('chats.group') : jidLabel(chat.jid ?? chat.id)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )

  if (!wide) return list
  return (
    <div className="flex min-h-0 flex-1">
      {list}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {conversation ?? (
          <EmptyState icon={<ChatIcon />} title={t('chats.pick')}>
            {t('chats.pick.hint')}
          </EmptyState>
        )}
      </div>
    </div>
  )
}

const PAGE = 50

const byTime = (a: MessageRow, b: MessageRow): number => a.ts - b.ts || (a.id < b.id ? -1 : 1)

export function ChatView({
  chatId,
  info,
  anchor,
  onBack,
}: {
  chatId: string
  info: ChatInfo
  anchor: { ts: number; id: string } | undefined
  /** Absent where the list stays visible beside the conversation. */
  onBack?: (() => void) | undefined
}): React.JSX.Element {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [olderDone, setOlderDone] = useState(false)
  const [newerDone, setNewerDone] = useState(true)
  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState<{ ts: number; id: string } | undefined>(anchor)
  const scroller = useRef<HTMLDivElement>(null)
  const keepFromBottom = useRef<number | undefined>(undefined)
  const senders = useSenderNames(messages.map((m) => m.senderJid))

  // (Re)load around the focus: the newest page, or the pages either side of a hit or a date.
  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      let rows: MessageRow[]
      if (focus) {
        const [before, after, self] = await Promise.all([
          archive<{ messages: MessageRow[] }>({
            op: 'messagesPage',
            chatId,
            limit: PAGE,
            before: focus,
          }),
          archive<{ messages: MessageRow[] }>({
            op: 'messagesPage',
            chatId,
            limit: PAGE,
            after: focus,
          }),
          archive<{ messages: MessageRow[] }>({ op: 'messages', ids: [focus.id] }),
        ])
        rows = [...before.messages, ...self.messages, ...after.messages]
        if (alive) {
          setOlderDone(before.messages.length < PAGE)
          setNewerDone(after.messages.length < PAGE)
        }
      } else {
        const page = await archive<{ messages: MessageRow[] }>({
          op: 'messagesPage',
          chatId,
          limit: PAGE,
        })
        rows = page.messages
        if (alive) {
          setOlderDone(page.messages.length < PAGE)
          setNewerDone(true)
        }
      }
      if (!alive) return
      setMessages(rows.sort(byTime))
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [chatId, focus])

  // After a load: scroll to the focused message, or to the bottom; after prepending older
  // messages, keep the reader where they were.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || loading) return
    if (keepFromBottom.current !== undefined) {
      element.scrollTop = element.scrollHeight - keepFromBottom.current
      keepFromBottom.current = undefined
      return
    }
    if (focus) {
      document.getElementById(`m-${focus.id}`)?.scrollIntoView({ block: 'center' })
    } else {
      element.scrollTop = element.scrollHeight
    }
  }, [loading, focus, messages.length])

  const loadOlder = async (): Promise<void> => {
    const first = messages[0]
    if (!first || olderDone || loading) return
    const element = scroller.current
    if (element) keepFromBottom.current = element.scrollHeight - element.scrollTop
    const page = await archive<{ messages: MessageRow[] }>({
      op: 'messagesPage',
      chatId,
      limit: PAGE,
      before: { ts: first.ts, id: first.id },
    })
    setOlderDone(page.messages.length < PAGE)
    setMessages((current) => [...page.messages, ...current].sort(byTime))
  }

  const loadNewer = async (): Promise<void> => {
    const last = messages[messages.length - 1]
    if (!last || newerDone || loading) return
    const page = await archive<{ messages: MessageRow[] }>({
      op: 'messagesPage',
      chatId,
      limit: PAGE,
      after: { ts: last.ts, id: last.id },
    })
    setNewerDone(page.messages.length < PAGE)
    setMessages((current) => [...current, ...page.messages].sort(byTime))
  }

  const onScroll = (): void => {
    const element = scroller.current
    if (!element) return
    if (element.scrollTop < 200) void loadOlder()
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 200) void loadNewer()
  }

  const jump = async (value: string): Promise<void> => {
    if (!value) return
    const ts = Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000)
    const { cursor } = await archive<{ cursor: { ts: number; id: string } | null }>({
      op: 'jumpToDate',
      chatId,
      ts,
    })
    if (cursor) setFocus(cursor)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-2">
        {onBack && (
          <IconButton label={t('chat.back')} onClick={onBack}>
            <BackIcon />
          </IconButton>
        )}
        <Avatar name={info.name} size={32} />
        <h2 className="ml-1 min-w-0 flex-1 truncate text-[14px] font-semibold">{info.name}</h2>
        <label className="relative" title={t('chat.jump')}>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-wa-muted hover:bg-wa-raised hover:text-wa-text">
            <CalendarIcon />
          </span>
          <input
            type="date"
            aria-label={t('chat.jump')}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => void jump(event.target.value)}
          />
        </label>
        <IconButton
          label={t('search.openInWhatsApp')}
          onClick={() => void bridge('openChat', { chatId })}
        >
          <ExternalIcon />
        </IconButton>
      </div>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto bg-wa-raised/40 px-3 py-3"
      >
        {loading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {!loading && olderDone && (
          <p className="mb-3 text-center text-[11px] text-wa-muted">{t('chat.beginning')}</p>
        )}
        <ol className="space-y-1.5">
          {messages.map((message, i) => {
            const previous = messages[i - 1]
            const newDay =
              !previous ||
              new Date(previous.ts * 1000).toDateString() !==
                new Date(message.ts * 1000).toDateString()
            return (
              <li
                key={message.id}
                id={`m-${message.id}`}
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
              >
                {newDay && (
                  <div className="my-3 text-center">
                    <span className="rounded-full bg-wa-surface px-3 py-1 text-[11px] text-wa-muted shadow-sm">
                      {dayHeading(message.ts)}
                    </span>
                  </div>
                )}
                <Bubble
                  message={message}
                  group={info.kind === 'group'}
                  sender={
                    message.senderJid
                      ? (senders.get(message.senderJid) ?? jidLabel(message.senderJid))
                      : ''
                  }
                  highlighted={focus?.id === message.id}
                  chatName={info.name}
                />
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

function Bubble({
  message,
  group,
  sender,
  highlighted,
  chatName,
}: {
  message: MessageRow
  group: boolean
  sender: string
  highlighted: boolean
  chatName: string
}): React.JSX.Element {
  const mine = Boolean(message.fromMe)
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
          mine ? 'rounded-br-md bg-wa-accent-soft' : 'rounded-bl-md bg-wa-surface'
        } ${highlighted ? 'ring-2 ring-wa-accent' : ''}`}
      >
        {group && !mine && sender && (
          <div className="mb-0.5 text-[12px] font-semibold text-wa-accent">{sender}</div>
        )}
        {message.mediaId && !message.revoked && (
          <div className="mb-1">
            <Attachment mediaId={message.mediaId} chatName={chatName} ts={message.ts} />
          </div>
        )}
        {message.revoked ? (
          <p className="text-[13px] italic text-wa-muted">{t('chat.revoked')}</p>
        ) : (
          message.body && (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">
              {message.body}
            </p>
          )
        )}
        <div className="mt-0.5 text-right text-[10px] text-wa-muted" title={exactly(message.ts)}>
          {message.edited ? `${t('chat.edited')} · ` : ''}
          {new Date(message.ts * 1000).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  )
}
