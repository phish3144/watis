/**
 * A stand-in for web.whatsapp.com, for testing the browser extension without an account.
 *
 * It is served at the real URL (Playwright routes the request), with the real page's security
 * headers — the nonce CSP and the isolation headers, per browser as WhatsApp sends them — because
 * those decide whether the extension works at all (docs/extension-spike.md). Behind
 * `window.require` sit Backbone-like collections shaped the way the bridge's signatures expect.
 *
 * Every name, number and message here is invented (CLAUDE.md: no real data in the repository).
 */

export const NONCE = 'watisE2E'

/**
 * The headers web.whatsapp.com answers with, which differ by browser — measured on 2026-10-02 with
 * a real Chromium 141 and a real Firefox 157 (a plain `curl` with either user agent gets neither
 * set). They decide where the extension can run what: Firefox gets `same-origin` and so a
 * cross-origin isolated page and archive frame, which is where whisper.cpp runs there (ADR 0012);
 * Chromium gets `same-origin-allow-popups` and a Document-Isolation-Policy instead.
 */
export function fakeWhatsAppHeaders(
  browser: 'chromium' | 'firefox' = 'chromium',
): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'self' blob: 'wasm-unsafe-eval'; script-src blob: 'self' 'nonce-${NONCE}' 'wasm-unsafe-eval'; style-src data: blob: 'self' 'unsafe-inline'; img-src data: blob: 'self'; frame-ancestors https://*.whatsapp.com`,
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'cross-origin',
    ...(browser === 'firefox'
      ? { 'cross-origin-opener-policy': 'same-origin' }
      : {
          'cross-origin-opener-policy': 'same-origin-allow-popups',
          'document-isolation-policy': 'isolate-and-require-corp',
        }),
  }
}

export interface FakeFile {
  /** WhatsApp's filehash, which becomes the media id. */
  hash: string
  mime: string
  filename?: string
  caption?: string
  /** "View once" media, which the bridge deliberately does not archive. */
  viewOnce?: boolean
  base64: string
}

/** Each file is attached to one message in Anna's chat; the fake downloader hands back its bytes. */
export function fakeWhatsAppPage(files: readonly FakeFile[]): string {
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>WhatsApp</title>
<script nonce="${NONCE}">
(() => {
  const files = ${JSON.stringify(files)}
  const collection = (models) => {
    const handlers = new Map()
    return {
      get: (id) => models.find((m) => m.id === id || (m.id && m.id._serialized === id)),
      getModelsArray: () => models,
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) || []), handler]),
      off: (event, handler) => handlers.set(event, (handlers.get(event) || []).filter((h) => h !== handler)),
      add: (model) => { models.push(model); for (const h of handlers.get('add') || []) h(model) },
      emit: (event, model) => { for (const h of handlers.get(event) || []) h(model) },
    }
  }
  const key = (id, remote, fromMe = false) => ({ _serialized: (fromMe ? 'true' : 'false') + '_' + remote + '_' + id, id, remote, fromMe })
  const now = Math.floor(Date.now() / 1000)

  const chats = collection([
    { id: { _serialized: 'fam@g.us' }, name: 'Familie Beispiel', isGroup: true, t: now - 60 },
    { id: { _serialized: '4915550000001@c.us' }, name: 'Anna Beispiel', t: now - 120 },
  ])
  const contacts = collection([
    { id: { _serialized: '4915550000001@c.us' }, name: 'Anna Beispiel', pushname: 'Anna', userid: '4915550000001' },
  ])
  const messages = collection([
    { id: key('M1', 'fam@g.us'), t: now - 3600, type: 'chat', body: 'Treffen am Samstag in München?', from: { _serialized: '4915550000001@c.us' } },
    { id: key('M2', 'fam@g.us', true), t: now - 3500, type: 'chat', body: 'Gerne, Grüße an alle!', from: { _serialized: 'me@c.us' } },
    ...files.map((file, i) => ({
      id: key('F' + i, '4915550000001@c.us'),
      t: now - 600 + i,
      type: file.mime.startsWith('image/') ? 'image' : file.mime.startsWith('audio/') ? 'ptt' : 'document',
      caption: file.caption,
      filename: file.filename,
      filehash: file.hash,
      isViewOnce: file.viewOnce === true,
      mimetype: file.mime,
      size: Math.floor((file.base64.length * 3) / 4),
      directPath: '/fake/' + i,
      mediaKey: 'ZmFrZQ==',
      encFilehash: 'ZW5jcnlwdGVk',
      mediaKeyTimestamp: now,
      from: { _serialized: '4915550000001@c.us' },
    })),
  ])

  const allowed = {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4', 'video/3gpp'],
    ptt: ['audio/ogg; codecs=opus', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/amr'],
  }
  const bytes = Object.fromEntries(
    files.map((file) => [file.hash, Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))]),
  )
  const modules = {
    WAWebChatCollection: { ChatCollection: chats },
    WAWebMsgCollection: { MsgCollection: messages },
    WAWebContactCollection: { ContactCollection: contacts },
    // The downloader's contract as WA Web 2.3000.1049110567 has it (docs/bridge-map.md): the first
    // thing it does is call addAnnotations on downloadQpl, and it checks the mimetype against an
    // exact allowlist for every type but documents. Both failures are the real ones' messages.
    WAWebDownloadManager: {
      downloadManager: {
        async downloadAndMaybeDecrypt(options) {
          if (this !== modules.WAWebDownloadManager.downloadManager) throw new Error('called without this')
          options.downloadQpl.addAnnotations({})
          if (options.type !== 'document' && !(allowed[options.type] || []).includes(options.mimetype)) {
            const error = new Error('Unexpected mimetype ' + options.mimetype + ' for media type ' + options.type)
            error.name = 'InvalidMediaFileType'
            throw error
          }
          const message = messages.getModelsArray().find((m) => m.directPath === options.directPath)
          return bytes[message.filehash].buffer.slice(0)
        },
      },
    },
    WAWebMmsMediaTypes: {
      getMsgMediaType: (msg) => msg.type,
      mediaTypeToMsgTypeSupportedByAllowlist: (type) => (type === 'document' ? null : type),
      getValidMimeTypes: (type) => new Set(allowed[type] || []),
    },
  }
  window.require = (name) => {
    if (!(name in modules)) throw new Error('Requiring unknown module "' + name + '"')
    return modules[name]
  }

  // Test hooks, called from the spec through page.evaluate.
  window.__fakeWa = {
    receive(id, body) {
      messages.add({ id: key(id, 'fam@g.us'), t: Math.floor(Date.now() / 1000), type: 'chat', body, from: { _serialized: '4915550000001@c.us' } })
    },
    // What WhatsApp does when the sender deletes a message for everyone: same id, type "revoked",
    // text gone.
    revoke(id) {
      const message = messages.getModelsArray().find((m) => m.id.id === id)
      message.type = 'revoked'
      delete message.body
      messages.emit('change', message)
    },
    notify(title, body) {
      return new Notification(title, { body, tag: title })
    },
  }

  // The unread count, where WhatsApp keeps it: its own IndexedDB.
  const open = indexedDB.open('model-storage', 1)
  open.onupgradeneeded = () => open.result.createObjectStore('chat', { keyPath: 'id' })
  open.onsuccess = () => {
    const tx = open.result.transaction('chat', 'readwrite')
    tx.objectStore('chat').put({ id: 'fam@g.us', unreadCount: 3 })
    tx.objectStore('chat').put({ id: 'muted@g.us', unreadCount: 9, muteExpiration: -1 })
  }
})()
</script>
</head>
<body><div id="app"><header><div role="button"><span title="Familie Beispiel">Familie Beispiel</span></div></header></div></body>
</html>`
}
