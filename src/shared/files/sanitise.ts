/**
 * Filename and path sanitising, shared by downloads, the blob store, export — and the browser
 * extension, which names downloads by the same rules (ADR 0010).
 *
 * Written here rather than taken from a package because neither candidate covers the full set:
 * `filenamify` normalises Unicode and strips bidi-override characters but truncates by UTF-16
 * code units (not the 255 BYTES that APFS enforces) and is ESM-only; `sanitize-filename`
 * truncates by bytes but ignores bidi and does not normalise. The rules below are small enough
 * to own, and they are covered by tests.
 *
 * No Node imports: the byte arithmetic goes through TextEncoder, and `extname` is Node's own
 * algorithm restated, so the same file runs in a utilityProcess and in a browser.
 */

// Illegal on Windows, plus the C0 range and DEL. The control characters are the point of the
// rule, so the lint rule that warns about them is disabled deliberately.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g

// Bidirectional and other format characters. These are the filename-spoofing vector: a right-to
// left override can make "exe.txt" render as "txt.exe".
const FORMAT_CHARS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

// CON, PRN, AUX, NUL, COM0-9, LPT0-9, and the console device aliases, with or without extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)(\..*)?$/i

/** Windows MAX_PATH. Node does not add the \\?\ prefix for ordinary writes, so it really binds. */
export const MAX_PATH_LENGTH = 240
const MAX_COMPONENT_BYTES = 255

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function byteLength(value: string): number {
  return encoder.encode(value).length
}

/** Truncates to a byte budget without splitting a multi-byte character or a surrogate pair. */
export function truncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value
  let text = decoder.decode(encoder.encode(value).subarray(0, maxBytes))
  // A cut multi-byte sequence decodes to U+FFFD; drop it rather than ship a replacement char.
  if (text.endsWith('\ufffd')) text = text.slice(0, -1)
  // Never end on a lone high surrogate.
  const last = text.charCodeAt(text.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
  return text
}

export interface SanitiseOptions {
  /** Reserved for the extension and any collision suffix. */
  maxBytes?: number
  fallback?: string
}

/** Makes one path COMPONENT safe on Windows and macOS. Never returns an empty string. */
export function sanitiseComponent(input: string, options: SanitiseOptions = {}): string {
  const maxBytes = options.maxBytes ?? MAX_COMPONENT_BYTES
  const fallback = options.fallback ?? 'Unbenannt'

  let value = input
    .normalize('NFC')
    .replace(FORMAT_CHARS, '')
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .trim()

  // Windows silently strips trailing dots and spaces, which turns "a." into "a" behind your back
  // and breaks collision detection. Do it explicitly instead.
  value = value.replace(/[. ]+$/, '')

  // A leading dot hides the file on macOS and Linux.
  value = value.replace(/^\.+/, '')

  if (RESERVED.test(value)) value = `_${value}`
  if (!value) value = fallback

  return truncateToBytes(value, maxBytes) || fallback
}

/** Splits into stem and extension so truncation never eats the extension. */
export function sanitiseFilename(input: string, options: SanitiseOptions = {}): string {
  const maxBytes = options.maxBytes ?? MAX_COMPONENT_BYTES
  const raw = input.normalize('NFC')
  const extension = extname(raw).slice(0, 24)
  const stem = extension ? raw.slice(0, raw.length - extension.length) : raw

  const safeExtension = extension.replace(FORBIDDEN, '').replace(FORMAT_CHARS, '')
  const budget = Math.max(1, maxBytes - byteLength(safeExtension))
  const safeStem = sanitiseComponent(stem, { ...options, maxBytes: budget })

  return `${safeStem}${safeExtension}`
}

/**
 * `path.extname`, without `node:path`. Node's algorithm, kept exactly: a leading dot is not an
 * extension (".bashrc"), and ".." has none. Both separators end the name, because the desktop
 * release runs on Windows, where a backslash is one.
 */
export function extname(path: string): string {
  let startDot = -1
  let startPart = 0
  let end = -1
  let matchedSlash = true
  let preDotState = 0
  for (let i = path.length - 1; i >= 0; --i) {
    const char = path.charAt(i)
    if (char === '/' || char === '\\') {
      if (!matchedSlash) {
        startPart = i + 1
        break
      }
      continue
    }
    if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
    if (char === '.') {
      if (startDot === -1) startDot = i
      else if (preDotState !== 1) preDotState = 1
    } else if (startDot !== -1) {
      preDotState = -1
    }
  }
  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return ''
  }
  return path.slice(startDot, end)
}

/** `YYYY-MM-DD`, in local time — the prefix every download gets. */
export function dateStamp(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
