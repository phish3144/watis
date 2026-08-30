import { chromium } from '@playwright/test'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1200, height: 1000 } })
  await page.goto('file://' + process.cwd() + '/site/index.html')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `/tmp/lp-${scheme}.png`, fullPage: true })
  const info = await page.evaluate(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    h1: getComputedStyle(document.querySelector('.thesis')).color,
    btnBg: getComputedStyle(document.querySelector('.btn')).backgroundColor,
    btnFg: getComputedStyle(document.querySelector('.btn')).color,
    font: getComputedStyle(document.querySelector('.thesis')).fontFamily,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
  console.log(scheme, JSON.stringify(info))
}
await browser.close()
