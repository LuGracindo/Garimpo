// Filtro da Peneira (RF-25). O mesmo objeto atravessa a interface e o Worker, então a validação
// fica aqui, junto do tipo.

import { SEVERITIES, type Severity } from './types.ts';

export const MAX_TEXT_LENGTH = 500;

export interface Filter {
  /** Níveis aceitos. Vazio significa todos. */
  levels: Severity[];
  /** Início do intervalo (inclusivo) e fim (exclusivo): milissegundos, ou índice do evento sem eixo de tempo. */
  from: number | null;
  to: number | null;
  nuggetId: number | null;
  /** Texto literal procurado nas linhas do evento. Vazio significa sem busca. */
  text: string;
  caseSensitive: boolean;
}

export const EMPTY_FILTER: Filter = {
  levels: [],
  from: null,
  to: null,
  nuggetId: null,
  text: '',
  caseSensitive: false,
};

/** Chave canônica: filtros equivalentes geram a mesma chave. */
export function filterKey(filter: Filter): string {
  const levels = [...new Set(filter.levels)].sort(
    (a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b),
  );
  return JSON.stringify([
    levels,
    filter.from,
    filter.to,
    filter.nuggetId,
    filter.text,
    filter.text === '' ? false : filter.caseSensitive,
  ]);
}

export function isEmptyFilter(filter: Filter): boolean {
  return filterKey(filter) === filterKey(EMPTY_FILTER);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

export function isFilter(value: unknown): value is Filter {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const levels = v['levels'];
  if (!Array.isArray(levels) || levels.length > SEVERITIES.length) return false;
  if (!levels.every((level) => (SEVERITIES as readonly unknown[]).includes(level))) return false;
  if (!isNumberOrNull(v['from']) || !isNumberOrNull(v['to'])) return false;
  const nugget = v['nuggetId'];
  if (
    nugget !== null &&
    !(typeof nugget === 'number' && Number.isSafeInteger(nugget) && nugget >= 0)
  ) {
    return false;
  }
  const text = v['text'];
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) return false;
  return typeof v['caseSensitive'] === 'boolean';
}
