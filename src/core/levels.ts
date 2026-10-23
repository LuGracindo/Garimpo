// Níveis e sinônimos (SDD 8.4). A comparação ignora maiúsculas e minúsculas.

import type { Severity } from './types.ts';

const SYNONYMS: Readonly<Record<string, Severity>> = {
  fatal: 'FATAL',
  crit: 'FATAL',
  critical: 'FATAL',
  emerg: 'FATAL',
  emergency: 'FATAL',
  alert: 'FATAL',
  panic: 'FATAL',
  error: 'ERROR',
  err: 'ERROR',
  severe: 'ERROR',
  e: 'ERROR',
  warn: 'WARN',
  warning: 'WARN',
  w: 'WARN',
  info: 'INFO',
  notice: 'INFO',
  i: 'INFO',
  debug: 'DEBUG',
  trace: 'DEBUG',
  verbose: 'DEBUG',
  d: 'DEBUG',
  t: 'DEBUG',
};

export function normalizeLevel(text: string): Severity | null {
  const found = SYNONYMS[text.toLowerCase()];
  return found ?? null;
}

/** Níveis numéricos no estilo do pino (10 a 60). */
export function levelFromNumber(value: number): Severity | null {
  if (!Number.isFinite(value)) return null;
  if (value >= 60) return 'FATAL';
  if (value >= 50) return 'ERROR';
  if (value >= 40) return 'WARN';
  if (value >= 30) return 'INFO';
  return 'DEBUG';
}
