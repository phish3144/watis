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

  it('opens a chat at a message when one is given', async () => {
    const { page } = fullPage()
    const cmd = (page.require('WAWebCmd') as { Cmd: { openChatAt: ReturnType<typeof vi.fn> } }).Cmd
    await openChat(page, { chatId: 'c1', msgId: 'm9' })
    expect(cmd.openChatAt).toHaveBeenCalledWith(expect.objectContaining({ msgId: 'm9' }))
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

  it('never hands the raw Cmd object to a caller', async () => {
    // Cmd also carries sendDeleteMsgs and Revoke; this module is the barrier.
    const exports = await import('../../src/bridge/operations')
    const names = Object.keys(exports)
    expect(names.sort()).toEqual(['earliestReachableTs', 'loadOlder', 'openChat'])
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
