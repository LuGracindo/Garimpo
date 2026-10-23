// Cliente do Worker de análise: abertura do arquivo e consultas com promessas.

import workerUrl from '../worker/worker.ts?worker&url';
import { createScriptUrl } from '../shared/trusted.ts';
import type { ContextLine } from '../core/context.ts';
import type { Filter } from '../core/filter.ts';
import type { Histogram } from '../core/histogram.ts';
import type { NormalizationMode, ProfileId } from '../core/types.ts';
import {
  DEFAULT_BLOCK_SIZE,
  PROTOCOL_VERSION,
  isWorkerToUi,
  type OccurrenceRowMessage,
  type UiToWorker,
  type WorkerToUi,
} from '../shared/protocol.ts';

export interface OpenChoices {
  profile?: ProfileId;
  mode?: NormalizationMode;
}

export interface QueryReply {
  total: number;
  nuggetCounts: [number, number][];
}

export interface OccurrencesReply {
  total: number;
  start: number;
  rows: OccurrenceRowMessage[];
}

/** O Worker respondeu com erro: `code` diz qual (ex.: GAR-RGX-002, regex acima do prazo). */
export class RequestFailed extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RequestFailed';
    this.code = code;
  }
}

/** Pedido substituído por outro mais novo, ou descartado: a interface deve ignorar. */
export class RequestCancelled extends Error {
  constructor() {
    super('cancelado');
    this.name = 'RequestCancelled';
  }
}

export interface AnalysisClient {
  open(file: Blob, choices?: OpenChoices): number;
  cancel(requestId: number): void;
  query(filter: Filter): Promise<QueryReply>;
  histogram(filter: Filter): Promise<Histogram>;
  occurrences(filter: Filter, start: number, count: number): Promise<OccurrencesReply>;
  context(event: number, before: number, after: number): Promise<ContextLine[]>;
  dispose(): void;
}

interface Pending {
  resolve(message: WorkerToUi): void;
  reject(error: Error): void;
}

export function createAnalysisClient(onMessage: (message: WorkerToUi) => void): AnalysisClient {
  const worker = new Worker(createScriptUrl(workerUrl), { type: 'module' });
  let nextRequestId = 1;
  const pending = new Map<number, Pending>();

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!isWorkerToUi(data)) return;
    const waiting = pending.get(data.requestId);
    if (waiting) {
      pending.delete(data.requestId);
      if (data.type === 'cancelled') waiting.reject(new RequestCancelled());
      else if (data.type === 'error') waiting.reject(new RequestFailed(data.code, data.message));
      else waiting.resolve(data);
      return;
    }
    onMessage(data);
  };

  const send = (message: UiToWorker): void => worker.postMessage(message);

  const ask = (build: (requestId: number) => UiToWorker): Promise<WorkerToUi> => {
    const requestId = nextRequestId;
    nextRequestId += 1;
    return new Promise<WorkerToUi>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      send(build(requestId));
    });
  };

  const unexpected = (): never => {
    throw new Error('Resposta inesperada do Worker.');
  };

  return {
    open(file, choices = {}) {
      const requestId = nextRequestId;
      nextRequestId += 1;
      send({
        type: 'open',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        file,
        options: { blockSize: DEFAULT_BLOCK_SIZE, ...choices },
      });
      return requestId;
    },
    cancel(requestId) {
      send({ type: 'cancel', requestId, protocolVersion: PROTOCOL_VERSION });
    },
    async query(filter) {
      const r = await ask((requestId) => ({
        type: 'query',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        filter,
      }));
      return r.type === 'query-result'
        ? { total: r.total, nuggetCounts: r.nuggetCounts }
        : unexpected();
    },
    async histogram(filter) {
      const r = await ask((requestId) => ({
        type: 'histogram',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        filter,
      }));
      return r.type === 'histogram-result' ? r.histogram : unexpected();
    },
    async occurrences(filter, start, count) {
      const r = await ask((requestId) => ({
        type: 'occurrences',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        filter,
        start,
        count,
      }));
      return r.type === 'occurrences-result'
        ? { total: r.total, start: r.start, rows: r.rows }
        : unexpected();
    },
    async context(event, before, after) {
      const r = await ask((requestId) => ({
        type: 'context',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        event,
        before,
        after,
      }));
      return r.type === 'context-result' ? r.lines : unexpected();
    },
    dispose() {
      for (const waiting of pending.values()) waiting.reject(new RequestCancelled());
      pending.clear();
      worker.terminate();
    },
  };
}
