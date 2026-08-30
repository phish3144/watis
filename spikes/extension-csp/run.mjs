import { chromium } from '/home/user/watis/node_modules/playwright/index.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXT = process.argv[2]
const TARGETS = ['http://127.0.0.1:8731/', 'https://web.whatsapp.com/']
const profile = mkdtempSync(join(tmpdir(), 'watis-spike-'))

const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  proxy: { server: 'http://127.0.0.1:44767', bypass: '127.0.0.1,localhost' },
  ignoreHTTPSErrors: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-sandbox', '--disable-quic', '--ssl-version-max=tls1.2',
  ],
})

for (const url of TARGETS) {
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 400)}`))
  page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 200)}`))
  let status = null
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    status = resp && resp.status()
  } catch (e) {
    console.log(`\n### ${url}\nNAVIGATION FAILED: ${e.message.split('\n')[0]}`)
    await page.close()
    continue
  }
  // give document_idle scripts room to run
  await page.waitForTimeout(6000)
  const attrs = await page.evaluate(() => {
    const out = {}
    for (const a of document.documentElement.attributes) if (a.name.startsWith('data-watis-')) out[a.name] = a.value
    return out
  })
  console.log(`\n### ${url}  (HTTP ${status})`)
  console.log('extension-written DOM attributes:')
  for (const [k, v] of Object.entries(attrs)) console.log(`  ${k} = ${v.slice(0, 500)}`)
  if (!Object.keys(attrs).length) console.log('  (none — no content script wrote anything)')
  const relevant = logs.filter((l) => /WATIS|Content Security|Refused/i.test(l))
  console.log('relevant console lines:')
  if (!relevant.length) console.log('  (none)')
  for (const l of relevant.slice(0, 12)) console.log('  ' + l)
  await page.close()
}
await ctx.close()
