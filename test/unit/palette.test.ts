import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every `wa-` colour a component uses must actually exist.
 *
 * The interface looked flat and harsh for months, and the reason was not taste. The stylesheet
 * defined three tokens — panel, surface, accent — while the components used five. `wa-hairline`
 * appeared 52 times and `wa-muted` 50, and neither was declared. Tailwind emits nothing for a
 * colour it does not know, so every one of those borders fell back to currentColor, drawing bright
 * lines at text brightness, and every piece of "muted" secondary text rendered at full strength.
 * One brightness, hard edges, and nothing in the build said a word about it.
 *
 * A missing colour is invisible: it does not fail to compile, it does not warn, it just quietly
 * renders wrong. So it is checked here instead.
 */

const root = join(__dirname, '..', '..')
const css = readFileSync(join(root, 'src', 'renderer', 'src', 'index.css'), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** Token names declared for Tailwind, e.g. `--color-wa-hairline` -> `wa-hairline`. */
const declared = new Set(
  [...css.matchAll(/--color-(wa-[\w-]+):/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
)

/** Token names used in class strings, e.g. `border-wa-hairline`, `bg-wa-accent-soft/30`. */
const used = new Map<string, string[]>()
for (const file of sourceFiles(join(root, 'src', 'renderer', 'src'))) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(
    /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(wa-[\w-]+)/g,
  )) {
    const token = match[1]
    if (!token) continue
    used.set(token, [...(used.get(token) ?? []), file.slice(root.length + 1)])
  }
}

describe('the colour palette', () => {
  it('declares the tokens the interface actually uses', () => {
    // Guards the regexes: if either stops matching, the test would otherwise pass on empty sets.
    expect(declared.size).toBeGreaterThanOrEqual(8)
    expect(used.size).toBeGreaterThanOrEqual(5)
  })

  it.each([...used.keys()].sort())('%s is declared in index.css', (token) => {
    expect(
      declared.has(token),
      `${token} is used in ${(used.get(token) ?? []).length} place(s) — first in ` +
        `${used.get(token)?.[0] ?? '?'} — but index.css declares no --color-${token}. ` +
        `Tailwind emits nothing for an unknown colour, so this renders as currentColor or not ` +
        `at all, silently.`,
    ).toBe(true)
  })

  it('defines every token in both themes, so neither is half-painted', () => {
    // Anchored on the block openers, braces included, not on the bare names. @custom-variant
    // mentions [data-theme='dark'] further up and the header comment mentions @theme inline, and
    // either would slice the file in the wrong place — the first version of this test found an
    // empty light palette and reported every token missing.
    const lightStart = css.indexOf(':root {')
    const darkStart = css.indexOf("[data-theme='dark'] {")
    const themeStart = css.indexOf('@theme inline {')
    expect(lightStart).toBeGreaterThan(-1)
    expect(darkStart).toBeGreaterThan(lightStart)
    expect(themeStart).toBeGreaterThan(darkStart)
    const light = css.slice(lightStart, darkStart)
    const dark = css.slice(darkStart, themeStart)
    for (const token of declared) {
      const variable = `--${token}`
      expect(light, `${variable} is missing from the light palette`).toContain(`${variable}:`)
      expect(dark, `${variable} is missing from the dark palette`).toContain(`${variable}:`)
    }
  })
})
