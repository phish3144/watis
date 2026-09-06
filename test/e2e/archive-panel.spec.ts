import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The archive panel actually showing an archive.
 *
 * This exists because of a bug that shipped: `visibleRange` clamped its end index to the row count
 * but not its start index, and the list uses Number.MAX_SAFE_INTEGER as its "jump to the bottom"
 * sentinel. That put the start index roughly 1.2e14 rows in, so slice() returned nothing and the
 * message pane was empty for every chat, permanently, in a released build. Every unit test of
 * `visibleRange` passed, because none of them passed the sentinel the component actually uses.
 *
 * So this asserts the thing a user cares about and nothing smaller: messages put into the archive
 * appear in the panel's DOM. It talks to the archive over the same IPC handler the renderer uses,
 * then reads the rendered text back out of the panel's webContents.
 */

let app: ElectronApplication
let dataDir: string

async function archive<T>(request: unknown): Promise<T> {
  return app.evaluate(({ ipcMain }, payload) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, a: unknown) => unknown> }
    )._invokeHandlers
    const handler = handlers.get('archive:request')
    if (!handler) throw new Error('archive:request handler is not registered')
    return handler({}, payload)
  }, request) as Promise<T>
}

async function panelText(): Promise<string> {
  return (await app.evaluate(async ({ webContents }) => {
    const panel = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('index.html'))
    return (await panel?.executeJavaScript('document.body.innerText')) as unknown
  })) as string
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dataDir = mkdtempSync(join(tmpdir(), 'watis-e2e-panel-'))
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, LOCALAPPDATA: dataDir, XDG_DATA_HOME: dataDir, NODE_ENV: 'test' },
  })

  await expect
    .poll(
      () =>
        archive({ op: 'stats' }).then(
          () => true,
          () => false,
        ),
      {
        timeout: 30_000,
        message: 'the archive worker should come up',
      },
    )
    .toBe(true)
})

test.afterAll(async () => {
  await app?.close()
  if (dataDir && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
})

test('shows chats that arrive after the panel has already mounted', async () => {
  test.setTimeout(90_000)

  // The order that matters: the panel mounts against an EMPTY archive, which is what a fresh
  // install looks like. The chat list used to be fetched once on mount and never again, so it went
  // on saying "Noch nichts archiviert" while chats piled up underneath.
  await expect
    .poll(() => panelText().then((t) => t.includes('Noch nichts archiviert')), {
      timeout: 30_000,
      message: 'an empty archive should say so first',
    })
    .toBe(true)

  await archive({
    op: 'import',
    chats: [
      { id: 'c1', name: 'Dachdecker Krause' },
      { id: 'c2', name: 'Hausverwaltung' },
    ],
  })

  // No tab switch, no restart — a remount would have hidden the bug.
  await expect
    .poll(() => panelText().then((t) => t.includes('Dachdecker Krause')), {
      timeout: 30_000,
      message: 'the chat list should refresh on its own',
    })
    .toBe(true)
})

test('renders the messages of the selected chat, scrolled to the newest', async () => {
  test.setTimeout(90_000)

  const messages = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    chatId: 'c1',
    ts: 1_700_000_000 + i * 600,
    body: `Nachricht Nummer ${i + 1} im Verlauf.`,
  }))
  await archive({ op: 'import', messages })

  // The regression: this pane was empty for every chat, in a shipped build, with a scrollbar over
  // nothing. Asserting "some message is visible" is the whole point.
  await expect
    .poll(() => panelText().then((t) => /Nachricht Nummer \d+ im Verlauf/.test(t)), {
      timeout: 30_000,
      message: 'imported messages should appear in the panel',
    })
    .toBe(true)

  // A chat opens at its newest message, the way every messenger does. With the sentinel handled
  // correctly this is the LAST row, not the first — and it is the specific value that used to send
  // the window past the end of the list.
  await expect
    .poll(() => panelText().then((t) => t.includes('Nachricht Nummer 40 im Verlauf.')), {
      timeout: 30_000,
      message: 'the list should open at the newest message',
    })
    .toBe(true)
})
