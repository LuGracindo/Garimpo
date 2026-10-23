// Sessão de consulta: depois da análise, o Worker guarda o índice e responde às perguntas da
// interface (filtrar, histograma, ocorrências, contexto) sem reanalisar o arquivo (ADR-03).
// Não depende de DOM nem de Worker: roda igual no Node (testes).

import type { Analyzer, AnalysisResult } from '../core/analyzer.ts';
import { CONTEXT_READ_BYTES, extractContext, type ContextLine } from '../core/context.ts';
import { filterKey, type Filter } from '../core/filter.ts';
import { buildHistogram, type Histogram, type HistogramRange } from '../core/histogram.ts';
import { selectEvents, type Axis } from '../core/query.ts';
import { TextScanner } from '../core/textsearch.ts';
import { SEVERITIES } from '../core/types.ts';
import type { OccurrenceRowMessage } from '../shared/protocol.ts';
import {
  LACRE_TYPES,
  Lacre,
  findSensitive,
  kindOfRule,
  type CustomRule,
  type HitKind,
  type LacreType,
} from '../core/lacre.ts';
import { fingerprintBlob, type Fingerprint } from './fingerprint.ts';
import { readAlignedChunks, type BlobLike } from './reader.ts';
import { createInProcessScanner, type RegexScanner } from './regex-scan.ts';

export const MAX_ROW_TEXT_CHARS = 400;
const ROW_READ_BYTES = 2048;
const MATCH_CACHE_SIZE = 4;
const TEXT_CACHE_SIZE = 2;
export const MAX_PAGE_SIZE = 500;

export interface QueryResult {
  total: number;
  /** Quantas ocorrências de cada pepita (das exibidas) passam no filtro. */
  nuggetCounts: [number, number][];
}

export type OccurrenceRow = OccurrenceRowMessage;

export interface OccurrencesResult {
  total: number;
  start: number;
  rows: OccurrenceRow[];
}

function textKey(text: string, caseSensitive: boolean, regex: boolean): string {
  return text === '' ? '' : JSON.stringify([text, caseSensitive, regex]);
}

export const LACRE_SAMPLES_PER_TYPE = 3;

export interface LacreSample {
  type: HitKind;
  antes: string;
  depois: string;
}

export interface LacreScan {
  counts: Record<string, number>;
  samples: LacreSample[];
}

export class Superseded extends Error {
  constructor() {
    super('superseded');
    this.name = 'Superseded';
  }
}

export class Session {
  readonly axis: Axis;
  readonly eventCount: number;
  private readonly blob: BlobLike;
  private readonly analyzer: Analyzer;
  private readonly topIds: number[];
  private readonly scanner: RegexScanner;
  private readonly range: HistogramRange;
  private readonly matchCache = new Map<string, Uint32Array>();
  private readonly textCache = new Map<string, Uint8Array>();
  private readonly pending = new Map<string, Promise<Uint32Array>>();
  /** Chave de texto da consulta mais recente: varreduras de outro texto são abandonadas. */
  private latestTextKey: string | null = null;
  private disposed = false;

  constructor(blob: BlobLike, analyzer: Analyzer, result: AnalysisResult, scanner?: RegexScanner) {
    this.blob = blob;
    this.scanner = scanner ?? createInProcessScanner(blob);
    this.analyzer = analyzer;
    this.eventCount = analyzer.index.length;
    const summary = result.summary;
    this.axis = summary.firstTimeMs !== null && summary.lastTimeMs !== null ? 'time' : 'order';
    this.topIds = result.nuggets.map((n) => n.id);
    this.range = {
      axis: this.axis,
      minTime: summary.firstTimeMs,
      maxTime: summary.lastTimeMs,
      eventCount: this.eventCount,
    };
  }

  private eventStart(event: number): number {
    return this.analyzer.index.offsets.at(event);
  }

  private eventEnd(event: number): number {
    return event + 1 < this.eventCount ? this.eventStart(event + 1) : this.blob.size;
  }

  private async read(start: number, end: number): Promise<Uint8Array> {
    const from = Math.max(0, Math.min(start, this.blob.size));
    const to = Math.max(from, Math.min(end, this.blob.size));
    return new Uint8Array(await this.blob.slice(from, to).arrayBuffer());
  }

  /** Um byte por evento: 1 quando o texto (ou a regex) casa em alguma linha do evento. */
  private async textMatches(
    text: string,
    caseSensitive: boolean,
    regex: boolean,
  ): Promise<Uint8Array> {
    const key = textKey(text, caseSensitive, regex);
    const isCancelled = (): boolean =>
      this.disposed || (this.latestTextKey !== null && this.latestTextKey !== key);
    const cached = this.textCache.get(key);
    if (cached) return cached;

    const flags = new Uint8Array(this.eventCount);
    const offsets = this.analyzer.index.offsets;
    const count = this.eventCount;
    let cursor = 0;
    const mark = (offset: number): void => {
      // Os acertos chegam em ordem crescente, então o cursor só avança.
      while (cursor + 1 < count && offsets.at(cursor + 1) <= offset) cursor += 1;
      if (count > 0 && offsets.at(cursor) <= offset) flags[cursor] = 1;
    };

    if (regex) {
      await this.scanner.scan(
        text,
        caseSensitive,
        (hits) => {
          for (const offset of hits) mark(offset);
        },
        isCancelled,
      );
    } else {
      const scanner = new TextScanner(text, caseSensitive);
      for await (const chunk of readAlignedChunks(this.blob, 4 * 1024 * 1024, isCancelled)) {
        scanner.scan(chunk.bytes, chunk.startOffset, mark);
        if (isCancelled()) throw new Superseded();
      }
    }
    if (isCancelled()) throw new Superseded();

    this.textCache.set(key, flags);
    while (this.textCache.size > TEXT_CACHE_SIZE) {
      const oldest = this.textCache.keys().next().value;
      if (oldest === undefined) break;
      this.textCache.delete(oldest);
    }
    return flags;
  }

  /** Índices dos eventos que passam no filtro. Consultas iguais em andamento compartilham o trabalho. */
  matches(filter: Filter): Promise<Uint32Array> {
    const key = filterKey(filter);
    const cached = this.matchCache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = this.pending.get(key);
    if (running) return running;

    const work = (async (): Promise<Uint32Array> => {
      const flags =
        filter.text === ''
          ? null
          : await this.textMatches(filter.text, filter.caseSensitive, filter.regex);
      const selected = selectEvents(this.analyzer.index, filter, this.axis, flags);
      this.matchCache.set(key, selected);
      while (this.matchCache.size > MATCH_CACHE_SIZE) {
        const oldest = this.matchCache.keys().next().value;
        if (oldest === undefined) break;
        this.matchCache.delete(oldest);
      }
      return selected;
    })();
    this.pending.set(key, work);
    const forget = (): void => {
      this.pending.delete(key);
    };
    work.then(forget, forget);
    return work;
  }

  async query(filter: Filter): Promise<QueryResult> {
    this.latestTextKey = textKey(filter.text, filter.caseSensitive, filter.regex);
    // A contagem por pepita ignora a escolha de uma pepita: mostra o que cada uma teria.
    const open = { ...filter, nuggetId: null };
    const selected = await this.matches(open);
    const tally = new Map<number, number>();
    for (const id of this.topIds) tally.set(id, 0);
    const nuggets = this.analyzer.index.nuggets;
    for (let k = 0; k < selected.length; k += 1) {
      const id = nuggets.at(selected[k] ?? 0);
      const current = tally.get(id);
      if (current !== undefined) tally.set(id, current + 1);
    }
    const total = filter.nuggetId === null ? selected.length : (await this.matches(filter)).length;
    return { total, nuggetCounts: [...tally.entries()] };
  }

  async histogram(filter: Filter): Promise<Histogram> {
    // O intervalo é uma seleção sobre o Perfil, não um recorte dele.
    const withoutRange = { ...filter, from: null, to: null };
    const selected = await this.matches(withoutRange);
    return buildHistogram(this.analyzer.index, selected, this.range);
  }

  async occurrences(filter: Filter, start: number, count: number): Promise<OccurrencesResult> {
    const selected = await this.matches(filter);
    const safeStart = Math.max(0, Math.min(start, selected.length));
    const safeEnd = Math.min(selected.length, safeStart + Math.min(count, MAX_PAGE_SIZE));
    const index = this.analyzer.index;
    const decoder = new TextDecoder('utf-8');

    const rows = await Promise.all(
      Array.from({ length: safeEnd - safeStart }, async (_, k): Promise<OccurrenceRow> => {
        const event = selected[safeStart + k] ?? 0;
        const offset = this.eventStart(event);
        const bytes = await this.read(
          offset,
          Math.min(this.eventEnd(event), offset + ROW_READ_BYTES),
        );
        const newline = bytes.indexOf(0x0a);
        let text = decoder.decode(newline === -1 ? bytes : bytes.subarray(0, newline));
        if (text.endsWith('\r')) text = text.slice(0, -1);
        const time = index.times.at(event);
        return {
          event,
          timeMs: Number.isNaN(time) ? null : time,
          severity: SEVERITIES[index.ranks.at(event)] ?? 'INFO',
          nuggetId: index.nuggets.at(event),
          offset,
          text: text.length > MAX_ROW_TEXT_CHARS ? text.slice(0, MAX_ROW_TEXT_CHARS) : text,
        };
      }),
    );
    return { total: selected.length, start: safeStart, rows };
  }

  async context(event: number, before: number, after: number): Promise<ContextLine[]> {
    if (!Number.isInteger(event) || event < 0 || event >= this.eventCount) return [];
    const start = this.eventStart(event);
    const end = this.eventEnd(event);
    const [beforeBytes, eventBytes, afterBytes] = await Promise.all([
      this.read(start - CONTEXT_READ_BYTES, start),
      this.read(start, Math.min(end, start + CONTEXT_READ_BYTES)),
      this.read(end, end + CONTEXT_READ_BYTES),
    ]);
    return extractContext(
      {
        before: beforeBytes,
        beforeFromStart: start - CONTEXT_READ_BYTES <= 0,
        event: eventBytes,
        after: afterBytes,
        afterToEnd: end + CONTEXT_READ_BYTES >= this.blob.size,
      },
      before,
      after,
    );
  }

  /** Impressão digital do arquivo (AUD-02). Lança Superseded se o pedido for abandonado. */
  async fingerprint(isCancelled: () => boolean): Promise<Fingerprint> {
    const result = await fingerprintBlob(this.blob, {
      isCancelled: () => this.disposed || isCancelled(),
    });
    if (!result) throw new Superseded();
    return result;
  }

  /**
   * Conta quanto dado sensível há no arquivo inteiro, por tipo, e guarda poucos exemplos
   * (antes e depois da máscara) para a pessoa conferir o que o Lacre vai fazer.
   */
  async lacreScan(
    types: readonly LacreType[],
    custom: readonly CustomRule[],
    isCancelled: () => boolean,
  ): Promise<LacreScan> {
    const wanted = new Set(types);
    const counts: Record<string, number> = Object.fromEntries([
      ...LACRE_TYPES.map((t) => [t, 0]),
      ...custom.map((r) => [kindOfRule(r), 0]),
    ]);
    const samples: LacreSample[] = [];
    const sampled = new Map<HitKind, number>();
    const decoder = new TextDecoder('utf-8');
    const stop = (): boolean => this.disposed || isCancelled();

    for await (const chunk of readAlignedChunks(this.blob, 4 * 1024 * 1024, stop)) {
      let position = 0;
      let inBatch = 0;
      while (position < chunk.bytes.length) {
        let end = chunk.bytes.indexOf(0x0a, position);
        const next = end === -1 ? chunk.bytes.length : end + 1;
        if (end === -1) end = chunk.bytes.length;
        const line = decoder.decode(chunk.bytes.subarray(position, end));
        position = next;
        const hits = findSensitive(line, wanted, custom);
        for (const hit of hits) {
          counts[hit.type] = (counts[hit.type] ?? 0) + 1;
          const taken = sampled.get(hit.type) ?? 0;
          if (taken < LACRE_SAMPLES_PER_TYPE) {
            sampled.set(hit.type, taken + 1);
            const antes = line.length > 300 ? line.slice(0, 300) : line;
            samples.push({ type: hit.type, antes, depois: new Lacre(wanted, custom).mask(antes) });
          }
        }
        inBatch += 1;
        if (inBatch === 2000) {
          inBatch = 0;
          // Cede a vez para o Worker tratar pedidos novos (cancelamento) entre os lotes.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (stop()) throw new Superseded();
        }
      }
    }
    if (stop()) throw new Superseded();
    return { counts, samples };
  }

  /** Libera o que a sessão guarda e abandona varreduras em andamento. */
  dispose(): void {
    this.disposed = true;
    this.matchCache.clear();
    this.textCache.clear();
    this.pending.clear();
  }
}
