/**
 * A stand-in for web.whatsapp.com, for testing the browser extension without an account.
 *
 * It is served at the real URL (Playwright routes the request), with the real page's security
 * headers — the nonce CSP and `Cross-Origin-Embedder-Policy: require-corp` — because those are the
 * two things that decide whether the extension works at all (docs/extension-spike.md). Behind
 * `window.require` sit Backbone-like collections shaped the way the bridge's signatures expect.
 *
 * Every name, number and message here is invented (CLAUDE.md: no real data in the repository).
 */

export const NONCE = 'watisE2E'

export function fakeWhatsAppHeaders(): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'self' blob: 'wasm-unsafe-eval'; script-src blob: 'self' 'nonce-${NONCE}' 'wasm-unsafe-eval'; style-src data: blob: 'self' 'unsafe-inline'; img-src data: blob: 'self'; frame-ancestors https://*.whatsapp.com`,
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'cross-origin-resource-policy': 'cross-origin',
  }
}

export interface FakeFile {
  /** WhatsApp's filehash, which becomes the media id. */
  hash: string
  mime: string
  filename?: string
  caption?: string
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
      type: file.mime.startsWith('image/') ? 'image' : 'document',
      caption: file.caption,
      filename: file.filename,
      filehash: file.hash,
      mimetype: file.mime,
      size: Math.floor((file.base64.length * 3) / 4),
      directPath: '/fake/' + i,
      mediaKey: 'ZmFrZQ==',
      mediaKeyTimestamp: now,
      from: { _serialized: '4915550000001@c.us' },
    })),
  ])

  const bytes = Object.fromEntries(
    files.map((file) => [file.hash, Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))]),
  )
  const modules = {
    WAWebChatCollection: { ChatCollection: chats },
    WAWebMsgCollection: { MsgCollection: messages },
    WAWebContactCollection: { ContactCollection: contacts },
    WAWebDownloadManager: {
      downloadManager: {
        downloadAndMaybeDecrypt: async (options) => {
          const message = messages.getModelsArray().find((m) => m.directPath === options.directPath)
          return bytes[message.filehash].buffer.slice(0)
        },
      },
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
