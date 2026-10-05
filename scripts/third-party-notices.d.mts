import type { Plugin } from 'vite'

export interface NoticeExtra {
  name: string
  licence: string
  text?: string
}

export function packageOf(id: string): string | undefined
export function collectPackages(into: Set<string>): Plugin
export function mit(copyright: string): string
export function bsd3(copyright: string, owner?: string): string
export function writeNotices(options: {
  root: string
  file: string
  product: string
  packages: Iterable<string>
  extras?: NoticeExtra[]
}): void
export const TESSERACT_COMPONENTS: NoticeExtra[]
export const SQLITE: NoticeExtra
