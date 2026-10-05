import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import {
  fakeWhatsAppHeaders,
  fakeWhatsAppPage,
  type DemoChat,
  type FakeFile,
} from './fake-whatsapp'

/**
 * The pictures the extension stores ask for (docs/store-eintraege.md): screenshots at 1280×800 and
 * the promotional tiles. `npm run store:assets` writes them to out/store/.
 *
 * Taken from the extension itself, against the stand-in WhatsApp Web the E2E tests use, with a few
 * more chats. Every name and message is invented (CLAUDE.md: no real data, no screenshots with real
 * content). Not a test: it runs only through playwright.store.config.ts, never in CI.
 */

const root = resolve(__dirname, '..', '..')
const out = join(root, 'out', 'store')
const extensionDir = join(root, 'out', 'extension', 'chromium')
const fixture = (name: string): string =>
  readFileSync(join(root, 'test', 'fixtures', name)).toString('base64')

const files: FakeFile[] = [
  {
    hash: 'ZmFrZS1yZWNobnVuZw==',
    mime: 'image/png',
    caption: 'Die Rechnung vom Handwerker',
    base64: fixture('ocr-rechnung.png'),
  },
  ...(
    [
      ['ocr-whiteboard.png', 'Notizen vom Elternabend'],
      ['ocr-screenshot.png', 'Die Zugverbindung für Samstag'],
      ['ocr-schraeg.png', undefined],
      ['ocr-rechnung-dicht.png', 'Kassenbon Baumarkt'],
    ] as const
  ).map(([name, caption], i) => ({
    hash: Buffer.from(`demo-bild-${String(i)}`).toString('base64'),
    mime: 'image/png',
    ...(caption ? { caption } : {}),
    base64: fixture(name),
  })),
  {
    hash: 'YW5nZWJvdC10ZXh0',
    mime: 'application/pdf',
    filename: 'Angebot.pdf',
    base64: fixture('angebot-text.pdf'),
  },
]

const demo: DemoChat[] = [
  {
    id: 'verein@g.us',
    name: 'Sportverein Beispielstadt',
    isGroup: true,
    members: [
      { id: '4915550000003@c.us', name: 'Lena Beispiel' },
      { id: '4915550000004@c.us', name: 'Tom Muster' },
    ],
    messages: [
      {
        body: 'Training am Donnerstag fällt aus, die Halle ist belegt.',
        minutesAgo: 2900,
        from: '4915550000003@c.us',
      },
      {
        body: 'Dann treffen wir uns Samstag um 10 Uhr am Sportplatz.',
        minutesAgo: 2880,
        from: '4915550000004@c.us',
      },
      { body: 'Ich bringe die neuen Trikots mit.', minutesAgo: 1500, fromMe: true },
      {
        body: 'Die Rechnung für die Trikots schicke ich nächste Woche.',
        minutesAgo: 1440,
        from: '4915550000003@c.us',
      },
    ],
  },
  {
    id: '4915550000002@c.us',
    name: 'Max Mustermann',
    messages: [
      { body: 'Hast du die Rechnung vom Handwerker noch?', minutesAgo: 400 },
      { body: 'Ja, liegt im Chat mit Anna. Ich suche sie raus.', minutesAgo: 390, fromMe: true },
      { body: 'Super, danke! Brauche sie für die Steuer.', minutesAgo: 385 },
    ],
  },
  {
    id: 'nachbarn@g.us',
    name: 'Nachbarschaft Musterweg',
    isGroup: true,
    members: [{ id: '4915550000005@c.us', name: 'Familie Muster' }],
    messages: [
      {
        body: 'Wer hat ein Paket für Hausnummer 12 angenommen?',
        minutesAgo: 9000,
        from: '4915550000005@c.us',
      },
      { body: 'Liegt bei mir, könnt ihr heute Abend abholen.', minutesAgo: 8990, fromMe: true },
      {
        body: 'Am Freitag ist Sperrmüll, bitte nichts vor die Garagen stellen.',
        minutesAgo: 30,
        from: '4915550000005@c.us',
      },
    ],
  },
]

let context: BrowserContext
let panel: Page

test.beforeAll(async () => {
  mkdirSync(out, { recursive: true })
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'watis-store-')), {
    ...(process.env.WATIS_CHROMIUM
      ? { executablePath: process.env.WATIS_CHROMIUM }
      : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  })
  await context.route('https://web.whatsapp.com/**', (route) =>
    route.fulfill({
      status: 200,
      headers: fakeWhatsAppHeaders(),
      body: fakeWhatsAppPage(files, demo),
    }),
  )
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(worker.url()).host
  const whatsapp = await context.newPage()
  await whatsapp.goto('https://web.whatsapp.com/')
  panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel.html`)

  // Until the invoice picture has been read: then a search shows text and picture hits together.
  await expect
    .poll(
      () =>
        panel.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
          if (tab?.id === undefined) return 0
          const reply = await chrome.tabs.sendMessage<
            unknown,
            { ok: boolean; value?: { hits: unknown[] } } | undefined
          >(tab.id, {
            kind: 'archive',
            request: { op: 'search', query: 'Lieferung source:ocr', limit: 5 },
          })
          return reply?.ok ? (reply.value?.hits.length ?? 0) : 0
        }),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0)
  // The panel opened before the archive was filled; loading it again shows every chat by name.
  await panel.reload()
})

test.afterAll(async () => {
  await context.close()
})

async function shot(name: string): Promise<void> {
  await panel.waitForTimeout(800)
  await panel.screenshot({ path: join(out, name) })
}

test('screenshots', async () => {
  test.setTimeout(240_000)
  const nav = panel.getByRole('navigation', { name: 'Bereiche' })

  await panel.getByRole('searchbox', { name: 'In allen Chats suchen …' }).fill('Rechnung')
  await panel.getByText('Hast du die').click()
  await expect(panel.getByText('Super, danke!')).toBeVisible()
  await shot('1-suche.png')

  await nav.getByRole('button', { name: 'Chats' }).click()
  await panel.getByText('Sportverein Beispielstadt').first().click()
  await shot('2-chats.png')

  await nav.getByRole('button', { name: 'Medien' }).click()
  await shot('3-medien.png')

  await nav.getByRole('button', { name: 'Einstellungen' }).click()
  await shot('4-einstellungen.png')

  await panel
    .getByRole('navigation', { name: 'Hilfe' })
    .getByRole('button', { name: 'Hilfe' })
    .click()
  await shot('5-hilfe.png')
})

/**
 * The promotional tiles: the icon, the name and one sentence. No WhatsApp name or logo in a picture:
 * the stores read that as a claim to be WhatsApp's own.
 */
test('promotional tiles', async () => {
  const icon = readFileSync(join(root, 'build', 'icon.png')).toString('base64')
  const page = await context.newPage()
  for (const [name, width, height, scale] of [
    ['kachel-klein-440x280.png', 440, 280, 1],
    ['kachel-gross-1400x560.png', 1400, 560, 2.4],
  ] as const) {
    await page.setViewportSize({ width, height })
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div style="width:${width}px;height:${height}px;box-sizing:border-box;display:flex;align-items:center;
        gap:${24 * scale}px;padding:0 ${36 * scale}px;background:linear-gradient(135deg,#f4faf8,#d9efe9);
        font-family:'DejaVu Sans',Arial,sans-serif;color:#0b3d36">
        <img src="data:image/png;base64,${icon}" style="width:${96 * scale}px;height:${96 * scale}px;border-radius:${20 * scale}px">
        <div>
          <div style="font-size:${40 * scale}px;font-weight:700;line-height:1.1">WatIs?</div>
          <div style="font-size:${17 * scale}px;line-height:1.35;margin-top:${10 * scale}px;max-width:${240 * scale}px">
            Deine Chats durchsuchbar archiviert. Alles bleibt auf deinem Rechner.</div>
        </div>
      </div></body></html>`)
    await page.screenshot({ path: join(out, name) })
  }
})
