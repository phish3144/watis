// Drives a real Firefox over WebDriver BiDi (no Playwright: its Firefox build cannot load
// extensions). Usage: FIREFOX=/path/to/firefox node run-firefox.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assemble } from './assemble.mjs'

const EXT = assemble('firefox')
const profile = mkdtempSync(join(tmpdir(), 'ffp-'))
const proxy = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : undefined
const prefs = {
  'browser.shell.checkDefaultBrowser': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'browser.aboutwelcome.enabled': false,
  ...(proxy
    ? {
        'network.proxy.type': 1,
        'network.proxy.ssl': proxy.hostname,
        'network.proxy.ssl_port': Number(proxy.port),
        'network.proxy.no_proxies_on': 'localhost, 127.0.0.1',
      }
    : {}),
}
writeFileSync(
  join(profile, 'user.js'),
  Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('\n'),
)

const PORT = 9333
const ff = spawn(
  process.env.FIREFOX,
  ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${PORT}`],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
await new Promise((resolve) =>
  ff.stderr.on('data', (d) => {
    if (/WebDriver BiDi listening/.test(String(d))) resolve()
  }),
)

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`)
await new Promise((r) => ws.addEventListener('open', r))
let next = 1
const waiting = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg)
    waiting.delete(msg.id)
  }
})
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = next++
    waiting.set(id, (m) =>
      m.type === 'error'
        ? reject(new Error(`${method}: ${m.error} ${m.message}`))
        : resolve(m.result),
    )
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (context, expression) =>
  (await call('script.evaluate', { expression, target: { context }, awaitPromise: true })).result
    ?.value

try {
  await call('session.new', { capabilities: {} })
  const installed = await call('webExtension.install', {
    extensionData: { type: 'path', path: EXT },
  })
  console.log('installed', installed.extension)
  const { contexts } = await call('browsingContext.getTree')
  const ctx = contexts[0].context
  await call('browsingContext.navigate', {
    context: ctx,
    url: 'https://web.whatsapp.com/',
    wait: 'interactive',
  })
  const attrs = `JSON.stringify(Object.fromEntries([...document.documentElement.attributes].filter(a => a.name.startsWith('data-probe')).map(a => [a.name, a.value])))`
  let result = '{}'
  for (let i = 0; i < 60; i++) {
    result = await evaluate(ctx, attrs)
    if (JSON.parse(result)['data-probe-background']) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  await new Promise((r) => setTimeout(r, 2000))
  result = await evaluate(ctx, attrs)
  console.log('PAGE', JSON.stringify(JSON.parse(result), null, 2))
  const checkUrl = JSON.parse(result)['data-probe-check-url']
  if (checkUrl) {
    const { context: tab } = await call('browsingContext.create', { type: 'tab' })
    await call('browsingContext.navigate', { context: tab, url: checkUrl, wait: 'complete' })
    await new Promise((r) => setTimeout(r, 2000))
    console.log('CHECK', await evaluate(tab, `document.documentElement.getAttribute('data-check')`))
  }
} catch (error) {
  console.log('FAILED', String(error))
} finally {
  ws.close()
  ff.kill()
}
