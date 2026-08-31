import { describe, expect, it } from 'vitest'
import { labelFor, toPickerSources } from '../../src/main/media/display-picker'

const source = (id: string, name: string, empty = false) =>
  ({
    id,
    name,
    thumbnail: { isEmpty: () => empty, toDataURL: () => 'data:image/png;base64,x' },
  }) as never

describe('toPickerSources', () => {
  it('puts screens before windows', () => {
    // Somebody sharing their screen nearly always wants a screen, not the thirtieth browser tab.
    const list = toPickerSources([
      source('window:1', 'Editor'),
      source('screen:0', 'Screen 1'),
      source('window:2', 'Browser'),
    ])
    expect(list.map((s) => s.kind)).toEqual(['screen', 'window', 'window'])
  })

  it('sorts windows by name in German collation', () => {
    const list = toPickerSources([source('window:1', 'Übersicht'), source('window:2', 'Ablage')])
    expect(list.map((s) => s.name)).toEqual(['Ablage', 'Übersicht'])
  })

  it('omits an empty thumbnail rather than shipping a blank image', () => {
    expect(
      toPickerSources([source('screen:0', 'Screen 1', true)])[0]?.thumbnailDataUrl,
    ).toBeUndefined()
  })

  it('carries the thumbnail through when there is one', () => {
    expect(toPickerSources([source('screen:0', 'Screen 1')])[0]?.thumbnailDataUrl).toMatch(/^data:/)
  })
})

describe('labelFor', () => {
  it('gives a screen a name a person can read', () => {
    expect(labelFor('Screen 1', 'screen')).toBe('Ganzer Bildschirm')
    expect(labelFor('', 'screen')).toBe('Ganzer Bildschirm')
  })

  it('keeps a meaningful screen name', () => {
    expect(labelFor('DELL U2723QE', 'screen')).toBe('DELL U2723QE')
  })

  it('names an unnamed window instead of showing nothing', () => {
    expect(labelFor('   ', 'window')).toBe('Unbenanntes Fenster')
  })
})
