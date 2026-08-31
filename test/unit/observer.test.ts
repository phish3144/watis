import { describe, expect, it, vi } from 'vitest'
import {
  observe,
  snapshot,
  toChatRow,
  toContactRow,
  toMessageRow,
  toReactionRow,
  type MirrorEvent,
} from '../../src/bridge/observer'

/** A Backbone-like collection, which is the shape WhatsApp's actually are. */
function fakeCollection(models: unknown[] = []) {
  const handlers = new Map<string, ((model: unknown) => void)[]>()
  return {
    // The signatures require get() as well; a fake without it is correctly rejected by the
    // healthcheck, which is the behaviour the bridge tests cover separately.
    get: vi.fn((id: string) => models.find((m) => (m as { id?: unknown }).id === id)),
    getModelsArray: () => models,
    on: vi.fn((event: string, handler: (model: unknown) => void) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    }),
    off: vi.fn((event: string, handler: (model: unknown) => void) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      )
    }),
    emit: (event: string, model: unknown) => {
      for (const h of handlers.get(event) ?? []) h(model)
    },
    listenerCount: () => [...handlers.values()].reduce((n, l) => n + l.length, 0),
  }
}

function fakePage(chats = fakeCollection(), msgs = fakeCollection(), contacts = fakeCollection()) {
  const modules: Record<string, unknown> = {
    WAWebChatCollection: { ChatCollection: chats },
    WAWebMsgCollection: { MsgCollection: msgs },
    WAWebContactCollection: { ContactCollection: contacts },
  }
  return {
    page: {
      require: (name: string) => {
        if (!(name in modules)) throw new Error(`Requiring unknown module "${name}"`)
        return modules[name]
      },
    },
    chats,
    msgs,
    contacts,
  }
}

/** Named so the empty-function rule has something to point at. */
const noop = (): void => undefined

const message = (over: Record<string, unknown> = {}) => ({
  id: { _serialized: 'false_c1@g.us_ABC', fromMe: false, remote: 'c1@g.us' },
  chatId: { _serialized: 'c1@g.us' },
  t: 1_700_000_000,
  type: 'chat',
  body: 'Hallo',
  from: { _serialized: 'anna@c.us' },
  ...over,
})

describe('toMessageRow', () => {
  it('normalises a message and keeps the raw model', () => {
    const row = toMessageRow(message())
    expect(row).toMatchObject({
      id: 'false_c1@g.us_ABC',
      chatId: 'c1@g.us',
      senderJid: 'anna@c.us',
      ts: 1_700_000_000,
      body: 'Hallo',
      fromMe: false,
    })
    expect(JSON.parse(String(row?.rawJson))).toMatchObject({ type: 'chat' })
  })

  it('reads ids that arrive as plain strings as well as objects', () => {
    // WhatsApp is inconsistent about this, and reshaping an id would break every join.
    expect(toMessageRow(message({ id: 'plain', chatId: 'c9' }))?.id).toBe('plain')
  })

  it('falls back to the caption when a media message has no body', () => {
    expect(toMessageRow(message({ body: undefined, caption: 'Bildunterschrift' }))?.body).toBe(
      'Bildunterschrift',
    )
  })

  it('marks a revoked message', () => {
    expect(toMessageRow(message({ type: 'revoked' }))?.revoked).toBe(true)
  })

  it('marks an edited message', () => {
    expect(toMessageRow(message({ latestEditMsgKey: 'x' }))?.edited).toBe(true)
  })

  it('rejects a model with no usable id or timestamp rather than storing a broken row', () => {
    expect(toMessageRow(message({ id: undefined }))).toBeUndefined()
    expect(toMessageRow(message({ t: undefined }))).toBeUndefined()
    expect(toMessageRow(null)).toBeUndefined()
  })

  it('survives a model that cannot be serialised', () => {
    const circular: Record<string, unknown> = message()
    circular.self = circular
    const row = toMessageRow(circular)
    expect(row?.id).toBe('false_c1@g.us_ABC')
    expect(row?.rawJson).toBeNull()
  })
})

describe('toChatRow and toContactRow', () => {
  it('reads a group chat', () => {
    expect(
      toChatRow({ id: { _serialized: 'c1@g.us' }, name: 'Familie', isGroup: true, t: 5 }),
    ).toMatchObject({ id: 'c1@g.us', name: 'Familie', kind: 'group', lastMsgTs: 5 })
  })

  it('falls back to the formatted title', () => {
    expect(toChatRow({ id: 'c2', formattedTitle: 'Anna' })?.name).toBe('Anna')
  })

  it('classifies a direct chat and a broadcast', () => {
    expect(toChatRow({ id: 'c3' })?.kind).toBe('dm')
    expect(toChatRow({ id: 'c4', isBroadcast: true })?.kind).toBe('broadcast')
  })

  it('reads a contact', () => {
    expect(
      toContactRow({ id: 'anna@c.us', name: 'Anna', pushname: 'A.', userid: '49170' }),
    ).toEqual({
      jid: 'anna@c.us',
      name: 'Anna',
      pushname: 'A.',
      phone: '49170',
    })
  })
})

describe('toReactionRow', () => {
  it('stores a reaction as its own row pointing at its parent', () => {
    // Reactions come and go independently; folding them into the message would churn the search
    // index for text that did not change.
    const row = toReactionRow({
      msgKey: 'r1',
      parentMsgKey: 'false_c1@g.us_ABC',
      senderUserJid: 'anna@c.us',
      reactionText: '👍',
      timestamp: 1_700_000_500,
    })
    expect(row).toMatchObject({
      id: 'r1',
      kind: 'reaction',
      body: '👍',
      quotedId: 'false_c1@g.us_ABC',
    })
  })

  it('rejects a reaction with no parent', () => {
    expect(toReactionRow({ msgKey: 'r1' })).toBeUndefined()
  })
})

describe('observe', () => {
  it('emits on add and change', () => {
    const { page, msgs } = fakePage()
    const events: MirrorEvent[] = []
    observe(page, (e) => events.push(e))

    msgs.emit('add', message())
    msgs.emit('change', message({ body: 'geändert' }))

    expect(events.map((e) => e.kind)).toEqual(['message', 'message'])
    const edited = events[1]
    // The event is a discriminated union now, so reading a message field means saying it is one.
    expect(edited?.kind === 'message' ? edited.row.body : undefined).toBe('geändert')
  })

  it('subscribes to change rather than change:body', () => {
    // An edit, a revoke and an ack all matter, and WhatsApp does not promise which field carries them.
    const { page, msgs } = fakePage()
    observe(page, noop)
    expect(msgs.on.mock.calls.map((c) => c[0])).toEqual(['add', 'change'])
  })

  it('detaches every listener on stop', () => {
    const { page, chats, msgs, contacts } = fakePage()
    const handle = observe(page, noop)
    expect(handle.attached).toBeGreaterThan(0)

    handle.stop()
    expect(chats.listenerCount() + msgs.listenerCount() + contacts.listenerCount()).toBe(0)
  })

  it('drops a model it cannot normalise instead of emitting a broken row', () => {
    const { page, msgs } = fakePage()
    const events: MirrorEvent[] = []
    observe(page, (e) => events.push(e))

    msgs.emit('add', { nonsense: true })
    expect(events).toEqual([])
  })

  it('attaches nothing when the collections are gone', () => {
    const handle = observe(
      {
        require: () => {
          throw new Error('Requiring unknown module')
        },
      },
      noop,
    )
    expect(handle.attached).toBe(0)
  })
})

describe('snapshot', () => {
  it('yields the existing models in chunks so the page stays usable', () => {
    const msgs = fakeCollection(
      Array.from({ length: 450 }, (_, i) => message({ id: `m${String(i)}` })),
    )
    const { page } = fakePage(fakeCollection(), msgs)

    const batches = [...snapshot(page, 200)]
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50])
  })

  it('covers chats, contacts and messages', () => {
    const chats = fakeCollection([{ id: 'c1', name: 'Familie' }])
    const contacts = fakeCollection([{ id: 'anna@c.us', name: 'Anna' }])
    const msgs = fakeCollection([message()])
    const { page } = fakePage(chats, msgs, contacts)

    const kinds = [...snapshot(page)].flat().map((e) => e.kind)
    expect(new Set(kinds)).toEqual(new Set(['chat', 'contact', 'message']))
  })

  it('yields nothing for an empty page rather than throwing', () => {
    expect([...snapshot({})]).toEqual([])
  })
})
