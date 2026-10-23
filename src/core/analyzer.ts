// Agregador de pepitas (SDD 7.4 a 7.6, RF-20 a RF-22).
// Recebe pedaços de bytes alinhados em quebras de linha, decodifica linha a linha, segmenta em
// eventos, calcula o fingerprint e acumula as pepitas. Guarda só deslocamentos e números no
// índice, nunca o texto das linhas (ADR-03).

import { fingerprintEvent, shortId } from './fingerprint.ts';
import { getProfile } from './profiles.ts';
import { DEFAULT_LIMITS, Segmenter, type EventRecord, type SegmenterLimits } from './segmenter.ts';
import {
  SEVERITIES,
  severityRank,
  type NormalizationMode,
  type ProfileId,
  type Severity,
} from './types.ts';

export type SeverityWeights = Readonly<Record<Severity, number>>;

/** Pesos da prioridade (SDD 7.5). Gravados no laudo para reprodutibilidade. */
export const DEFAULT_WEIGHTS: SeverityWeights = {
  FATAL: 8,
  ERROR: 5,
  WARN: 2,
  INFO: 1,
  DEBUG: 0.5,
};

export const RECENT_FRACTION = 0.1;
export const NEW_FRACTION = 0.2;
export const MAX_EXAMPLES = 5;
export const MAX_DISTINCT_TRACKED = 50;
export const DEFAULT_MAX_NUGGETS = 100_000;
export const DEFAULT_TOP_NUGGETS = 200;
/** Linhas maiores que isto são decodificadas só até aqui; o deslocamento original é preservado. */
export const MAX_DECODE_BYTES = 16 * 1024;
export const MAX_SAMPLE_HEAD_CHARS = 300;

const OVERFLOW_KEY = '‹outras pepitas›';

export interface MarkerView {
  marker: string;
  /** Quantidade de valores distintos vistos (limitada a MAX_DISTINCT_TRACKED). */
  distinct: number;
  capped: boolean;
  examples: string[];
}

export interface NuggetView {
  id: number;
  shortId: string;
  /** Gabarito: a chave exata da pepita. */
  template: string;
  /** Mensagem normalizada do primeiro evento (útil quando a chave é uma assinatura de pilha). */
  headTemplate: string;
  hasStack: boolean;
  count: number;
  dominant: Severity;
  severityCounts: Record<Severity, number>;
  firstTimeMs: number | null;
  lastTimeMs: number | null;
  isNew: boolean;
  priority: number;
  /** Deslocamentos em bytes das primeiras ocorrências, para reler o arquivo sob demanda. */
  sampleOffsets: number[];
  markers: MarkerView[];
}

export interface AnalysisSummary {
  profile: ProfileId | null;
  profileSource: 'auto' | 'manual' | 'none';
  confidence: number | null;
  mode: NormalizationMode;
  bytes: number;
  lines: number;
  blankLines: number;
  headerLines: number;
  unparsed: number;
  events: number;
  outOfOrder: number;
  truncatedEvents: number;
  maxLineBytes: number;
  nuggetCount: number;
  overflow: boolean;
  firstTimeMs: number | null;
  lastTimeMs: number | null;
  severityCounts: Record<Severity, number>;
  weights: SeverityWeights;
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  /** As pepitas de maior prioridade, em ordem decrescente. */
  nuggets: NuggetView[];
}

export function emptySeverityCounts(): Record<Severity, number> {
  return { FATAL: 0, ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 };
}

export interface AnalyzerOptions {
  profile: ProfileId;
  profileSource?: 'auto' | 'manual';
  confidence?: number | null;
  mode?: NormalizationMode;
  weights?: SeverityWeights;
  limits?: SegmenterLimits;
  maxNuggets?: number;
  topNuggets?: number;
}

interface MarkerAcc {
  seen: Set<string>;
  capped: boolean;
}

interface NuggetAcc {
  id: number;
  key: string;
  headTemplate: string;
  hasStack: boolean;
  count: number;
  severityCounts: Record<Severity, number>;
  maxRank: number;
  firstTimeMs: number | null;
  lastTimeMs: number | null;
  recent: number;
  sampleOffsets: number[];
  markers: Map<string, MarkerAcc>;
}

/** Vetor de Float64 que cresce por blocos, sem copiar tudo a cada inserção. */
class GrowableF64 {
  private chunks: Float64Array[] = [];
  private used = 0;
  readonly chunkSize = 65_536;
  length = 0;

  push(value: number): void {
    if (this.used === 0 || this.used === this.chunkSize) {
      this.chunks.push(new Float64Array(this.chunkSize));
      this.used = 0;
    }
    const chunk = this.chunks[this.chunks.length - 1];
    if (chunk) chunk[this.used] = value;
    this.used += 1;
    this.length += 1;
  }

  at(index: number): number {
    const chunk = this.chunks[Math.floor(index / this.chunkSize)];
    return chunk ? (chunk[index % this.chunkSize] ?? Number.NaN) : Number.NaN;
  }
}

/** Índice de eventos: deslocamento, tempo e pepita de cada evento (base do Perfil e da Peneira). */
export class EventIndex {
  readonly offsets = new GrowableF64();
  readonly times = new GrowableF64();
  readonly nuggets = new GrowableF64();
  readonly ranks = new GrowableF64();

  get length(): number {
    return this.offsets.length;
  }
}

export class Analyzer {
  readonly index = new EventIndex();

  private readonly segmenter: Segmenter;
  private readonly mode: NormalizationMode;
  private readonly weights: SeverityWeights;
  private readonly maxNuggets: number;
  private readonly topNuggets: number;
  private readonly map = new Map<string, NuggetAcc>();
  private readonly list: NuggetAcc[] = [];
  private readonly decoder = new TextDecoder('utf-8');
  private overflowNugget: NuggetAcc | null = null;
  private maxLineBytes = 0;
  private bytes = 0;
  private minTime = Number.POSITIVE_INFINITY;
  private maxTime = Number.NEGATIVE_INFINITY;
  private readonly severityTotals = emptySeverityCounts();

  private readonly options: AnalyzerOptions;

  constructor(options: AnalyzerOptions) {
    this.options = options;
    this.mode = options.mode ?? 'padrao';
    this.weights = options.weights ?? DEFAULT_WEIGHTS;
    this.maxNuggets = options.maxNuggets ?? DEFAULT_MAX_NUGGETS;
    this.topNuggets = options.topNuggets ?? DEFAULT_TOP_NUGGETS;
    this.segmenter = new Segmenter(
      getProfile(options.profile),
      (event) => this.onEvent(event),
      options.limits ?? DEFAULT_LIMITS,
    );
  }

  get lines(): number {
    return this.segmenter.stats.lines;
  }

  /** Recebe um pedaço de bytes que começa em `startOffset` e termina em quebra de linha. */
  feed(bytes: Uint8Array, startOffset: number): void {
    let from = 0;
    while (from < bytes.length) {
      const newline = bytes.indexOf(0x0a, from);
      const end = newline === -1 ? bytes.length : newline;
      const lineBytes = newline === -1 ? end - from : end - from + 1;
      let textEnd = end;
      if (textEnd > from && bytes[textEnd - 1] === 0x0d) textEnd -= 1;
      if (lineBytes > this.maxLineBytes) this.maxLineBytes = lineBytes;

      const cut = Math.min(textEnd - from, MAX_DECODE_BYTES);
      let text = this.decoder.decode(bytes.subarray(from, from + cut));
      if (startOffset + from === 0 && text.charCodeAt(0) === 0xfeff) text = text.slice(1);

      this.segmenter.push(text, startOffset + from, lineBytes);
      from = newline === -1 ? bytes.length : newline + 1;
    }
    this.bytes = Math.max(this.bytes, startOffset + bytes.length);
  }

  private onEvent(event: EventRecord): void {
    const fp = fingerprintEvent(event.parsed, event.lines, this.mode);
    let nugget = this.map.get(fp.key);
    if (!nugget) {
      if (this.list.length >= this.maxNuggets) {
        nugget = this.getOverflow();
      } else {
        nugget = this.createNugget(fp.key, fp.headTemplate, fp.hasStack);
        this.map.set(fp.key, nugget);
      }
    }

    const severity: Severity = event.parsed.level ?? 'INFO';
    nugget.count += 1;
    nugget.severityCounts[severity] += 1;
    this.severityTotals[severity] += 1;
    const rank = severityRank(severity);
    if (rank > nugget.maxRank) nugget.maxRank = rank;

    const time = event.parsed.timeMs;
    if (time !== null) {
      if (nugget.firstTimeMs === null || time < nugget.firstTimeMs) nugget.firstTimeMs = time;
      if (nugget.lastTimeMs === null || time > nugget.lastTimeMs) nugget.lastTimeMs = time;
      if (time < this.minTime) this.minTime = time;
      if (time > this.maxTime) this.maxTime = time;
    }

    if (nugget.sampleOffsets.length < MAX_EXAMPLES) nugget.sampleOffsets.push(event.offset);

    for (const capture of fp.captures) {
      let acc = nugget.markers.get(capture.marker);
      if (!acc) {
        acc = { seen: new Set(), capped: false };
        nugget.markers.set(capture.marker, acc);
      }
      if (acc.seen.size < MAX_DISTINCT_TRACKED) acc.seen.add(capture.value);
      else if (!acc.seen.has(capture.value)) acc.capped = true;
    }

    this.index.offsets.push(event.offset);
    this.index.times.push(time ?? Number.NaN);
    this.index.nuggets.push(nugget.id);
    this.index.ranks.push(rank);
  }

  private createNugget(key: string, headTemplate: string, hasStack: boolean): NuggetAcc {
    const nugget: NuggetAcc = {
      id: this.list.length,
      key,
      headTemplate:
        headTemplate.length > MAX_SAMPLE_HEAD_CHARS
          ? headTemplate.slice(0, MAX_SAMPLE_HEAD_CHARS)
          : headTemplate,
      hasStack,
      count: 0,
      severityCounts: emptySeverityCounts(),
      maxRank: 0,
      firstTimeMs: null,
      lastTimeMs: null,
      recent: 0,
      sampleOffsets: [],
      markers: new Map(),
    };
    this.list.push(nugget);
    return nugget;
  }

  private getOverflow(): NuggetAcc {
    if (!this.overflowNugget) {
      // O limite de pepitas já foi atingido: a pepita de excesso entra além dele, uma única vez.
      this.overflowNugget = this.createNugget(OVERFLOW_KEY, OVERFLOW_KEY, false);
    }
    return this.overflowNugget;
  }

  finish(): AnalysisResult {
    this.segmenter.finish();
    const stats = this.segmenter.stats;

    const hasRange = Number.isFinite(this.minTime) && this.maxTime > this.minTime;
    const range = hasRange ? this.maxTime - this.minTime : 0;

    if (hasRange) {
      const recentFrom = this.maxTime - RECENT_FRACTION * range;
      for (let i = 0; i < this.index.length; i += 1) {
        const time = this.index.times.at(i);
        if (time >= recentFrom) {
          const nugget = this.list[this.index.nuggets.at(i)];
          if (nugget) nugget.recent += 1;
        }
      }
    }

    const newFrom = this.minTime + (1 - NEW_FRACTION) * range;
    const views = this.list.map((nugget): NuggetView => {
      const dominant = SEVERITIES[nugget.maxRank] ?? 'INFO';
      const recencyFactor = hasRange ? 1 + nugget.recent / nugget.count : 1;
      const priority =
        this.weights[dominant] * (1 + Math.log10(Math.max(1, nugget.count))) * recencyFactor;
      return {
        id: nugget.id,
        shortId: shortId(nugget.key),
        template: nugget.key,
        headTemplate: nugget.headTemplate,
        hasStack: nugget.hasStack,
        count: nugget.count,
        dominant,
        severityCounts: nugget.severityCounts,
        firstTimeMs: nugget.firstTimeMs,
        lastTimeMs: nugget.lastTimeMs,
        isNew: hasRange && nugget.firstTimeMs !== null && nugget.firstTimeMs >= newFrom,
        priority,
        sampleOffsets: nugget.sampleOffsets,
        markers: [...nugget.markers.entries()].map(([marker, acc]) => ({
          marker,
          distinct: acc.seen.size,
          capped: acc.capped,
          examples: [...acc.seen].slice(0, MAX_EXAMPLES),
        })),
      };
    });

    views.sort((a, b) => b.priority - a.priority || b.count - a.count || a.id - b.id);

    return {
      summary: {
        profile: this.options.profile,
        profileSource: this.options.profileSource ?? 'manual',
        confidence: this.options.confidence ?? null,
        mode: this.mode,
        bytes: this.bytes,
        lines: stats.lines,
        blankLines: stats.blankLines,
        headerLines: stats.headerLines,
        unparsed: stats.unparsed,
        events: stats.events,
        outOfOrder: stats.outOfOrder,
        truncatedEvents: stats.truncatedEvents,
        maxLineBytes: this.maxLineBytes,
        nuggetCount: this.list.length,
        overflow: this.overflowNugget !== null,
        firstTimeMs: Number.isFinite(this.minTime) ? this.minTime : null,
        lastTimeMs: Number.isFinite(this.maxTime) ? this.maxTime : null,
        severityCounts: this.severityTotals,
        weights: this.weights,
      },
      nuggets: views.slice(0, this.topNuggets),
    };
  }
}
