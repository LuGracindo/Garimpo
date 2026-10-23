// Busca por expressão regular (RF-25, modo avançado). A execução acontece num Worker isolado e
// com prazo (SDD SEG-12); aqui ficam as partes puras: compilar, avisar e varrer linhas.

export const MAX_PATTERN_LENGTH = 500;
/** Linhas maiores que isto são testadas só até este tamanho (limita o custo por linha). */
export const MAX_MATCH_LINE_CHARS = 100_000;
export const BATCH_LINES = 256;

export type PatternProblem = 'vazio' | 'longo' | 'sintaxe';

export type Compiled = { ok: true; regex: RegExp } | { ok: false; problem: PatternProblem };

export function compilePattern(pattern: string, caseSensitive: boolean): Compiled {
  if (pattern === '') return { ok: false, problem: 'vazio' };
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, problem: 'longo' };
  try {
    // Sem as flags g e y: `test` não guarda estado entre linhas.
    return { ok: true, regex: new RegExp(pattern, caseSensitive ? '' : 'i') };
  } catch {
    return { ok: false, problem: 'sintaxe' };
  }
}

/**
 * Heurística de aviso: um grupo com quantificador (`+`, `*`, `{n,}`) dentro que ele mesmo é
 * repetido, como `(a+)+`, é o padrão clássico de explosão de tempo. É só um aviso: a proteção
 * real é o prazo do Worker.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  return /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/.test(
    pattern,
  );
}

const decoder = new TextDecoder('utf-8');
const NEWLINE = 0x0a;

/**
 * Testa cada linha do bloco e chama `onHit` com o deslocamento do início da linha. A cada
 * BATCH_LINES linhas chama `onBatch`, que o Worker usa como sinal de vida para o prazo.
 * O bloco deve terminar em quebra de linha (ou ser o fim do arquivo).
 */
export function scanLines(
  bytes: Uint8Array,
  startOffset: number,
  regex: RegExp,
  onHit: (offset: number) => void,
  onBatch: () => void,
): void {
  let position = 0;
  let inBatch = 0;
  while (position < bytes.length) {
    let end = bytes.indexOf(NEWLINE, position);
    const next = end === -1 ? bytes.length : end + 1;
    if (end === -1) end = bytes.length;
    let text = decoder.decode(bytes.subarray(position, end));
    if (text.endsWith('\r')) text = text.slice(0, -1);
    if (text.length > MAX_MATCH_LINE_CHARS) text = text.slice(0, MAX_MATCH_LINE_CHARS);
    if (regex.test(text)) onHit(startOffset + position);
    position = next;
    inBatch += 1;
    if (inBatch === BATCH_LINES) {
      inBatch = 0;
      onBatch();
    }
  }
  onBatch();
}
