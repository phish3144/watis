import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import { fakeWhatsAppHeaders, fakeWhatsAppPage, type FakeFile } from './fake-whatsapp'

/**
 * The browser extension against a stand-in WhatsApp Web, in a real Chromium (ADR 0010).
 *
 * Proves the whole path a message takes in the browser: the bridge in the page world under
 * WhatsApp's CSP, the relay, the archive frame under WhatsApp's COEP, SQLite-WASM on OPFS, and the
 * search the panel runs — plus media into the OPFS store, the badge and the notifications.
 *
 * Firefox is driven by its own script (scripts/e2e-firefox-extension.mjs): Playwright's Firefox
 * build cannot load extensions.
 */

const root = resolve(__dirname, '..', '..')
const extensionDir = join(root, 'out', 'extension', 'chromium')
const fixture = (name: string): string =>
  readFileSync(join(root, 'test', 'fixtures', name)).toString('base64')
const IMAGE = 'ZmFrZS1yZWNobnVuZw=='
const TEXT_PDF = 'YW5nZWJvdC10ZXh0'
const SCANNED_PDF = 'YW5nZWJvdC1zY2Fu'
const VOICE = 'c3ByYWNobmFjaHJpY2h0'
const VIEW_ONCE = 'ZWlubWFsLWFuc2VoZW4='
/** Where the invoice picture lands in the media store: its SHA-256, sharded. */
const OPFS_IMAGE_PATH = (() => {
  const sha = createHash('sha256').update(Buffer.from(fixture('ocr-rechnung.png'), 'base64'))
  const hex = sha.digest('hex')
  return `blobs/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}.png`
})()
/**
 * A real speech model for the transcription test. It is not in the repository (tens of megabytes);
 * `npm run models:fetch base` puts it here, CI caches it, and without it that one test is skipped.
 */
const WHISPER_MODEL =
  process.env.WATIS_WHISPER_MODEL ?? join(root, '.cache', 'whisper', 'ggml-base-q5_1.bin')
const files: FakeFile[] = [
  {
    hash: IMAGE,
    mime: 'image/png',
    caption: 'Die Rechnung vom Handwerker',
    base64: fixture('ocr-rechnung.png'),
  },
  {
    hash: TEXT_PDF,
    mime: 'application/pdf',
    filename: 'Angebot.pdf',
    base64: fixture('angebot-text.pdf'),
  },
  {
    hash: SCANNED_PDF,
    mime: 'application/pdf',
    filename: 'Scan.pdf',
    base64: fixture('angebot-scan.pdf'),
  },
  {
    // The same recording sent as "view once": the bridge must decline it, and say why in German.
    hash: VIEW_ONCE,
    mime: 'audio/ogg; codecs=opus',
    viewOnce: true,
    base64: fixture('sprachnachricht.ogg'),
  },
  {
    // Synthesised speech saying invented sentences (scripts/make-voice-fixture.mjs).
    hash: VOICE,
    mime: 'audio/ogg; codecs=opus',
    base64: fixture('sprachnachricht.ogg'),
  },
]

let context: BrowserContext
let extensionId: string
let whatsapp: Page
let panel: Page

/** Runs in an extension page, so `chrome.*` is there. */
async function inExtension<T>(fn: () => Promise<T>): Promise<T> {
  return panel.evaluate(fn)
}

/** An archive request the way the panel sends one: to the WhatsApp tab, which relays it. */
async function archive<T>(request: Record<string, unknown>): Promise<T> {
  return panel.evaluate(async (payload) => {
    const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
    if (tab?.id === undefined) throw new Error('no WhatsApp tab')
    type Reply = { ok: true; value: unknown } | { ok: false; error: string } | undefined
    const reply = await chrome.tabs.sendMessage<unknown, Reply>(tab.id, {
      kind: 'archive',
      request: payload,
    })
    if (!reply) throw new Error('the WhatsApp tab did not answer')
    if (!reply.ok) throw new Error(reply.error)
    return reply.value
  }, request) as Promise<T>
}

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'watis-ext-')), {
    // The headless *shell* cannot load extensions; the full Chromium in new-headless mode can.
    // WATIS_CHROMIUM points at a preinstalled build where the pinned one is not downloaded.
    ...(process.env.WATIS_CHROMIUM
      ? { executablePath: process.env.WATIS_CHROMIUM }
      : { channel: 'chromium' }),
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  })
  await context.route('https://web.whatsapp.com/**', (route) =>
    route.fulfill({ status: 200, headers: fakeWhatsAppHeaders(), body: fakeWhatsAppPage(files) }),
  )
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  extensionId = new URL(worker.url()).host

  whatsapp = await context.newPage()
  await whatsapp.goto('https://web.whatsapp.com/')
  panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel.html`)
})

test.afterAll(async () => {
  await context.close()
})

test('the bridge comes up in the page world, despite the nonce CSP', async () => {
  await expect
    .poll(
      () =>
        inExtension(async () => {
          const stored = await chrome.storage.session.get('watis:bridge')
          return (stored['watis:bridge'] as { ok?: boolean } | undefined)?.ok ?? null
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
})

test('the archive opens inside the WhatsApp tab, despite its COEP', async () => {
  await expect
    .poll(
      () =>
        inExtension(async () => {
          const stored = await chrome.storage.session.get('watis:host')
          return (stored['watis:host'] as { where?: string; error?: string } | undefined) ?? null
        }),
      { timeout: 30_000 },
    )
    .toMatchObject({ where: 'tab' })
})

test('the snapshot mirrors what WhatsApp holds into SQLite on OPFS', async () => {
  await expect
    .poll(() => archive<{ messages: number; chats: number }>({ op: 'stats' }), { timeout: 30_000 })
    .toMatchObject({ messages: 7, chats: 2 })
})

test('search finds a word in either German spelling', async () => {
  for (const query of ['München', 'Muenchen']) {
    // Only message text: the same word also turns up in the recognised invoice and the PDF.
    const result = await archive<{ hits: { msgId: string }[] }>({
      op: 'search',
      query: `${query} source:body`,
      limit: 10,
    })
    expect(result.hits.map((h) => h.msgId)).toEqual(['false_fam@g.us_M1'])
  }
})

test('a message that arrives later is mirrored live', async () => {
  await whatsapp.evaluate(() => {
    ;(
      window as unknown as { __fakeWa: { receive(id: string, body: string): void } }
    ).__fakeWa.receive('LIVE1', 'Der Schlüssel liegt unter der Fußmatte')
  })
  await expect
    .poll(
      async () =>
        (
          await archive<{ hits: { msgId: string }[] }>({
            op: 'search',
            query: 'Fussmatte',
            limit: 5,
          })
        ).hits.length,
      { timeout: 15_000 },
    )
    .toBe(1)
})

test('a message deleted for everyone stays in the archive, marked, and is still found', async () => {
  await whatsapp.evaluate(() => {
    ;(window as unknown as { __fakeWa: { revoke(id: string): void } }).__fakeWa.revoke('LIVE1')
  })
  await expect
    .poll(
      async () =>
        (
          await archive<{ messages: { body: string | null; revoked: boolean }[] }>({
            op: 'messages',
            ids: ['false_fam@g.us_LIVE1'],
          })
        ).messages[0],
      { timeout: 15_000 },
    )
    .toMatchObject({ body: 'Der Schlüssel liegt unter der Fußmatte', revoked: true })
  const found = await archive<{ hits: { msgId: string }[] }>({
    op: 'search',
    query: 'Fussmatte',
    limit: 5,
  })
  expect(found.hits.map((h) => h.msgId)).toEqual(['false_fam@g.us_LIVE1'])
})

test('an image is fetched through WhatsApp’s downloader into the OPFS media store', async () => {
  await expect
    .poll(
      async () =>
        (
          await archive<{ path: string | null }>({
            op: 'blobPath',
            mediaId: 'ZmFrZS1yZWNobnVuZw==',
          })
        ).path,
      { timeout: 60_000 },
    )
    .toMatch(/^blobs\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/)

  // The panel reads the file straight from OPFS — the same origin as the worker that wrote it.
  const { path } = await archive<{ path: string }>({
    op: 'blobPath',
    mediaId: IMAGE,
  })
  const size = await panel.evaluate(async (file) => {
    let dir = await navigator.storage.getDirectory()
    const parts = file.split('/')
    const name = parts.pop() ?? ''
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    return (await (await dir.getFileHandle(name)).getFile()).size
  }, path)
  expect(size).toBe(Buffer.from(files[0]?.base64 ?? '', 'base64').length)
})

test('the unread count from WhatsApp’s IndexedDB reaches the toolbar badge, muted chats aside', async () => {
  await expect
    .poll(() => inExtension(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
    .toBe('3')
})

test('a WhatsApp notification becomes an extension notification', async () => {
  await whatsapp.evaluate(() => {
    ;(window as unknown as { __fakeWa: { notify(t: string, b: string): unknown } }).__fakeWa.notify(
      'Anna Beispiel',
      'Bist du schon da?',
    )
  })
  await expect
    .poll(() => inExtension(async () => Object.keys(await chrome.notifications.getAll()).length), {
      timeout: 15_000,
    })
    .toBe(1)
})

test('the panel finds a message and says which chat it came from', async () => {
  await panel.reload()
  await panel.getByRole('searchbox', { name: 'In allen Chats suchen …' }).fill('Fussmatte')
  const hit = panel.getByRole('listitem').filter({ hasText: 'Fußmatte' })
  await expect(hit).toContainText('Familie Beispiel')
  await expect(hit).toContainText('Anna Beispiel')
  // Deleted for everyone after it was mirrored: still found, and says so.
  await expect(hit).toContainText('für alle gelöscht')
})

test('the panel opens a chat from the archive, with sender names instead of numbers', async () => {
  await panel.getByRole('button', { name: 'Chats', exact: true }).first().click()
  await panel
    .getByRole('button', { name: /Familie Beispiel/ })
    .first()
    .click()
  await expect(panel.getByText('Treffen am Samstag in München?')).toBeVisible()
  await expect(panel.getByText('Anna Beispiel').first()).toBeVisible()
  await expect(panel.getByText('Gerne, Grüße an alle!')).toBeVisible()
  await expect(panel.getByText('Der Schlüssel liegt unter der Fußmatte')).toBeVisible()
  await expect(panel.getByText('für alle gelöscht ·')).toBeVisible()
})

test('a setting changed in the panel reaches WhatsApp’s page', async () => {
  await panel
    .getByRole('button', { name: /Einstellungen|Mehr/ })
    .first()
    .click()
  await panel.getByRole('switch', { name: 'Kanäle ausblenden' }).click()
  await expect
    .poll(() =>
      whatsapp.evaluate(() => document.getElementById('watis-ui-layer')?.textContent ?? ''),
    )
    .toContain('channels')
})

/** The media ids of the hits for a query, once the index has caught up. */
async function hitMedia(query: string): Promise<(string | null)[]> {
  const result = await archive<{ hits: { mediaId: string | null }[] }>({
    op: 'search',
    query,
    limit: 20,
  })
  return result.hits.map((hit) => hit.mediaId)
}

test('text in a picture is recognised and becomes searchable', async () => {
  await expect.poll(() => hitMedia('Lieferung source:ocr'), { timeout: 90_000 }).toContain(IMAGE)
})

test('a PDF’s text layer becomes searchable', async () => {
  await expect.poll(() => hitMedia('Angebot source:pdf'), { timeout: 90_000 }).toContain(TEXT_PDF)
})

test('a scanned PDF page is rendered and recognised', async () => {
  await expect
    .poll(() => hitMedia('Gescanntes source:ocr'), { timeout: 120_000 })
    .toContain(SCANNED_PDF)
})

test('a voice message is transcribed on a click and becomes searchable', async () => {
  test.skip(!existsSync(WHISPER_MODEL), `no speech model at ${WHISPER_MODEL}`)
  test.setTimeout(240_000)

  // The model comes from a file here — the path for networks where GitHub is blocked. It is held
  // to the same checksum a download is.
  await panel.reload()
  await panel
    .getByRole('button', { name: /Einstellungen|Mehr/ })
    .first()
    .click()
  await panel.getByLabel('Modell aus einer Datei').setInputFiles(WHISPER_MODEL)
  await expect(panel.getByText('Modell übernommen.')).toBeVisible({ timeout: 60_000 })
  await expect(panel.getByText('Bereit', { exact: true })).toBeVisible()
  // The fixture speaks English; German is the default.
  await panel.getByLabel('Sprache der Sprachnachrichten').selectOption('en')

  // Voice messages are not fetched automatically by default; this one is fetched by hand.
  await panel.getByRole('button', { name: 'Medien', exact: true }).first().click()
  await panel.getByRole('tab', { name: 'Sprache' }).click()
  await panel.getByRole('button', { name: 'Laden', exact: true }).first().click()
  await panel.getByRole('button', { name: 'Transkribieren' }).click()

  const transcript = panel.getByRole('figure').filter({ hasText: 'Transkript' })
  await expect(transcript).toContainText(/kitchen/i, { timeout: 180_000 })
  expect(await hitMedia('kitchen source:transcript')).toContain(VOICE)
})

test('a backup into a folder writes the desktop layout, and the next one only what is new', async () => {
  await panel.reload()
  // The folder picker is a native dialog no test can click; an OPFS folder stands in for the
  // chosen one — the same FileSystemDirectoryHandle interface, permission already granted.
  await panel.evaluate(() => {
    ;(window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker =
      async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('test-backup', {
          create: true,
        })
  })
  await panel
    .getByRole('button', { name: /Einstellungen|Mehr/ })
    .first()
    .click()
  await panel.getByRole('button', { name: 'Ordner wählen …' }).click()
  await expect(panel.getByText('„test-backup“ · noch nie gesichert')).toBeVisible()
  await panel.getByRole('button', { name: 'Jetzt sichern' }).click()
  await expect(panel.getByText(/Gesichert: [3-9] neue Dateien, 0 waren schon da/)).toBeVisible({
    timeout: 60_000,
  })

  const written = await panel.evaluate(async (image) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('test-backup')
    const read = async (path: string): Promise<File> => {
      const parts = path.split('/')
      const name = parts.pop() ?? ''
      let dir = root
      for (const part of parts) dir = await dir.getDirectoryHandle(part)
      return (await dir.getFileHandle(name)).getFile()
    }
    const database = await (await read('archive.sqlite')).slice(0, 15).text()
    const report = JSON.parse(await (await read('BACKUP.json')).text()) as { kind: string }
    return { database, kind: report.kind, image: (await read(image)).size }
  }, OPFS_IMAGE_PATH)
  expect(written).toEqual({
    database: 'SQLite format 3',
    kind: 'folder',
    image: Buffer.from(files[0]?.base64 ?? '', 'base64').length,
  })

  await panel.getByRole('button', { name: 'Jetzt sichern' }).click()
  await expect(panel.getByText(/Gesichert: 0 neue Dateien, [3-9] waren schon da/)).toBeVisible({
    timeout: 60_000,
  })
})

test('a ZIP backup lands in the downloads, and the next one carries only new media', async () => {
  await panel.getByRole('button', { name: 'Als ZIP herunterladen' }).click()
  await expect(
    panel.getByText(/Im Download-Ordner: watis-sicherung-[\d-]+\.zip · [3-9] Medien/),
  ).toBeVisible({ timeout: 60_000 })

  const item = await inExtension(async () => {
    const [download] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 })
    return { state: download?.state, file: download?.filename ?? '' }
  })
  expect(item.state).toBe('complete')
  // Read back from disk through its central directory, as an unzip tool would.
  const zip = readFileSync(item.file)
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const names: string[] = []
  for (let i = 0, at = zip.readUInt32LE(end + 16); i < zip.readUInt16LE(end + 10); i++) {
    const length = zip.readUInt16LE(at + 28)
    names.push(zip.subarray(at + 46, at + 46 + length).toString('utf8'))
    at += 46 + length
  }
  expect(names).toEqual(expect.arrayContaining(['archive.sqlite', OPFS_IMAGE_PATH, 'BACKUP.json']))

  await panel.getByRole('button', { name: 'Als ZIP herunterladen' }).click()
  await expect(
    panel.getByText(/Im Download-Ordner: watis-sicherung-[\d-]+\.zip · 0 Medien/),
  ).toBeVisible({ timeout: 60_000 })
})

test('a file WhatsApp will not hand over says why, in plain German, with a way to the help', async () => {
  await panel.reload()
  await panel.getByRole('button', { name: 'Medien', exact: true }).first().click()
  await panel.getByRole('tab', { name: 'Sprache' }).click()
  // Newest first: the view-once message is older than the other voice message, so it is last.
  await panel.getByRole('button', { name: 'Laden', exact: true }).last().click()
  await expect(
    panel.getByText('„Einmal ansehen“-Medien archiviert WatIs? bewusst nicht.'),
  ).toBeVisible({
    timeout: 30_000,
  })
  await panel.getByRole('button', { name: 'Mehr dazu' }).first().click()
  await expect(
    panel.getByRole('heading', { name: 'Bilder, Videos und Sprachnachrichten' }),
  ).toBeVisible()
})

test('the help opens from the navigation and from the "?" beside a setting', async () => {
  await panel.getByRole('button', { name: 'Hilfe', exact: true }).click()
  await expect(panel.getByRole('button', { name: /Erste Schritte/ })).toBeVisible()
  await panel.getByRole('button', { name: /Suchen/ }).click()
  // The syntax table is rendered from the same list the search tips use.
  await expect(panel.getByText('von:Anna', { exact: true })).toBeVisible()

  await panel.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await panel.getByRole('button', { name: 'Hilfe: Sicherung' }).click()
  await expect(panel.getByRole('heading', { name: 'Sicherung', exact: true })).toBeVisible()
  await expect(panel.getByText('Jetzt sichern').first()).toBeVisible()
})
