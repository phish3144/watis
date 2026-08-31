export interface MeasuredArtefact {
  sha512: string
  size: number
}

export interface LatestYmlEntry {
  url: string
  sha512: string
  size: number
}

export interface LatestYml {
  version?: string
  files?: LatestYmlEntry[]
  path?: string
  sha512?: string
  releaseDate?: string
}

export declare function applyMeasuredHashes(
  latest: unknown,
  measured: Map<string, MeasuredArtefact>,
): { latest: LatestYml; updated: string[]; missing: string[] }

export declare function artefactsWithBlockmap(presentFiles: string[]): string[]
