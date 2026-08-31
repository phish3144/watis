#!/usr/bin/env node
// Renders the fixture set from PLAN.md §8: a screenshot, an invoice, a whiteboard photo and a
// skewed phone photo. Rendered with a real font rather than hand-drawn, so the tests exercise
// recognition rather than a synthetic bitmap.
//
// Every fixture is invented — no real message, number or screenshot ever enters this repository
// (CLAUDE.md). The point of the set is coverage of the ways text arrives in a chat, not realism
// for its own sake:
//
//   screenshot  crisp UI text, dark background — the easy case, and the most common one
//   invoice     dense small type with numbers and umlauts — where confidence starts to drop
//   whiteboard  handwriting-like on a photographed surface, at an angle, unevenly lit
//   skewed      a document photographed off-axis, which is what a phone camera actually produces

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const OUT_DIR = process.argv[2] ?? 'test/fixtures'
await mkdir(OUT_DIR, { recursive: true })

const BASE = `body{margin:0;font-family:"DejaVu Sans",sans-serif}`

const FIXTURES = [
  {
    name: 'ocr-screenshot.png',
    viewport: { width: 720, height: 420 },
    html: `<style>${BASE}
      body{background:#111b21;color:#e9edef;padding:28px;font-size:19px;line-height:1.7}
      .in,.out{max-width:70%;padding:10px 14px;border-radius:10px;margin:8px 0}
      .in{background:#202c33}
      .out{background:#005c4b;margin-left:auto}
      .t{font-size:12px;opacity:.6;text-align:right}</style>
      <div class="in">Kannst du mir die Rechnung nochmal schicken?<div class="t">14:02</div></div>
      <div class="out">Klar, kommt gleich. Betrag war 1.249,90 Euro.<div class="t">14:03</div></div>
      <div class="in">Danke! Und die Lieferung ging nach München?<div class="t">14:05</div></div>`,
  },
  {
    name: 'ocr-rechnung-dicht.png',
    viewport: { width: 820, height: 560 },
    html: `<style>${BASE}
      body{background:#fff;color:#000;padding:32px;font-size:13px;line-height:1.5}
      h1{font-size:18px;margin:0 0 4px}
      table{border-collapse:collapse;width:100%;margin-top:14px}
      td,th{border-bottom:1px solid #ccc;padding:5px 8px;text-align:left}
      td.n{text-align:right;font-variant-numeric:tabular-nums}</style>
      <h1>Küchenmöbel Müller GmbH</h1>
      <div>Straßenweg 12 · 80331 München · USt-IdNr. DE123456789</div>
      <div style="margin-top:10px">Rechnung Nr. 2026-0815 vom 14.02.2026</div>
      <table>
        <tr><th>Pos</th><th>Bezeichnung</th><th>Menge</th><th>Einzelpreis</th><th>Gesamt</th></tr>
        <tr><td>1</td><td>Arbeitsplatte Eiche geölt</td><td>2</td><td class="n">349,00</td><td class="n">698,00</td></tr>
        <tr><td>2</td><td>Unterschrank 60 cm weiß</td><td>3</td><td class="n">129,50</td><td class="n">388,50</td></tr>
        <tr><td>3</td><td>Griffleiste Edelstahl</td><td>6</td><td class="n">18,90</td><td class="n">113,40</td></tr>
        <tr><td colspan="4">Zwischensumme</td><td class="n">1.199,90</td></tr>
        <tr><td colspan="4">Versand</td><td class="n">50,00</td></tr>
        <tr><td colspan="4"><b>Gesamtbetrag</b></td><td class="n"><b>1.249,90</b></td></tr>
      </table>
      <div style="margin-top:14px">Zahlbar bis 28.02.2026 ohne Abzug. Grüße aus München.</div>`,
  },
  {
    name: 'ocr-whiteboard.png',
    viewport: { width: 760, height: 480 },
    // A photographed whiteboard: off-white, slightly rotated, a shadow across one corner.
    html: `<style>${BASE}
      body{background:#8a8f8c;padding:0;overflow:hidden}
      .board{background:#f2f3ef;width:700px;height:430px;margin:24px auto;
             transform:rotate(-1.6deg);box-shadow:0 8px 30px rgba(0,0,0,.4);
             padding:30px;font-size:26px;line-height:1.9;color:#1b3a5c;
             background-image:linear-gradient(115deg,rgba(0,0,0,.14),rgba(0,0,0,0) 45%)}
      .h{font-size:32px;font-weight:700;margin-bottom:14px}</style>
      <div class="board">
        <div class="h">Sprint 14 — Offen</div>
        <div>• Angebot Dachdecker prüfen</div>
        <div>• Termin mit Frau Schäfer</div>
        <div>• Lieferung München bestätigen</div>
        <div>• Rückfrage Vertrag bis Freitag</div>
      </div>`,
  },
  {
    name: 'ocr-schraeg.png',
    viewport: { width: 800, height: 560 },
    // A document photographed off-axis: perspective, warm light, soft edges. This is what a phone
    // camera actually hands over, and it is where recognition gets genuinely hard.
    html: `<style>${BASE}
      body{background:#3a332c;padding:0;overflow:hidden;perspective:900px}
      .page{background:#fbf7ef;width:620px;height:420px;margin:60px auto;padding:34px;
            font-size:22px;line-height:1.8;color:#111;
            transform:rotateY(-19deg) rotateZ(2.4deg) rotateX(6deg);
            box-shadow:0 16px 44px rgba(0,0,0,.55);
            background-image:linear-gradient(100deg,rgba(255,214,150,.35),rgba(255,255,255,0) 60%)}
      .h{font-size:27px;font-weight:700;margin-bottom:12px}</style>
      <div class="page">
        <div class="h">Übergabeprotokoll</div>
        <div>Objekt: Straßenweg 12, München</div>
        <div>Datum: 14.02.2026</div>
        <div>Zählerstand: 48291</div>
        <div>Schlüssel: 3 Stück übergeben</div>
      </div>`,
  },
]

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})

for (const fixture of FIXTURES) {
  const page = await browser.newPage({ viewport: fixture.viewport })
  await page.setContent(fixture.html)
  await page.screenshot({ path: `${OUT_DIR}/${fixture.name}` })
  await page.close()
  console.log(`wrote ${OUT_DIR}/${fixture.name}`)
}

await browser.close()
