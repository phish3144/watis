import http from 'node:http'
// Control page: a nonce-based CSP as strict as WhatsApp Web's, served locally.
const NONCE = 'spikeNonce123'
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `script-src 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-eval' https:; object-src 'none'; base-uri 'none'`,
  })
  res.end(
    `<!doctype html><title>control</title><script nonce="${NONCE}">window.__pageScriptRan = true</script><h1>control</h1>`,
  )
})
server.listen(8731, '127.0.0.1', () => console.log('control server on 8731'))
