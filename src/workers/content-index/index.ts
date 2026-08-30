import { connectToHost } from '../shared/host-channel'

/**
 * The content index worker: the index_jobs queue, OCR, PDF/DOCX text extraction and — on
 * demand only, per ADR 0001 — transcription.
 *
 * Phase 0 only proves the process model. The job queue arrives with phase 7.
 */
async function main(): Promise<void> {
  const host = await connectToHost({
    name: 'contentIndex',
    onShutdown: (reason) => {
      host.log('info', `shutting down: ${reason}`)
    },
  })
  host.log('info', 'content index worker started (queue idle — phase 7)')
}

void main()
