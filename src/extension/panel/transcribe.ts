import { ext, isFirefox } from '../ext'
import { MODEL_DOWNLOAD_ORIGINS } from '../manifest'
import {
  canRunHere,
  MODEL_RELEASE,
  MODELS,
  modelDir,
  transcribeHere,
  unload,
  type ModelKey,
} from '../whisper'
import { archive, transcribeInTab } from './api'
import { t } from './strings'

export { DEFAULT_MODEL, installedModels, MODELS, type ModelKey } from '../whisper'

/**
 * Voice messages, from the panel's side (ADR 0012): getting a speech model onto this machine, and
 * starting a transcription where the browser can run one.
 *
 * The model is not in the package. It is downloaded once, on a click, from the project's own
 * GitHub release (ADR 0001 C: mirrored there rather than taken from a personal Hugging Face
 * account), checked against its SHA-256, and kept in the extension's OPFS under `models/`. Where
 * GitHub is out of reach — a company proxy, say — the same file can be picked from disk instead;
 * it is held to the same checksum.
 */

/** Whether voice messages can be transcribed in this browser at all. */
export function transcriptionSupported(): boolean {
  return canRunHere() || isFirefox
}

/** Firefox runs whisper.cpp in the WhatsApp tab, which therefore has to be open. */
export function transcriptionNeedsTab(): boolean {
  return !canRunHere() && isFirefox
}

/**
 * Transcribes one voice message and stores the text in the archive, where the search finds it.
 * Progress is reported 0..100 where whisper.cpp runs in this page; from the tab there is none.
 */
export function transcribe(
  mediaId: string,
  audioPath: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  if (canRunHere()) {
    return transcribeHere(mediaId, audioPath, onProgress, async (transcript) => {
      await archive({ ...transcript })
    })
  }
  if (isFirefox) return transcribeInTab(mediaId, audioPath)
  return Promise.reject(new Error(t('transcription.unsupported')))
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
  const response = await fetch(`${MODEL_RELEASE}/${model.file}`)
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
  unload(key)
  const dir = await modelDir()
  await dir?.removeEntry(MODELS[key].file).catch(() => undefined)
}
