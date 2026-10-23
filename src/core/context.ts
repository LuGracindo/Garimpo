// Contexto de uma ocorrência (RF-26): linhas antes e depois, lidas do arquivo original sob demanda.

export const MAX_LINE_CHARS = 2000;
export const MAX_EVENT_LINES = 200;
export const CONTEXT_READ_BYTES = 64 * 1024;

export interface ContextLine {
  kind: 'before' | 'event' | 'after';
  text: string;
  /** true quando a linha passou do limite e foi cortada para exibição. */
  cut: boolean;
}

export interface ContextInput {
  /** Bytes imediatamente antes do evento; `beforeFromStart` é true se começam no início do arquivo. */
  before: Uint8Array;
  beforeFromStart: boolean;
  /** Bytes do evento (pode ter sido cortado em CONTEXT_READ_BYTES). */
  event: Uint8Array;
  /** Bytes imediatamente depois do evento; `afterToEnd` é true se chegam ao fim do arquivo. */
  after: Uint8Array;
  afterToEnd: boolean;
}

const decoder = new TextDecoder('utf-8');

/** Divide em linhas. `dropFirst` descarta a primeira (cortada); `dropLast` a última (incompleta). */
function toLines(bytes: Uint8Array, dropFirst: boolean, dropLast: boolean): string[] {
  if (bytes.length === 0) return [];
  const text = decoder.decode(bytes);
  const parts = text.split('\n');
  // Um texto que termina em quebra gera um último item vazio, que não é linha.
  if (parts[parts.length - 1] === '') parts.pop();
  else if (dropLast) parts.pop();
  if (dropFirst && parts.length > 0) parts.shift();
  return parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

function clip(text: string): { text: string; cut: boolean } {
  return text.length > MAX_LINE_CHARS
    ? { text: text.slice(0, MAX_LINE_CHARS), cut: true }
    : { text, cut: false };
}

export function extractContext(
  input: ContextInput,
  linesBefore: number,
  linesAfter: number,
): ContextLine[] {
  const before =
    linesBefore === 0
      ? []
      : toLines(input.before, !input.beforeFromStart, false).slice(-linesBefore);
  const event = toLines(input.event, false, false).slice(0, MAX_EVENT_LINES);
  const after = toLines(input.after, false, !input.afterToEnd).slice(0, linesAfter);

  const lines: ContextLine[] = [];
  for (const text of before) lines.push({ kind: 'before', ...clip(text) });
  for (const text of event) lines.push({ kind: 'event', ...clip(text) });
  for (const text of after) lines.push({ kind: 'after', ...clip(text) });
  return lines;
}
