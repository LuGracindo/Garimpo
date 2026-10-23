// Protocolo UI <-> Worker (SDD 5.4). Ambos os lados validam o que recebem.
// Regra SEG-19: mensagens de erro nunca carregam trechos do arquivo.

export const PROTOCOL_VERSION = 1;

export const MIN_BLOCK_SIZE = 64 * 1024;
export const MAX_BLOCK_SIZE = 64 * 1024 * 1024;
export const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024;

export interface OpenOptions {
  blockSize: number;
}

export type UiToWorker =
  | {
      type: 'open';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      file: Blob;
      options: OpenOptions;
    }
  | { type: 'cancel'; requestId: number; protocolVersion: typeof PROTOCOL_VERSION };

export type ErrorCode = 'GAR-PRO-001' | 'GAR-IO-001';

export type WorkerToUi =
  | {
      type: 'progress';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      bytesRead: number;
      totalBytes: number;
      lines: number;
    }
  | {
      type: 'ready';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      bytesRead: number;
      lines: number;
      maxLineBytes: number;
      elapsedMs: number;
    }
  | { type: 'cancelled'; requestId: number; protocolVersion: typeof PROTOCOL_VERSION }
  | {
      type: 'error';
      requestId: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      code: ErrorCode;
      message: string;
      details: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isUiToWorker(value: unknown): value is UiToWorker {
  if (!isRecord(value)) return false;
  if (value['protocolVersion'] !== PROTOCOL_VERSION) return false;
  if (!isSafeInt(value['requestId'])) return false;

  if (value['type'] === 'cancel') return true;

  if (value['type'] === 'open') {
    if (typeof Blob === 'undefined' || !(value['file'] instanceof Blob)) return false;
    const options = value['options'];
    if (!isRecord(options)) return false;
    const blockSize = options['blockSize'];
    return isSafeInt(blockSize) && blockSize >= MIN_BLOCK_SIZE && blockSize <= MAX_BLOCK_SIZE;
  }
  return false;
}

const WORKER_TYPES = new Set(['progress', 'ready', 'cancelled', 'error']);

export function isWorkerToUi(value: unknown): value is WorkerToUi {
  if (!isRecord(value)) return false;
  if (value['protocolVersion'] !== PROTOCOL_VERSION) return false;
  if (!isSafeInt(value['requestId'])) return false;
  const type = value['type'];
  if (typeof type !== 'string' || !WORKER_TYPES.has(type)) return false;

  switch (type) {
    case 'progress':
      return (
        isSafeInt(value['bytesRead']) && isSafeInt(value['totalBytes']) && isSafeInt(value['lines'])
      );
    case 'ready':
      return (
        isSafeInt(value['bytesRead']) &&
        isSafeInt(value['lines']) &&
        isSafeInt(value['maxLineBytes']) &&
        typeof value['elapsedMs'] === 'number'
      );
    case 'cancelled':
      return true;
    case 'error':
      return (
        typeof value['code'] === 'string' &&
        typeof value['message'] === 'string' &&
        typeof value['details'] === 'string'
      );
    default:
      return false;
  }
}
