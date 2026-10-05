#!/usr/bin/env node
// The browser extension's end-to-end check in a real Firefox (ADR 0010).
//
// Playwright's Firefox build cannot load extensions, so this drives a stock Firefox release over
// WebDriver BiDi directly: install the add-on, serve the stand-in WhatsApp page at the real URL
// with the real headers (network interception), and ask the archive the way the panel does, from
// the panel tab the extension opens on first install.
//
//   FIREFOX=/path/to/firefox npm run test:extension:firefox
//
// Without FIREFOX it says so and exits 0: a developer without Firefox is not a failing build. CI
// sets it.

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The same model the Chromium test uses; `npm run models:fetch base` puts it there.
const whisperModel =
  process.env.WATIS_WHISPER_MODEL ?? join(root, '.cache', 'whisper', 'ggml-base-q5_1.bin')
const firefoxBinary = process.env.FIREFOX
if (!firefoxBinary) {
  console.log('skip  FIREFOX is not set; the Firefox extension check did not run')
  process.exit(0)
}

const fakeSource = ts.transpileModule(
  readFileSync(join(root, 'test', 'extension', 'fake-whatsapp.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText
const fake = await import(
  `data:text/javascript;base64,${Buffer.from(fakeSource).toString('base64')}`
)
const fixture = (name) => readFileSync(join(root, 'test', 'fixtures', name)).toString('base64')
const IMAGE = 'ZmFrZS1yZWNobnVuZw=='
const TEXT_PDF = 'YW5nZWJvdC10ZXh0'
const SCANNED_PDF = 'YW5nZWJvdC1zY2Fu'
const VOICE = 'c3ByYWNobmFjaHJpY2h0'
const page = fake.fakeWhatsAppPage([
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
    hash: VOICE,
    mime: 'audio/ogg; codecs=opus',
    base64: fixture('sprachnachricht.ogg'),
  },
])
const headers = Object.entries(fake.fakeWhatsAppHeaders('firefox')).map(([name, value]) => ({
  name,
  value: { type: 'string', value },
}))

const profile = mkdtempSync(join(tmpdir(), 'watis-ff-'))
const downloads = mkdtempSync(join(tmpdir(), 'watis-ff-downloads-'))
writeFileSync(
  join(profile, 'user.js'),
  [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    // Downloads into a folder of the test's own, without asking.
    'user_pref("browser.download.folderList", 2);',
    `user_pref("browser.download.dir", ${JSON.stringify(downloads)});`,
    'user_pref("browser.download.useDownloadDir", true);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    // MV3 host permissions are granted at install in current Firefox; this makes it certain for a
    // temporary add-on in a fresh profile.
    'user_pref("extensions.originControls.grantByDefault", true);',
  ].join('\n'),
)

const PORT = 9300 + Math.floor(Math.random() * 500)
const firefox = spawn(
  firefoxBinary,
  [
    '--headless',
    '--no-remote',
    '--profile',
    profile,
    `--remote-debugging-port=${String(PORT)}`,
    // Evaluating in the panel tab (a moz-extension page) is "system access" to BiDi. Test-only.
    '-remote-allow-system-access',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
await new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error('Firefox did not start BiDi')), 60_000)
  firefox.stderr.on('data', (chunk) => {
    if (/WebDriver BiDi listening/.test(String(chunk))) {
      clearTimeout(timer)
      resolveReady()
    }
  })
})

const ws = new WebSocket(`ws://127.0.0.1:${String(PORT)}/session`)
await new Promise((r) => ws.addEventListener('open', r))
let nextId = 1
const waiting = new Map()
const listeners = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && waiting.has(message.id)) {
    waiting.get(message.id)(message)
    waiting.delete(message.id)
  } else if (message.type === 'event') {
    for (const listener of listeners) listener(message)
  }
})
const call = (method, params = {}) =>
  new Promise((resolveCall, reject) => {
    const id = nextId++
    waiting.set(id, (m) =>
      m.type === 'error'
        ? reject(new Error(`${method}: ${m.error} ${m.message}`))
        : resolveCall(m.result),
    )
    ws.send(JSON.stringify({ id, method, params }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Evaluates and returns plain JSON — BiDi's own value serialisation is a tree of typed pairs. */
async function evaluate(context, expression) {
  const result = await call('script.evaluate', {
    expression: `(async () => JSON.stringify(await (${expression}) ?? null))()`,
    target: { context },
    awaitPromise: true,
    resultOwnership: 'none',
  })
  if (result.type === 'exception') throw new Error(result.exceptionDetails.text)
  return JSON.parse(result.result.value)
}

const failures = []
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok    ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL  ${name}: ${String(error)}`)
  }
}
async function poll(fn, predicate, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) {
    try {
      last = await fn()
      if (predicate(last)) return last
    } catch (error) {
      last = String(error)
    }
    await sleep(500)
  }
  throw new Error(`timed out, last value ${JSON.stringify(last)}`)
}

try {
  await call('session.new', { capabilities: {} })
  await call('session.subscribe', { events: ['network.beforeRequestSent'] })
  await call('network.addIntercept', {
    phases: ['beforeRequestSent'],
    urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: 'web.whatsapp.com' }],
  })
  listeners.push((event) => {
    if (event.method !== 'network.beforeRequestSent' || !event.params.isBlocked) return
    void call('network.provideResponse', {
      request: event.params.request.request,
      statusCode: 200,
      reasonPhrase: 'OK',
      headers,
      body: { type: 'string', value: page },
    })
  })

  await call('webExtension.install', {
    extensionData: { type: 'path', path: join(root, 'out', 'extension', 'firefox') },
  })
  // The extension opens its panel in a tab on first install. That tab is a full extension page,
  // and the one place this script can use browser.* the way the panel does.
  const panel = await poll(
    async () =>
      (await call('browsingContext.getTree')).contexts.find((c) => c.url.includes('/panel.html'))
        ?.context,
    Boolean,
  )
  const { context: tab } = await call('browsingContext.create', { type: 'tab' })
  await call('browsingContext.navigate', {
    context: tab,
    url: 'https://web.whatsapp.com/',
    wait: 'complete',
  })

  const archive = (request) =>
    evaluate(
      panel,
      `browser.tabs.query({ url: 'https://web.whatsapp.com/*' }).then(([tab]) =>
         browser.tabs.sendMessage(tab.id, { kind: 'archive', request: ${JSON.stringify(request)} })
       ).then((reply) => {
         if (!reply) throw new Error('the WhatsApp tab did not answer')
         if (!reply.ok) throw new Error(reply.error)
         return reply.value
       })`,
    )
  const session = (key) =>
    evaluate(
      panel,
      `browser.storage.session.get(${JSON.stringify(key)}).then((s) => s[${JSON.stringify(key)}] ?? null)`,
    )

  await check('the bridge comes up in the page world, despite the nonce CSP', async () => {
    await poll(
      () => session('watis:bridge'),
      (v) => v?.ok === true,
    )
  })
  await check('the archive opens inside the WhatsApp tab, despite its COEP', async () => {
    await poll(
      () => session('watis:host'),
      (v) => v?.where === 'tab',
    )
  })
  await check('the snapshot mirrors what WhatsApp holds into SQLite on OPFS', async () => {
    await poll(
      () => archive({ op: 'stats' }),
      (v) => v?.messages === 6 && v?.chats === 2,
    )
  })
  await check('search finds a word in either German spelling', async () => {
    for (const query of ['München', 'Muenchen']) {
      // Only message text: the same word also turns up in the recognised invoice and the PDF.
      const result = await archive({ op: 'search', query: `${query} source:body`, limit: 10 })
      if (result.hits.length !== 1) throw new Error(`${query}: ${String(result.hits.length)} hits`)
    }
  })
  await check('a message that arrives later is mirrored live', async () => {
    await evaluate(
      tab,
      `window.__fakeWa.receive('LIVE1', 'Der Schlüssel liegt unter der Fußmatte')`,
    )
    await poll(
      () => archive({ op: 'search', query: 'Fussmatte', limit: 5 }),
      (v) => v?.hits?.length === 1,
    )
  })
  await check('a message deleted for everyone stays, marked, and is still found', async () => {
    await evaluate(tab, `(window.__fakeWa.revoke('LIVE1'), true)`)
    await poll(
      () => archive({ op: 'messages', ids: ['false_fam@g.us_LIVE1'] }),
      (v) => v?.messages?.[0]?.revoked === true && v.messages[0].body?.includes('Fußmatte'),
    )
    const found = await archive({ op: 'search', query: 'Fussmatte', limit: 5 })
    if (found.hits.length !== 1) throw new Error(`${String(found.hits.length)} hits`)
  })
  await check('an image is fetched into the OPFS media store', async () => {
    await poll(
      () => archive({ op: 'blobPath', mediaId: IMAGE }),
      (v) => typeof v?.path === 'string',
      60_000,
    )
  })
  const hitMedia = async (query) =>
    (await archive({ op: 'search', query, limit: 20 })).hits.map((hit) => hit.mediaId)
  await check('text in a picture is recognised and becomes searchable', async () => {
    await poll(
      () => hitMedia('Lieferung source:ocr'),
      (v) => v.includes(IMAGE),
      120_000,
    )
  })
  await check('a PDF’s text layer becomes searchable', async () => {
    await poll(
      () => hitMedia('Angebot source:pdf'),
      (v) => v.includes(TEXT_PDF),
      120_000,
    )
  })
  await check('a scanned PDF page is rendered and recognised', async () => {
    await poll(
      () => hitMedia('Gescanntes source:ocr'),
      (v) => v.includes(SCANNED_PDF),
      150_000,
    )
  })
  await check('the unread count reaches the toolbar badge', async () => {
    await poll(
      () => evaluate(panel, 'browser.action.getBadgeText({})'),
      (v) => v === '3',
    )
  })
  await check('a WhatsApp notification becomes an extension notification', async () => {
    // Headless Firefox has no notification centre: a notification is created and closed at once,
    // so getAll() is always empty. Its lifecycle events are the evidence that it was created.
    await evaluate(
      panel,
      `(window.__seen = [],
        browser.notifications.onShown.addListener((id) => window.__seen.push(id)),
        browser.notifications.onClosed.addListener((id) => window.__seen.push(id)),
        true)`,
    )
    await evaluate(tab, `(window.__fakeWa.notify('Anna Beispiel', 'Bist du schon da?'), true)`)
    await poll(
      () => evaluate(panel, 'window.__seen'),
      (seen) => Array.isArray(seen) && seen.some((id) => /^\d+:n\d+$/.test(id)),
    )
  })
  await check('a ZIP backup lands in the downloads, with the database and the media', async () => {
    // Firefox has no folder access for extensions; the ZIP is its backup. Driven through the
    // panel's own buttons, found by their text.
    const click = (label) =>
      evaluate(
        panel,
        `(() => {
           const button = [...document.querySelectorAll('button')].find(
             (b) => b.textContent.trim() === ${JSON.stringify(label)} ||
               b.getAttribute('aria-label') === ${JSON.stringify(label)})
           if (!button) throw new Error('no button ' + ${JSON.stringify(label)})
           button.click()
           return true
         })()`,
      )
    await click('Einstellungen')
    await poll(() => click('Als ZIP herunterladen'), Boolean)
    await poll(
      () => evaluate(panel, 'document.body.textContent'),
      (text) => /Im Download-Ordner: watis-sicherung-[\d-]+\.zip · [3-9] Medien/.test(text),
      60_000,
    )
    const file = await evaluate(
      panel,
      `browser.downloads.search({ orderBy: ['-startTime'], limit: 1 }).then(([d]) =>
         d.state === 'complete' ? d.filename : 'state ' + d.state)`,
    )
    const zip = readFileSync(file)
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const names = []
    for (let i = 0, at = zip.readUInt32LE(end + 16); i < zip.readUInt16LE(end + 10); i++) {
      const length = zip.readUInt16LE(at + 28)
      names.push(zip.subarray(at + 46, at + 46 + length).toString('utf8'))
      at += 46 + length
    }
    for (const name of ['archive.sqlite', 'BACKUP.json']) {
      if (!names.includes(name)) throw new Error(`${name} missing from ${names.join(', ')}`)
    }
    if (names.filter((name) => name.startsWith('blobs/')).length < 3) {
      throw new Error(`media missing: ${names.join(', ')}`)
    }
  })
  // whisper.cpp needs a cross-origin isolated page. Firefox does not isolate its extension pages,
  // but it does isolate the archive frame in the WhatsApp tab, so that is where it runs (ADR 0012).
  if (existsSync(whisperModel)) {
    await check(
      'a voice message is transcribed in the WhatsApp tab and becomes searchable',
      async () => {
        // Firefox refuses `input.setFiles` in extension pages, so the file input cannot be driven
        // from here (Chromium's test covers it). The model is served from a local server instead and
        // put where an import would put it.
        const server = createServer((request, response) => {
          response.writeHead(200, {
            'content-type': 'application/octet-stream',
            'access-control-allow-origin': '*',
          })
          createReadStream(whisperModel).pipe(response)
        })
        await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
        try {
          const url = `http://127.0.0.1:${String(server.address().port)}/model.bin`
          await evaluate(
            panel,
            `fetch(${JSON.stringify(url)}).then((r) => r.blob()).then(async (blob) => {
             const root = await navigator.storage.getDirectory()
             const dir = await root.getDirectoryHandle('models', { create: true })
             const file = await dir.getFileHandle(${JSON.stringify(basename(whisperModel))}, { create: true })
             const out = await file.createWritable()
             await out.write(blob)
             await out.close()
             return blob.size
           })`,
          )
        } finally {
          server.close()
        }
        // The fixture speaks English; German is the default.
        await evaluate(
          panel,
          `browser.storage.local.get('watis:settings').then((s) =>
           browser.storage.local.set({ 'watis:settings': { ...s['watis:settings'], transcriptionLanguage: 'en' } }))`,
        )
        const toTab = (message) =>
          evaluate(
            panel,
            `browser.tabs.query({ url: 'https://web.whatsapp.com/*' }).then(([tab]) =>
             browser.tabs.sendMessage(tab.id, ${JSON.stringify(message)})
           ).then((reply) => {
             if (!reply.ok) throw new Error(reply.error)
             return reply.value
           })`,
          )
        await toTab({ kind: 'fetch-media', mediaId: VOICE })
        const { path } = await archive({ op: 'blobPath', mediaId: VOICE })
        const text = await toTab({ kind: 'transcribe', mediaId: VOICE, path })
        if (!/kitchen/i.test(text)) throw new Error(`transcript: ${JSON.stringify(text)}`)
        const hits = await hitMedia('kitchen source:transcript')
        if (!hits.includes(VOICE)) throw new Error('the transcript is not searchable')
      },
    )
  } else {
    console.log(`skip  no speech model at ${whisperModel}; the transcription check did not run`)
  }
} finally {
  ws.close()
  firefox.kill()
}

if (failures.length > 0) {
  console.error(`\nFAIL  ${String(failures.length)} Firefox extension check(s) failed`)
  process.exit(1)
}
console.log('\nok    the extension works in Firefox')
