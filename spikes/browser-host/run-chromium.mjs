import { chromium } from '../../node_modules/playwright/index.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assemble } from './assemble.mjs'

const EXT = assemble('chromium')
const proxy = process.env.HTTPS_PROXY
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'p-')), {
  headless: false,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ...(proxy ? { proxy: { server: proxy } } : {}),
  args: [
    '--no-sandbox',
    '--ssl-version-max=tls1.2',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
})
const page = await ctx.newPage()
page.on('console', (m) => console.log('console:', m.type(), m.text()))
await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page
  .waitForFunction(() => document.documentElement.hasAttribute('data-probe-background'), null, {
    timeout: 60000,
  })
  .catch(() => {})
await page.waitForTimeout(3000)
const attrs = await page.evaluate(() =>
  Object.fromEntries(
    [...document.documentElement.attributes]
      .filter((a) => a.name.startsWith('data-probe'))
      .map((a) => [a.name, a.value]),
  ),
)
console.log('PAGE', JSON.stringify(attrs, null, 2))
const checkUrl = attrs['data-probe-check-url']
if (checkUrl) {
  const q = await ctx.newPage()
  await q.goto(checkUrl)
  await q.waitForFunction(() => document.title === 'done', null, { timeout: 15000 }).catch(() => {})
  console.log('CHECK', await q.evaluate(() => document.documentElement.getAttribute('data-check')))
}
await ctx.close()
