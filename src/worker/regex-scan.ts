// Varredura por regex do arquivo inteiro. Em produção roda num Worker próprio, que a sessão
// derruba se ficar 2 s sem dar sinal de vida (regex catastrófica). No Node (testes) há uma versão
// no mesmo processo, sem prazo.

import { compilePattern, scanLines } from '../core/regex.ts';
import { readAlignedChunks, type BlobLike } from './reader.ts';

export const REGEX_BUDGET_MS = 2000;
export const REGEX_BLOCK_SIZE = 4 * 1024 * 1024;

export class RegexInvalid extends Error {
  constructor() {
    super('Expressão regular inválida.');
    this.name = 'RegexInvalid';
  }
}

export class RegexTimeout extends Error {
  constructor() {
    super('A expressão regular passou do prazo.');
    this.name = 'RegexTimeout';
  }
}

export interface RegexScanner {
  /** Chama `onHits` com deslocamentos (crescentes) das linhas que casam. */
  scan(
    pattern: string,
    caseSensitive: boolean,
    onHits: (offsets: number[]) => void,
    isCancelled: () => boolean,
  ): Promise<void>;
}

export function createInProcessScanner(blob: BlobLike): RegexScanner {
  return {
    async scan(pattern, caseSensitive, onHits, isCancelled) {
      const compiled = compilePattern(pattern, caseSensitive);
      if (!compiled.ok) throw new RegexInvalid();
      for await (const chunk of readAlignedChunks(blob, REGEX_BLOCK_SIZE, isCancelled)) {
        let hits: number[] = [];
        scanLines(
          chunk.bytes,
          chunk.startOffset,
          compiled.regex,
          (offset) => hits.push(offset),
          () => {
            if (hits.length > 0) {
              onHits(hits);
              hits = [];
            }
          },
        );
        if (isCancelled()) return;
      }
    },
  };
}

/** Mensagens trocadas com regex-worker.ts. */
export type RegexRequest = {
  pattern: string;
  caseSensitive: boolean;
  blob: Blob;
};
export type RegexReply =
  { type: 'beat'; offsets: number[] } | { type: 'done' } | { type: 'invalid' };

export interface WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: RegexRequest): void;
  terminate(): void;
}

export function isRegexReply(value: unknown): value is RegexReply {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['type'] === 'done' || v['type'] === 'invalid') return true;
  return (
    v['type'] === 'beat' &&
    Array.isArray(v['offsets']) &&
    v['offsets'].every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
  );
}

export function createWorkerScanner(
  blob: Blob,
  makeWorker: () => WorkerLike,
  budgetMs: number = REGEX_BUDGET_MS,
): RegexScanner {
  return {
    scan(pattern, caseSensitive, onHits, isCancelled) {
      return new Promise<void>((resolve, reject) => {
        const worker = makeWorker();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let finished = false;

        const finish = (error?: Error): void => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          worker.terminate();
          if (error) reject(error);
          else resolve();
        };
        const arm = (): void => {
          clearTimeout(timer);
          timer = setTimeout(() => finish(new RegexTimeout()), budgetMs);
        };

        worker.onmessage = (event) => {
          if (finished) return;
          const reply = event.data;
          if (!isRegexReply(reply)) return;
          if (reply.type === 'invalid') return finish(new RegexInvalid());
          if (reply.type === 'done') return finish();
          if (isCancelled()) return finish();
          if (reply.offsets.length > 0) onHits(reply.offsets);
          arm();
        };
        worker.onerror = () => finish(new Error('Falha no Worker de regex.'));

        arm();
        worker.postMessage({ pattern, caseSensitive, blob });
      });
    },
  };
}
