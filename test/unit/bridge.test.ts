import { describe, expect, it, vi } from 'vitest'
import { availability, healthcheck, isFailure, resolveModule } from '../../src/bridge/modules'
import {
  ALL,
  CMD,
  disabledFeatures,
  LOAD_MESSAGES,
  MSG_COLLECTION,
} from '../../src/bridge/signatures'
import { earliestReachableTs, loadOlder, openChat } from '../../src/bridge/operations'

/** A page whose `require` behaves like WhatsApp's: it throws for anything unregistered. */
function fakePage(modules: Record<string, unknown>) {
  return {
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Requiring unknown module "${name}"`)
      return modules[name]
    },
  }
}

const chatModel = (messages: { t: number }[] = []) => ({
  msgs: { models: messages, length: messages.length },
})

function fullPage(chat = chatModel([{ t: 1000 }])) {
  const collection = { get: vi.fn(() => chat), getModelsArray: () => [chat] }
  return {
    page: fakePage({
      WAWebChatCollection: { ChatCollection: collection },
      WAWebMsgCollection: { MsgCollection: { get: vi.fn() } },
      WAWebContactCollection: { ContactCollection: { get: vi.fn(), getModelsArray: () => [] } },
      WAWebGroupMetadataCollection: { GroupMetadataCollection: { get: vi.fn() } },
      WAWebChatLoadMessages: { loadEarlierMsgs: vi.fn() },
      WAWebCmd: { Cmd: { openChatAt: vi.fn(), openChatBottom: vi.fn() } },
      WAWebHistorySyncUtils: { getEarliestHistorySyncDate: vi.fn(() => 1_700_000_000) },
      WAWebDownloadManager: { downloadManager: { downloadAndMaybeDecrypt: vi.fn() } },
    }),
    collection,
    chat,
  }
}

describe('resolveModule', () => {
  it('resolves a module and follows the path into it', () => {
    const result = resolveModule(fullPage().page, MSG_COLLECTION)
    expect(isFailure(result)).toBe(false)
  })

  it('reports an unregistered module rather than throwing into WhatsApp code', () => {
    // require() throws synchronously for anything not registered; unwrapped, that would surface
    // inside a WhatsApp stack frame.
    const result = resolveModule(fakePage({}), MSG_COLLECTION)
    expect(result).toMatchObject({ reason: 'not-registered' })
  })

  it('reports a page without require at all', () => {
    expect(resolveModule({}, MSG_COLLECTION)).toMatchObject({ reason: 'no-require' })
  })

  it('reports a module that lost a function we depend on', () => {
    // This is the whole point of signatures: a silent shape change becomes a named failure.
    const page = fakePage({ WAWebMsgCollection: { MsgCollection: { getModelsArray: () => [] } } })
    expect(resolveModule(page, MSG_COLLECTION)).toMatchObject({
      reason: 'missing-members',
      detail: 'get()',
    })
  })

  it('reports a path that does not lead anywhere', () => {
    const page = fakePage({ WAWebMsgCollection: {} })
    expect(resolveModule(page, MSG_COLLECTION)).toMatchObject({ reason: 'missing-members' })
  })

  it('distinguishes a module that threw for another reason', () => {
    const page = {
      require: () => {
        throw new Error('boom')
      },
    }
    expect(resolveModule(page, MSG_COLLECTION)).toMatchObject({ reason: 'threw', detail: /boom/ })
  })
})

describe('healthcheck', () => {
  it('passes on a complete page and records the version', () => {
    const report = healthcheck(fullPage().page, ALL, '2.3000.1')
    expect(report.ok).toBe(true)
    expect(report.version).toBe('2.3000.1')
    expect(report.failures).toEqual([])
  })

  it('survives a partial failure and names what is gone', () => {
    // A missing module switches its features off; it does not take the app down (§5.5).
    const page = fakePage({
      WAWebChatCollection: { ChatCollection: { get: vi.fn(), getModelsArray: vi.fn() } },
      WAWebMsgCollection: { MsgCollection: { get: vi.fn() } },
      WAWebContactCollection: { ContactCollection: { get: vi.fn(), getModelsArray: vi.fn() } },
    })

    const report = healthcheck(page, ALL)
    expect(report.ok).toBe(false)
    expect(availability(report).has('WAWebChatCollection')).toBe(true)
    expect(disabledFeatures(availability(report))).toEqual(
      expect.arrayContaining(['backfill', 'openInWhatsApp', 'groupNames']),
    )
    expect(disabledFeatures(availability(report))).not.toContain('archiveMirror')
  })
})

describe('operations', () => {
  it('opens a chat at the bottom', async () => {
    const { page } = fullPage()
    expect(await openChat(page, { chatId: 'c1' })).toBe(true)
  })

  it('passes the chat as an object, not positionally', async () => {
    // WhatsApp Web >= 2.3000.1029960097 takes openChatBottom({ chat, … }); the positional form is
    // deprecated. Passing the model positionally makes WhatsApp destructure `chat` out of it, get
    // undefined and read `.id` on that — the "Cannot read properties of undefined (reading 'id')"
    // that killed 15 chats in a real backfill run.
    const { page, chat } = fullPage()
    const cmd = (page.require('WAWebCmd') as { Cmd: { openChatBottom: ReturnType<typeof vi.fn> } })
      .Cmd
    await openChat(page, { chatId: 'c1' })
    expect(cmd.openChatBottom).toHaveBeenCalledWith({ chat })
  })

  it('falls back to the positional form for an older WhatsApp', async () => {
    const { page, chat } = fullPage()
    const cmd = (page.require('WAWebCmd') as { Cmd: { openChatBottom: ReturnType<typeof vi.fn> } })
      .Cmd
    cmd.openChatBottom.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'id')")
    })
    expect(await openChat(page, { chatId: 'c1' })).toBe(true)
    expect(cmd.openChatBottom).toHaveBeenLastCalledWith(chat)
  })

  it('opens the chat at its bottom even when a message was named', async () => {
    // openChatAt's second parameter is a msgContext built by WhatsApp's own getSearchContext, not a
    // message id. The old call passed `{ chat, msgId }`, a field that is not in the signature, so
    // scrolling to a message never worked. Opening the chat is the part that does.
    const { page, chat } = fullPage()
    const cmd = (page.require('WAWebCmd') as { Cmd: { openChatBottom: ReturnType<typeof vi.fn> } })
      .Cmd
    expect(await openChat(page, { chatId: 'c1', msgId: 'm9' })).toBe(true)
    expect(cmd.openChatBottom).toHaveBeenCalledWith({ chat })
  })

  it('reports failure instead of throwing when the chat is unknown', async () => {
    const { page, collection } = fullPage()
    collection.get.mockImplementationOnce(() => undefined as never)
    expect(await openChat(page, { chatId: 'weg' })).toBe(false)
  })

  it('counts what a page of older messages actually delivered', async () => {
    const chat = chatModel([{ t: 500 }])
    const { page } = fullPage(chat)
    const loader = page.require('WAWebChatLoadMessages') as {
      loadEarlierMsgs: ReturnType<typeof vi.fn>
    }
    // Synchronous on purpose: the operation awaits whatever comes back, and returning a promise
    // here trips the lint rule about promises in a void-returning position.
    loader.loadEarlierMsgs.mockImplementation(() => {
      chat.msgs.models.unshift({ t: 100 }, { t: 200 })
      chat.msgs.length = chat.msgs.models.length
    })

    expect(await loadOlder(page, 'c1')).toEqual({ loaded: 2, oldestTs: 100, atFloor: false })
  })

  it('treats a page that brought nothing as the floor', async () => {
    const { page } = fullPage(chatModel([{ t: 500 }]))
    expect(await loadOlder(page, 'c1')).toMatchObject({ loaded: 0, atFloor: true })
  })

  /**
   * The bug that made the whole archive pointless: 110 chats mirrored, 514 rows imported, zero
   * messages, and a backfill that called every chat done.
   *
   * WhatsApp Web fills chat.msgs lazily, when a chat is opened. loadEarlierMsgs on a chat nobody
   * opened has no anchor to page back from and returns nothing — which the old code reported as
   * { loaded: 0, atFloor: true }, identical to a chat with no history left. The Effects interface
   * had said "opens the chat and asks for one page" all along; only the second half happened.
   */
  describe('opening before asking', () => {
    it('does not reopen the chat for every page', async () => {
      // The backfill opens each chat once, before its first page. loadOlder used to open it too,
      // and the machine calls loadOlder once per page — about 29 openings for a chat of 1450
      // messages. Slow, and it drags WhatsApp's visible chat around under the user for nothing.
      const chat = chatModel([{ t: 500 }])
      const { page } = fullPage(chat)
      const cmd = (
        page.require('WAWebCmd') as { Cmd: { openChatBottom: ReturnType<typeof vi.fn> } }
      ).Cmd
      const loader = page.require('WAWebChatLoadMessages') as {
        loadEarlierMsgs: ReturnType<typeof vi.fn>
      }

      await loadOlder(page, 'c1')

      expect(loader.loadEarlierMsgs).toHaveBeenCalled()
      expect(cmd.openChatBottom).not.toHaveBeenCalled()
    })

    it('says the chat came back empty rather than calling it finished', async () => {
      // An opened chat that still holds nothing is a bridge problem, not an empty chat, and the
      // difference is the whole reason a backfill can report success while archiving nothing.
      const { page } = fullPage(chatModel([]))
      expect(await loadOlder(page, 'c1')).toMatchObject({
        loaded: 0,
        atFloor: true,
        reason: 'empty-after-open',
      })
    })

    it('distinguishes a real floor from a fault', async () => {
      const { page } = fullPage(chatModel([{ t: 500 }]))
      expect((await loadOlder(page, 'c1')).reason).toBe('at-floor')
    })

    it('names an unknown chat', async () => {
      const { page, collection } = fullPage()
      collection.get.mockImplementation(() => undefined as never)
      expect((await loadOlder(page, 'weg')).reason).toBe('chat-not-found')
    })

    it('names a module WhatsApp no longer registers', async () => {
      // Built by taking a working page away, not by assembling a minimal one: every other module
      // has to stay resolvable or the operation fails earlier and the test proves nothing.
      const { page } = fullPage(chatModel([{ t: 500 }]))
      const withoutLoader = {
        require: (name: string) => {
          if (name === 'WAWebChatLoadMessages')
            throw new Error(`Requiring unknown module "${name}"`)
          return page.require(name)
        },
      }
      expect((await loadOlder(withoutLoader, 'c1')).reason).toBe('module-unresolved')
    })

    it('reports a module that lost the function as unresolved, because the signature catches it', async () => {
      // LOAD_MESSAGES names loadEarlierMsgs in its signature, so resolveModule rejects a module
      // without it before the operation ever looks. The typeof guard behind that is defensive and
      // not reachable this way — worth pinning, so nobody later "fixes" the reason to match the
      // guard's name and wonders why it never appears.
      const { page } = fullPage(chatModel([{ t: 500 }]))
      const emptyLoader = {
        require: (name: string) => (name === 'WAWebChatLoadMessages' ? {} : page.require(name)),
      }
      expect((await loadOlder(emptyLoader, 'c1')).reason).toBe('module-unresolved')
    })
  })

  it('leaves the trigger at its default so the request is not misdescribed', async () => {
    const { page } = fullPage()
    const loader = page.require('WAWebChatLoadMessages') as {
      loadEarlierMsgs: ReturnType<typeof vi.fn>
    }
    await loadOlder(page, 'c1')
    const [args] = loader.loadEarlierMsgs.mock.calls[0] as [Record<string, unknown>]
    expect('trigger' in args).toBe(false)
  })

  it('reads the reachable date and normalises milliseconds', async () => {
    const { page } = fullPage()
    const utils = page.require('WAWebHistorySyncUtils') as {
      getEarliestHistorySyncDate: ReturnType<typeof vi.fn>
    }
    expect(await earliestReachableTs(page)).toBe(1_700_000_000)

    utils.getEarliestHistorySyncDate.mockReturnValueOnce(1_700_000_000_000)
    expect(await earliestReachableTs(page)).toBe(1_700_000_000)

    utils.getEarliestHistorySyncDate.mockReturnValueOnce(new Date(1_700_000_000_000))
    expect(await earliestReachableTs(page)).toBe(1_700_000_000)
  })

  it('returns undefined for the reachable date rather than a number of our own', async () => {
    expect(await earliestReachableTs(fakePage({}))).toBeUndefined()
  })

  describe('the reachable date', () => {
    it('does not present a 90-day window as the 1st of April 1970', async () => {
      // What a real account returned: 7_776_000, which is not a timestamp but exactly ninety days
      // in seconds — the length of the window, not its start. Read as an absolute time that is
      // 01.04.1970, and the panel showed it as something WhatsApp had said.
      const { page } = fullPage()
      const utils = page.require('WAWebHistorySyncUtils') as {
        getEarliestHistorySyncDate: ReturnType<typeof vi.fn>
      }
      utils.getEarliestHistorySyncDate.mockReturnValueOnce(7_776_000)

      const ts = await earliestReachableTs(page)
      expect(ts).toBeDefined()
      const asDate = new Date((ts ?? 0) * 1000)
      expect(asDate.getUTCFullYear()).toBeGreaterThan(2020)
      // Ninety days back from now, give or take the second the test takes to run.
      expect(Math.abs(Date.now() / 1000 - 7_776_000 - (ts ?? 0))).toBeLessThan(5)
    })

    it('refuses a value that cannot be a date at all', async () => {
      const { page } = fullPage()
      const utils = page.require('WAWebHistorySyncUtils') as {
        getEarliestHistorySyncDate: ReturnType<typeof vi.fn>
      }
      utils.getEarliestHistorySyncDate.mockReturnValueOnce(-1)
      expect(await earliestReachableTs(page)).toBeUndefined()
    })

    it('leaves a genuine timestamp alone', async () => {
      const { page } = fullPage()
      expect(await earliestReachableTs(page)).toBe(1_700_000_000)
    })
  })

  it('never hands the raw Cmd object to a caller', async () => {
    // Cmd also carries sendDeleteMsgs and Revoke; this module is the barrier. The list is exact on
    // purpose: adding an export here is meant to be a change somebody has to make deliberately,
    // and every name on it reads.
    const exports = await import('../../src/bridge/operations')
    const names = Object.keys(exports)
    expect(names.sort()).toEqual(['downloadMedia', 'earliestReachableTs', 'loadOlder', 'openChat'])
  })
})

describe('signature list', () => {
  it('marks Cmd as carrying write calls we must not use', () => {
    expect(CMD.functions).toEqual(['openChatAt', 'openChatBottom'])
    expect(CMD.functions).not.toContain('sendDeleteMsgs')
  })

  it('keeps backfill gated on the module that reads the reachable date', () => {
    expect(LOAD_MESSAGES.functions).toContain('loadEarlierMsgs')
  })
})
