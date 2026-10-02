import { FileTranscriber } from '@transcribe/transcriber'
import { parseSettings } from '@shared/settings'
import config from '../whisper-models.json'
import { ext } from '../ext'
import { MODEL_DOWNLOAD_ORIGINS } from '../manifest'
import { SETTINGS_KEY } from '../protocol'
import { archive, readOpfs } from './api'
import { t } from './strings'

/**
 * Transcribing voice messages in the browser: whisper.cpp compiled to WASM, on demand, one message
 * at a time (ADR 0001 §4, ADR 0012).
 *
 * It runs in the panel, not in the archive worker, for two reasons the platform sets: decoding
 * Opus needs an AudioContext, which only a page has, and whisper.cpp's threads need
 * SharedArrayBuffer, which needs a cross-origin isolated page — the panel is one, by the manifest.
 *
 * The model is not in the package. It is downloaded once, on a click, from the project's own
 * GitHub release (ADR 0001 C: mirrored there rather than taken from a personal Hugging Face
 * account), checked against its SHA-256, and kept in the extension's OPFS under `models/`. Where
 * GitHub is out of reach — a company proxy, say — the same file can be picked from disk instead;
 * it is held to the same checksum.
 */

export type ModelKey = keyof typeof config.models
export const MODELS = config.models
export const DEFAULT_MODEL = config.default as ModelKey

const MODEL_DIR = 'models'
/** A loaded model stays in memory this long after its last use, so a run of messages loads it once. */
const KEEP_LOADED_MS = 120_000

/**
 * Whether this page can run whisper.cpp at all: its threads share memory, and browsers only allow
 * that in a cross-origin isolated page.
 */
export function transcriptionSupported(): boolean {
  return globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function'
}

async function modelDir(create = false): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(MODEL_DIR, { create })
  } catch {
    return undefined
  }
}

/** Which models are on this machine, by key. A partial download does not count. */
export async function installedModels(): Promise<ModelKey[]> {
  const dir = await modelDir()
  if (!dir) return []
  const installed: ModelKey[] = []
  for (const key of Object.keys(MODELS) as ModelKey[]) {
    try {
      const file = await (await dir.getFileHandle(MODELS[key].file)).getFile()
      if (file.size === MODELS[key].bytes) installed.push(key)
    } catch {
      // not there
    }
  }
  return installed
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Gives a checked `.part` file its real name. A model that is truncated or not the one we pinned
 * never reaches the transcriber.
 */
async function promote(dir: FileSystemDirectoryHandle, key: ModelKey): Promise<void> {
  const model = MODELS[key]
  const partName = `${model.file}.part`
  const file = await (await dir.getFileHandle(partName)).getFile()
  if (file.size !== model.bytes || (await sha256(file)) !== model.sha256) {
    await dir.removeEntry(partName)
    throw new Error(t('transcription.error.checksum'))
  }
  const target = await dir.getFileHandle(model.file, { create: true })
  const out = await target.createWritable()
  await out.write(file)
  await out.close()
  await dir.removeEntry(partName)
}

/** Downloads a model into OPFS, reporting progress 0..1, and checks it before it counts. */
export async function downloadModel(
  key: ModelKey,
  onProgress: (fraction: number) => void,
): Promise<void> {
  // Asked for at the click, not at install: only somebody who wants transcription grants the
  // extension a connection to GitHub's download hosts (CLAUDE.md: network only after an
  // explicit user action, for model downloads).
  const granted = await ext.permissions.request({ origins: MODEL_DOWNLOAD_ORIGINS })
  if (!granted) throw new Error(t('transcription.error.permission'))

  const model = MODELS[key]
  const response = await fetch(`${config.release}/${model.file}`)
  if (!response.ok || !response.body) {
    throw new Error(t('transcription.error.download', { status: response.status }))
  }

  const dir = await modelDir(true)
  if (!dir) throw new Error(t('transcription.error.storage'))
  const partial = await dir.getFileHandle(`${model.file}.part`, { create: true })
  const writable = await partial.createWritable()
  let received = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await writable.write(value)
      received += value.length
      onProgress(Math.min(1, received / model.bytes))
    }
    await writable.close()
  } catch (error) {
    await writable.abort()
    throw error
  }
  await promote(dir, key)
}

/**
 * Takes a model file somebody already has — from IT, or downloaded on another machine. Which model
 * it is follows from its size; whether it really is that model, from its checksum.
 */
export async function importModel(file: File): Promise<ModelKey> {
  const key = (Object.keys(MODELS) as ModelKey[]).find((k) => MODELS[k].bytes === file.size)
  if (!key) throw new Error(t('transcription.error.unknownFile'))
  const dir = await modelDir(true)
  if (!dir) throw new Error(t('transcription.error.storage'))
  const partial = await dir.getFileHandle(`${MODELS[key].file}.part`, { create: true })
  const writable = await partial.createWritable()
  await writable.write(file)
  await writable.close()
  await promote(dir, key)
  return key
}

export async function deleteModel(key: ModelKey): Promise<void> {
  if (loaded?.key === key) unload()
  const dir = await modelDir()
  await dir?.removeEntry(MODELS[key].file).catch(() => undefined)
}

// --- running whisper.cpp ------------------------------------------------------------------------

type CreateModule = (arg?: object) => Promise<unknown>

let shout: Promise<CreateModule> | undefined

/**
 * whisper.cpp's Emscripten glue, loaded from the package as a module of its own rather than
 * bundled: its threads start workers from `new URL("shout.wasm.js", import.meta.url)`, and that
 * only resolves to the right file when the module keeps its own URL. A bundled copy would make
 * Emscripten fall back to a blob: worker, which the extension's CSP forbids.
 */
function loadShout(): Promise<CreateModule> {
  shout ??= import(/* @vite-ignore */ ext.runtime.getURL('whisper/shout.wasm.js')).then(
    (module: { default: CreateModule }) => module.default,
  )
  return shout
}

let loaded:
  { key: ModelKey; transcriber: FileTranscriber; ready: Promise<void>; idle?: number } | undefined

function unload(): void {
  if (!loaded) return
  window.clearTimeout(loaded.idle)
  loaded.transcriber.destroy()
  loaded = undefined
}

async function transcriberFor(
  key: ModelKey,
  onProgress: (percent: number) => void,
): Promise<FileTranscriber> {
  if (loaded?.key !== key) {
    unload()
    const transcriber = new FileTranscriber({
      createModule: await loadShout(),
      model: await readOpfs(`${MODEL_DIR}/${MODELS[key].file}`),
      print: () => undefined,
      printErr: () => undefined,
    })
    loaded = { key, transcriber, ready: transcriber.init() }
  }
  const current = loaded
  window.clearTimeout(current.idle)
  try {
    await current.ready
  } catch (error) {
    unload()
    throw error
  }
  current.transcriber.onProgress = onProgress
  return current.transcriber
}

function releaseLater(): void {
  if (!loaded) return
  window.clearTimeout(loaded.idle)
  loaded.idle = window.setTimeout(unload, KEEP_LOADED_MS)
}

/** One message at a time: a second click waits for the first instead of doubling the memory. */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Transcribes one voice message from the archive and stores the result there, where the search
 * finds it like any other text. Progress is reported 0..100 by whisper.cpp itself.
 */
export function transcribe(
  mediaId: string,
  audioPath: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  const run = queue.then(() => transcribeNow(mediaId, audioPath, onProgress))
  queue = run.catch(() => undefined)
  return run
}

async function transcribeNow(
  mediaId: string,
  audioPath: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  if (!transcriptionSupported()) {
    throw new Error(t('transcription.unsupported'))
  }
  const installed = await installedModels()
  const key = installed.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : installed[0]
  if (!key) throw new Error(t('transcription.needModel'))

  const stored = await ext.storage.local.get(SETTINGS_KEY)
  const lang = parseSettings(stored[SETTINGS_KEY]).transcriptionLanguage
  const audio = await readOpfs(audioPath)
  const transcriber = await transcriberFor(key, onProgress)
  try {
    // Leaves a core for the browser itself: WhatsApp keeps running beside this.
    const threads = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1))
    let result: Awaited<ReturnType<FileTranscriber['transcribe']>>
    try {
      result = await transcriber.transcribe(
        new File([audio], 'sprachnachricht', { type: audio.type }),
        { lang, threads, suppress_non_speech: true, token_timestamps: false },
      )
    } catch {
      // The library swallows a decoding failure and hands whisper.cpp nothing; that is the only
      // way a transcription fails here on its own.
      throw new Error(t('transcription.error.audio'))
    }
    const lines = result.transcription
      .map((segment) => ({
        text: segment.text.trim(),
        startSeconds: segment.offsets.from / 1000,
        endSeconds: segment.offsets.to / 1000,
      }))
      .filter((line) => line.text !== '' && !/^\[.*\]$/.test(line.text))
    const text = lines.map((line) => line.text).join('\n')
    await archive({
      op: 'storeTranscript',
      mediaId,
      text,
      lines,
      engine: 'whisper.cpp',
      engineVersion: `${key}-${MODELS[key].sha256.slice(0, 8)}`,
      lang: result.result.language,
    })
    return text
  } finally {
    releaseLater()
  }
}
