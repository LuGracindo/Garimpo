// Leitor em streaming (SDD 5.3, passos 3 a 6).
// Lê o arquivo em blocos e entrega pedaços alinhados à última quebra de linha completa,
// para que o decodificador do marco M1 nunca receba uma linha cortada ao meio.
// Este módulo não depende de DOM nem de Worker: roda igual no navegador e no Node.

const NEWLINE = 0x0a;

/** Acima disto, uma linha sem quebra é entregue cortada (forcedBreak) para não crescer sem limite. */
export const MAX_CARRY_BYTES = 8 * 1024 * 1024;

export interface BlobLike {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface AlignedChunk {
  bytes: Uint8Array;
  startOffset: number;
  endOffset: number;
  /** true quando uma linha maior que MAX_CARRY_BYTES precisou ser cortada. */
  forcedBreak: boolean;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export async function* readAlignedChunks(
  blob: BlobLike,
  blockSize: number,
  isCancelled: () => boolean = () => false,
): AsyncGenerator<AlignedChunk> {
  if (!Number.isSafeInteger(blockSize) || blockSize < 1) {
    throw new RangeError('blockSize inválido');
  }

  let offset = 0;
  let carry: Uint8Array = new Uint8Array(0);
  let carryStart = 0;

  while (offset < blob.size) {
    if (isCancelled()) return;

    const end = Math.min(offset + blockSize, blob.size);
    const fresh = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    offset = end;

    const buffer = carry.length > 0 ? concat(carry, fresh) : fresh;
    const bufferStart = carryStart;

    if (offset >= blob.size) {
      // Último bloco: entrega tudo, mesmo sem quebra final.
      yield {
        bytes: buffer,
        startOffset: bufferStart,
        endOffset: bufferStart + buffer.length,
        forcedBreak: false,
      };
      return;
    }

    const cut = buffer.lastIndexOf(NEWLINE);

    if (cut === -1) {
      if (buffer.length > MAX_CARRY_BYTES) {
        yield {
          bytes: buffer,
          startOffset: bufferStart,
          endOffset: bufferStart + buffer.length,
          forcedBreak: true,
        };
        carry = new Uint8Array(0);
        carryStart = bufferStart + buffer.length;
      } else {
        carry = buffer;
        carryStart = bufferStart;
      }
      continue;
    }

    const head = buffer.subarray(0, cut + 1);
    yield {
      bytes: head,
      startOffset: bufferStart,
      endOffset: bufferStart + head.length,
      forcedBreak: false,
    };
    carry = buffer.slice(cut + 1);
    carryStart = bufferStart + cut + 1;
  }
}

export interface ScanProgress {
  bytesRead: number;
  totalBytes: number;
  lines: number;
}

export interface ScanOptions {
  blockSize: number;
  onProgress?: (progress: ScanProgress) => void;
  isCancelled?: () => boolean;
  progressIntervalMs?: number;
  now?: () => number;
}

export interface ScanResult {
  bytesRead: number;
  lines: number;
  maxLineBytes: number;
  cancelled: boolean;
}

/**
 * Conta linhas e o tamanho da maior linha. Define "linha" como cada trecho terminado em \n,
 * mais um último trecho sem \n quando o arquivo não termina em quebra. Arquivo vazio tem 0 linhas.
 */
export async function scanLines(blob: BlobLike, options: ScanOptions): Promise<ScanResult> {
  const isCancelled = options.isCancelled ?? (() => false);
  const now = options.now ?? (() => Date.now());
  const interval = options.progressIntervalMs ?? 200;

  let bytesRead = 0;
  let newlines = 0;
  let currentLine = 0;
  let maxLine = 0;
  let lastByte = -1;
  let lastProgress = now();

  for await (const chunk of readAlignedChunks(blob, options.blockSize, isCancelled)) {
    const bytes = chunk.bytes;
    let from = 0;
    while (true) {
      const at = bytes.indexOf(NEWLINE, from);
      if (at === -1) break;
      newlines += 1;
      const lineLength = currentLine + (at - from);
      if (lineLength > maxLine) maxLine = lineLength;
      currentLine = 0;
      from = at + 1;
    }
    currentLine += bytes.length - from;
    if (bytes.length > 0) lastByte = bytes[bytes.length - 1] ?? -1;
    bytesRead = chunk.endOffset;

    const t = now();
    if (options.onProgress && t - lastProgress >= interval) {
      lastProgress = t;
      options.onProgress({ bytesRead, totalBytes: blob.size, lines: newlines });
    }
  }

  if (currentLine > maxLine) maxLine = currentLine;
  const hasTrailingLine = bytesRead > 0 && lastByte !== NEWLINE;
  const cancelled = isCancelled();

  return {
    bytesRead,
    lines: newlines + (hasTrailingLine ? 1 : 0),
    maxLineBytes: maxLine,
    cancelled,
  };
}
