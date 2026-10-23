// Orquestra a análise de um arquivo: amostra para detectar o formato (RF-10), leitura em
// streaming e análise. Não depende de DOM nem de Worker, então roda igual no Node (testes).

import { detectProfile, type Candidate } from '../core/detect.ts';
import { Analyzer, type AnalysisResult } from '../core/analyzer.ts';
import {
  buildCustomProfile,
  previewProfile,
  type CustomProfileSpec,
  type Preview,
} from '../core/custom-profile.ts';
import type { NormalizationMode, Profile, ProfileId } from '../core/types.ts';
import { readAlignedChunks, type BlobLike } from './reader.ts';

export const SAMPLE_BYTES = 1024 * 1024;
const MAX_SAMPLE_LINE_CHARS = 4096;

export interface AnalyzeOptions {
  blockSize: number;
  profile?: ProfileId;
  /** Especificação do perfil `custom`; quando presente, vale no lugar de `profile`. */
  custom?: CustomProfileSpec;
  mode?: NormalizationMode;
  onProgress?: (progress: { bytesRead: number; totalBytes: number; lines: number }) => void;
  isCancelled?: () => boolean;
  progressIntervalMs?: number;
  now?: () => number;
}

export type AnalyzeOutcome =
  | { kind: 'cancelled' }
  | { kind: 'needs-profile'; candidates: Candidate[] }
  | { kind: 'ready'; result: AnalysisResult; bytesRead: number; analyzer: Analyzer };

/** Lê o começo do arquivo e devolve as primeiras linhas não vazias, para detectar o formato. */
export async function readSample(blob: BlobLike, maxLines = 500): Promise<string[]> {
  const end = Math.min(blob.size, SAMPLE_BYTES);
  const buffer = new Uint8Array(await blob.slice(0, end).arrayBuffer());
  let text = new TextDecoder('utf-8').decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parts = text.split('\n');
  // Se o arquivo continua além da amostra, a última linha pode estar cortada: descarta.
  if (end < blob.size) parts.pop();
  const lines: string[] = [];
  for (const part of parts) {
    const line = part.endsWith('\r') ? part.slice(0, -1) : part;
    if (line.trim().length === 0) continue;
    lines.push(line.length > MAX_SAMPLE_LINE_CHARS ? line.slice(0, MAX_SAMPLE_LINE_CHARS) : line);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

export async function analyzeBlob(
  blob: BlobLike,
  options: AnalyzeOptions,
): Promise<AnalyzeOutcome> {
  const isCancelled = options.isCancelled ?? (() => false);
  const now = options.now ?? (() => Date.now());
  const interval = options.progressIntervalMs ?? 200;

  let profile = options.profile;
  let impl: Profile | undefined;
  if (options.custom) {
    const built = buildCustomProfile(options.custom);
    if (!built.ok) throw new TypeError(`Perfil personalizado inválido: ${built.problem}`);
    profile = 'custom';
    impl = built.profile;
  }
  let source: 'auto' | 'manual' = 'manual';
  let confidence: number | null = null;

  if (blob.size === 0) {
    const analyzer = new Analyzer({
      profile: profile ?? 'iso-level',
      profileImpl: impl,
      mode: options.mode,
    });
    return { kind: 'ready', result: analyzer.finish(), bytesRead: 0, analyzer };
  }

  if (!profile) {
    const detection = detectProfile(await readSample(blob));
    if (isCancelled()) return { kind: 'cancelled' };
    if (!detection.confident || detection.best === null) {
      return { kind: 'needs-profile', candidates: detection.candidates };
    }
    profile = detection.best;
    confidence = detection.candidates[0]?.score ?? null;
    source = 'auto';
  }

  const analyzer = new Analyzer({
    profile,
    profileImpl: impl,
    profileSource: source,
    confidence,
    mode: options.mode,
  });

  let lastProgress = now();
  let bytesRead = 0;
  for await (const chunk of readAlignedChunks(blob, options.blockSize, isCancelled)) {
    analyzer.feed(chunk.bytes, chunk.startOffset);
    bytesRead = chunk.endOffset;
    const t = now();
    if (options.onProgress && t - lastProgress >= interval) {
      lastProgress = t;
      options.onProgress({ bytesRead, totalBytes: blob.size, lines: analyzer.lines });
    }
  }

  if (isCancelled()) return { kind: 'cancelled' };
  return { kind: 'ready', result: analyzer.finish(), bytesRead, analyzer };
}

/** Testa um perfil personalizado nas primeiras linhas do arquivo (sem analisar o resto). */
export async function previewBlob(blob: BlobLike, spec: CustomProfileSpec): Promise<Preview> {
  const built = buildCustomProfile(spec);
  if (!built.ok) throw new TypeError(`Perfil personalizado inválido: ${built.problem}`);
  return previewProfile(built.profile, await readSample(blob));
}
