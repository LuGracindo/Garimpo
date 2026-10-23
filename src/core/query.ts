// Seleção de eventos por filtro de índice (nível, intervalo, pepita) e, quando houver, pelo
// resultado da busca de texto. Tudo em arrays tipados: 1 milhão de eventos cabe em poucos ms.

import type { EventIndex } from './analyzer.ts';
import type { Filter } from './filter.ts';
import { SEVERITIES } from './types.ts';

export type Axis = 'time' | 'order';

export function levelMask(levels: readonly string[]): number {
  if (levels.length === 0) return (1 << SEVERITIES.length) - 1;
  let mask = 0;
  for (const level of levels) {
    const rank = (SEVERITIES as readonly string[]).indexOf(level);
    if (rank >= 0) mask |= 1 << rank;
  }
  return mask;
}

/**
 * Devolve os índices (em ordem) dos eventos que passam no filtro.
 * `textMatches` tem um byte por evento (1 = o texto aparece nele) ou é null sem busca de texto.
 * Eventos sem tempo ficam de fora quando há intervalo no eixo de tempo.
 */
export function selectEvents(
  index: EventIndex,
  filter: Filter,
  axis: Axis,
  textMatches: Uint8Array | null,
): Uint32Array {
  const total = index.length;
  const out = new Uint32Array(total);
  const mask = levelMask(filter.levels);
  const allLevels = mask === (1 << SEVERITIES.length) - 1;
  const hasRange = filter.from !== null || filter.to !== null;
  const from = filter.from ?? Number.NEGATIVE_INFINITY;
  const to = filter.to ?? Number.POSITIVE_INFINITY;
  const nugget = filter.nuggetId;
  let count = 0;

  for (let i = 0; i < total; i += 1) {
    if (!allLevels && (mask & (1 << index.ranks.at(i))) === 0) continue;
    if (nugget !== null && index.nuggets.at(i) !== nugget) continue;
    if (hasRange) {
      const position = axis === 'time' ? index.times.at(i) : i;
      if (!(position >= from && position < to)) continue;
    }
    if (textMatches !== null && textMatches[i] !== 1) continue;
    out[count] = i;
    count += 1;
  }
  return out.slice(0, count);
}
