// Histograma do Perfil (RF-23): barras empilhadas por severidade, com tamanho de balde adaptativo.

import type { EventIndex } from './analyzer.ts';
import type { Axis } from './query.ts';
import { SEVERITIES } from './types.ts';

export const DEFAULT_MAX_BUCKETS = 240;

/** Tamanhos "redondos" de balde, em milissegundos: 1 ms até 1 semana. */
const NICE_STEPS_MS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000,
  300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000,
  86_400_000, 172_800_000, 604_800_000,
];

/** Menor tamanho redondo para o intervalo caber em `maxBuckets` baldes. */
export function chooseBucketSize(
  rangeMs: number,
  maxBuckets: number = DEFAULT_MAX_BUCKETS,
): number {
  const range = Math.max(0, rangeMs);
  for (const step of NICE_STEPS_MS) {
    if (Math.floor(range / step) + 1 <= maxBuckets) return step;
  }
  // Intervalos de muitos anos: múltiplos de semana.
  const week = 604_800_000;
  return Math.ceil(range / maxBuckets / week) * week;
}

export interface Histogram {
  axis: Axis;
  /** Início do primeiro balde (ms, ou índice do evento no eixo de ordem). */
  start: number;
  bucketSize: number;
  buckets: number;
  /** counts[ranking da severidade][balde]. */
  counts: number[][];
  /** Eventos sem tempo que passaram no filtro (só no eixo de tempo). */
  untimed: number;
  total: number;
}

export interface HistogramRange {
  axis: Axis;
  minTime: number | null;
  maxTime: number | null;
  eventCount: number;
}

/** Geometria dos baldes, igual para qualquer filtro: o Perfil não "pula" quando se filtra. */
export function bucketGeometry(
  range: HistogramRange,
  maxBuckets: number = DEFAULT_MAX_BUCKETS,
): { start: number; bucketSize: number; buckets: number } {
  if (range.axis === 'order' || range.minTime === null || range.maxTime === null) {
    const bucketSize = Math.max(1, Math.ceil(range.eventCount / maxBuckets));
    return { start: 0, bucketSize, buckets: Math.max(1, Math.ceil(range.eventCount / bucketSize)) };
  }
  const bucketSize = chooseBucketSize(range.maxTime - range.minTime, maxBuckets);
  const start = Math.floor(range.minTime / bucketSize) * bucketSize;
  const buckets = Math.floor((range.maxTime - start) / bucketSize) + 1;
  return { start, bucketSize, buckets };
}

export function buildHistogram(
  index: EventIndex,
  matches: Uint32Array,
  range: HistogramRange,
  maxBuckets: number = DEFAULT_MAX_BUCKETS,
): Histogram {
  const geometry = bucketGeometry(range, maxBuckets);
  const counts = SEVERITIES.map(() => new Array<number>(geometry.buckets).fill(0));
  let untimed = 0;

  for (let k = 0; k < matches.length; k += 1) {
    const event = matches[k] ?? 0;
    const position = range.axis === 'time' ? index.times.at(event) : event;
    if (Number.isNaN(position)) {
      untimed += 1;
      continue;
    }
    const bucket = Math.floor((position - geometry.start) / geometry.bucketSize);
    const row = counts[index.ranks.at(event)];
    if (row && bucket >= 0 && bucket < geometry.buckets) row[bucket] = (row[bucket] ?? 0) + 1;
  }

  return {
    axis: range.axis,
    ...geometry,
    counts,
    untimed,
    total: matches.length,
  };
}
