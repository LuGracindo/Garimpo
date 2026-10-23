// Protocolo UI <-> Worker (SDD 5.4). Ambos os lados validam o que recebem.
// Regra SEG-19: mensagens de erro nunca carregam trechos do arquivo.

import type { AnalysisResult } from '../core/analyzer.ts';
import type { ContextLine } from '../core/context.ts';
import type { FingerprintInfo } from '../core/laudo.ts';
import { isCustomSpec, type CustomProfileSpec, type Preview } from '../core/custom-profile.ts';
import { isFilter, type Filter } from '../core/filter.ts';
import { LACRE_TYPES, isLacreType, type LacreType } from '../core/lacre.ts';
import type { Histogram } from '../core/histogram.ts';
import {
  NORMALIZATION_MODES,
  PROFILE_IDS,
  SEVERITIES,
  type NormalizationMode,
  type ProfileId,
  type Severity,
} from '../core/types.ts';

export const PROTOCOL_VERSION = 1;

export const MIN_BLOCK_SIZE = 64 * 1024;
export const MAX_BLOCK_SIZE = 64 * 1024 * 1024;
export const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024;

export interface OpenOptions {
  blockSize: number;
  /** Perfil escolhido pela pessoa. Sem ele, o Worker detecta o formato (RF-10). */
  profile?: ProfileId;
  /** Perfil montado pela pessoa; vale no lugar de `profile` (que fica `custom`). */
  custom?: CustomProfileSpec;
  mode?: NormalizationMode;
}

export interface ProfileCandidate {
  profile: ProfileId;
  score: number;
}

export const MAX_OCCURRENCES_PER_PAGE = 500;
export const MAX_CONTEXT_LINES = 50;

interface Envelope {
  requestId: number;
  protocolVersion: typeof PROTOCOL_VERSION;
}

export interface OccurrenceRowMessage {
  event: number;
  timeMs: number | null;
  severity: Severity;
  nuggetId: number;
  offset: number;
  text: string;
}

export type UiToWorker =
  | ({ type: 'query'; filter: Filter } & Envelope)
  | ({ type: 'histogram'; filter: Filter } & Envelope)
  | ({ type: 'occurrences'; filter: Filter; start: number; count: number } & Envelope)
  | ({ type: 'context'; event: number; before: number; after: number } & Envelope)
  | ({ type: 'preview-profile'; file: Blob; spec: CustomProfileSpec } & Envelope)
  | ({ type: 'fingerprint' } & Envelope)
  | ({ type: 'lacre-scan'; types: LacreType[] } & Envelope)
  | {
      type: 'open';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      file: Blob;
      options: OpenOptions;
    }
  | { type: 'cancel'; requestId: number; protocolVersion: typeof PROTOCOL_VERSION };

export type ErrorCode =
  | 'GAR-PRO-001'
  | 'GAR-IO-001'
  | 'GAR-BIN-001'
  | 'GAR-LIM-001'
  | 'GAR-MEM-001'
  | 'GAR-RGX-001'
  | 'GAR-RGX-002';

/** Teto de tamanho de arquivo aceito (SDD: teto absoluto de 2 GB). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export type WorkerToUi =
  | {
      type: 'progress';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      bytesRead: number;
      totalBytes: number;
      lines: number;
    }
  | {
      type: 'ready';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      bytesRead: number;
      lines: number;
      maxLineBytes: number;
      elapsedMs: number;
      analysis: AnalysisResult;
    }
  | {
      type: 'needs-profile';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      candidates: ProfileCandidate[];
    }
  | ({ type: 'query-result'; total: number; nuggetCounts: [number, number][] } & Envelope)
  | ({ type: 'histogram-result'; histogram: Histogram } & Envelope)
  | ({
      type: 'occurrences-result';
      total: number;
      start: number;
      rows: OccurrenceRowMessage[];
    } & Envelope)
  | ({ type: 'context-result'; lines: ContextLine[] } & Envelope)
  | ({ type: 'preview-result'; preview: Preview } & Envelope)
  | ({ type: 'fingerprint-result'; fingerprint: FingerprintInfo } & Envelope)
  | ({
      type: 'lacre-scan-result';
      counts: Record<string, number>;
      samples: { type: LacreType; antes: string; depois: string }[];
    } & Envelope)
  | { type: 'cancelled'; requestId: number; protocolVersion: typeof PROTOCOL_VERSION }
  | {
      type: 'error';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      code: ErrorCode;
      message: string;
      details: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isUiToWorker(value: unknown): value is UiToWorker {
  if (!isRecord(value)) return false;
  if (value['protocolVersion'] !== PROTOCOL_VERSION) return false;
  if (!isSafeInt(value['requestId'])) return false;

  if (value['type'] === 'cancel') return true;

  if (value['type'] === 'query' || value['type'] === 'histogram') return isFilter(value['filter']);

  if (value['type'] === 'occurrences') {
    const count = value['count'];
    return (
      isFilter(value['filter']) &&
      isSafeInt(value['start']) &&
      isSafeInt(count) &&
      count >= 1 &&
      count <= MAX_OCCURRENCES_PER_PAGE
    );
  }

  if (value['type'] === 'context') {
    const before = value['before'];
    const after = value['after'];
    return (
      isSafeInt(value['event']) &&
      isSafeInt(before) &&
      before <= MAX_CONTEXT_LINES &&
      isSafeInt(after) &&
      after <= MAX_CONTEXT_LINES
    );
  }

  if (value['type'] === 'fingerprint') return true;

  if (value['type'] === 'lacre-scan') {
    const types = value['types'];
    return Array.isArray(types) && types.length <= LACRE_TYPES.length && types.every(isLacreType);
  }

  if (value['type'] === 'preview-profile') {
    return (
      typeof Blob !== 'undefined' && value['file'] instanceof Blob && isCustomSpec(value['spec'])
    );
  }

  if (value['type'] === 'open') {
    if (typeof Blob === 'undefined' || !(value['file'] instanceof Blob)) return false;
    const options = value['options'];
    if (!isRecord(options)) return false;
    const blockSize = options['blockSize'];
    if (!(isSafeInt(blockSize) && blockSize >= MIN_BLOCK_SIZE && blockSize <= MAX_BLOCK_SIZE)) {
      return false;
    }
    const profile = options['profile'];
    if (profile !== undefined && !isProfileId(profile)) return false;
    const custom = options['custom'];
    if (custom !== undefined && !isCustomSpec(custom)) return false;
    const mode = options['mode'];
    if (mode !== undefined && !isMode(mode)) return false;
    return true;
  }
  return false;
}

function isProfileId(value: unknown): value is ProfileId {
  return (
    typeof value === 'string' &&
    (value === 'custom' || (PROFILE_IDS as readonly string[]).includes(value))
  );
}

function isMode(value: unknown): value is NormalizationMode {
  return typeof value === 'string' && (NORMALIZATION_MODES as readonly string[]).includes(value);
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isSeverity(value: unknown): boolean {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

function isMarker(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['marker'] === 'string' &&
    isSafeInt(value['distinct']) &&
    typeof value['capped'] === 'boolean' &&
    Array.isArray(value['examples']) &&
    value['examples'].every((example) => typeof example === 'string')
  );
}

function isNugget(value: unknown): boolean {
  return (
    isRecord(value) &&
    isSafeInt(value['id']) &&
    typeof value['shortId'] === 'string' &&
    typeof value['template'] === 'string' &&
    typeof value['headTemplate'] === 'string' &&
    typeof value['hasStack'] === 'boolean' &&
    isSafeInt(value['count']) &&
    isSeverity(value['dominant']) &&
    isNumberOrNull(value['firstTimeMs']) &&
    isNumberOrNull(value['lastTimeMs']) &&
    typeof value['isNew'] === 'boolean' &&
    typeof value['priority'] === 'number' &&
    Array.isArray(value['sampleOffsets']) &&
    Array.isArray(value['markers']) &&
    value['markers'].every(isMarker)
  );
}

/** Valida o resultado da análise antes de a interface o mostrar (SEG-08). */
export function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isRecord(value)) return false;
  const summary = value['summary'];
  if (!isRecord(summary)) return false;
  const profile = summary['profile'];
  if (profile !== null && !isProfileId(profile)) return false;
  if (!isMode(summary['mode'])) return false;
  const numbers = [
    'bytes',
    'lines',
    'blankLines',
    'headerLines',
    'unparsed',
    'events',
    'outOfOrder',
    'truncatedEvents',
    'maxLineBytes',
    'nuggetCount',
  ];
  if (!numbers.every((key) => isSafeInt(summary[key]))) return false;
  if (!isNumberOrNull(summary['confidence'])) return false;
  if (!isNumberOrNull(summary['firstTimeMs']) || !isNumberOrNull(summary['lastTimeMs'])) {
    return false;
  }
  if (typeof summary['overflow'] !== 'boolean') return false;
  if (!isRecord(summary['severityCounts'])) return false;
  const nuggets = value['nuggets'];
  return Array.isArray(nuggets) && nuggets.every(isNugget);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isHistogram(value: unknown): value is Histogram {
  if (!isRecord(value)) return false;
  const counts = value['counts'];
  return (
    (value['axis'] === 'time' || value['axis'] === 'order') &&
    typeof value['start'] === 'number' &&
    typeof value['bucketSize'] === 'number' &&
    isSafeInt(value['buckets']) &&
    isSafeInt(value['untimed']) &&
    isSafeInt(value['total']) &&
    Array.isArray(counts) &&
    counts.length === SEVERITIES.length &&
    counts.every((row) => isNumberArray(row) && row.length === value['buckets'])
  );
}

function isOccurrenceRow(value: unknown): value is OccurrenceRowMessage {
  return (
    isRecord(value) &&
    isSafeInt(value['event']) &&
    isNumberOrNull(value['timeMs']) &&
    isSeverity(value['severity']) &&
    isSafeInt(value['nuggetId']) &&
    isSafeInt(value['offset']) &&
    typeof value['text'] === 'string'
  );
}

function isContextLine(value: unknown): value is ContextLine {
  return (
    isRecord(value) &&
    (value['kind'] === 'before' || value['kind'] === 'event' || value['kind'] === 'after') &&
    typeof value['text'] === 'string' &&
    typeof value['cut'] === 'boolean'
  );
}

function isPreview(value: unknown): value is Preview {
  if (!isRecord(value)) return false;
  const samples = value['samples'];
  return (
    isSafeInt(value['tested']) &&
    isSafeInt(value['matched']) &&
    isSafeInt(value['withTime']) &&
    isSafeInt(value['withLevel']) &&
    Array.isArray(samples) &&
    samples.length <= 12 &&
    samples.every(
      (sample) =>
        isRecord(sample) &&
        typeof sample['line'] === 'string' &&
        typeof sample['matched'] === 'boolean' &&
        (sample['timeMs'] === null || typeof sample['timeMs'] === 'number') &&
        (sample['level'] === null || SEVERITIES.includes(sample['level'] as Severity)) &&
        typeof sample['message'] === 'string',
    )
  );
}

const WORKER_TYPES = new Set([
  'progress',
  'ready',
  'needs-profile',
  'query-result',
  'histogram-result',
  'occurrences-result',
  'context-result',
  'preview-result',
  'fingerprint-result',
  'lacre-scan-result',
  'cancelled',
  'error',
]);

export function isWorkerToUi(value: unknown): value is WorkerToUi {
  if (!isRecord(value)) return false;
  if (value['protocolVersion'] !== PROTOCOL_VERSION) return false;
  if (!isSafeInt(value['requestId'])) return false;
  const type = value['type'];
  if (typeof type !== 'string' || !WORKER_TYPES.has(type)) return false;

  switch (type) {
    case 'progress':
      return (
        isSafeInt(value['bytesRead']) && isSafeInt(value['totalBytes']) && isSafeInt(value['lines'])
      );
    case 'ready':
      return (
        isSafeInt(value['bytesRead']) &&
        isSafeInt(value['lines']) &&
        isSafeInt(value['maxLineBytes']) &&
        typeof value['elapsedMs'] === 'number' &&
        isAnalysisResult(value['analysis'])
      );
    case 'needs-profile': {
      const candidates = value['candidates'];
      return (
        Array.isArray(candidates) &&
        candidates.every(
          (candidate) =>
            isRecord(candidate) &&
            isProfileId(candidate['profile']) &&
            typeof candidate['score'] === 'number',
        )
      );
    }
    case 'query-result': {
      const counts = value['nuggetCounts'];
      return (
        isSafeInt(value['total']) &&
        Array.isArray(counts) &&
        counts.every(
          (pair) =>
            Array.isArray(pair) && pair.length === 2 && isSafeInt(pair[0]) && isSafeInt(pair[1]),
        )
      );
    }
    case 'histogram-result':
      return isHistogram(value['histogram']);
    case 'occurrences-result': {
      const rows = value['rows'];
      return (
        isSafeInt(value['total']) &&
        isSafeInt(value['start']) &&
        Array.isArray(rows) &&
        rows.length <= MAX_OCCURRENCES_PER_PAGE &&
        rows.every(isOccurrenceRow)
      );
    }
    case 'context-result': {
      const lines = value['lines'];
      return (
        Array.isArray(lines) &&
        lines.length <= 2 * MAX_CONTEXT_LINES + 200 &&
        lines.every(isContextLine)
      );
    }
    case 'preview-result':
      return isPreview(value['preview']);
    case 'fingerprint-result': {
      const fp = value['fingerprint'];
      return (
        isRecord(fp) &&
        typeof fp['metodo'] === 'string' &&
        isSafeInt(fp['tamanhoBloco']) &&
        isSafeInt(fp['blocos']) &&
        isSafeInt(fp['bytes']) &&
        typeof fp['raiz'] === 'string' &&
        /^[0-9a-f]{64}$/.test(fp['raiz'])
      );
    }
    case 'lacre-scan-result': {
      const counts = value['counts'];
      const samples = value['samples'];
      return (
        isRecord(counts) &&
        Object.entries(counts).every(([k, n]) => isLacreType(k) && isSafeInt(n)) &&
        Array.isArray(samples) &&
        samples.length <= LACRE_TYPES.length * 3 &&
        samples.every(
          (x) =>
            isRecord(x) &&
            isLacreType(x['type']) &&
            typeof x['antes'] === 'string' &&
            typeof x['depois'] === 'string',
        )
      );
    }
    case 'cancelled':
      return true;
    case 'error':
      return (
        typeof value['code'] === 'string' &&
        typeof value['message'] === 'string' &&
        typeof value['details'] === 'string'
      );
    default:
      return false;
  }
}
