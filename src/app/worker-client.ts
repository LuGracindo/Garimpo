// Cliente do Worker de análise: abertura do arquivo e consultas com promessas.

import workerUrl from '../worker/worker.ts?worker&url';
import { createScriptUrl } from '../shared/trusted.ts';
import type { CustomProfileSpec, Preview } from '../core/custom-profile.ts';
import type { FingerprintInfo } from '../core/laudo.ts';
import type { CustomRule, HitKind, LacreType } from '../core/lacre.ts';
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
  custom?: CustomProfileSpec;
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

export interface LacreScanReply {
  counts: Record<string, number>;
  samples: { type: HitKind; antes: string; depois: string }[];
}

export interface AnalysisClient {
  open(file: Blob, choices?: OpenChoices): number;
  cancel(requestId: number): void;
  query(filter: Filter): Promise<QueryReply>;
  histogram(filter: Filter): Promise<Histogram>;
  occurrences(filter: Filter, start: number, count: number): Promise<OccurrencesReply>;
  context(event: number, before: number, after: number): Promise<ContextLine[]>;
  previewProfile(file: Blob, spec: CustomProfileSpec): Promise<Preview>;
  fingerprint(): Promise<FingerprintInfo>;
  lacreScan(types: LacreType[], custom: CustomRule[]): Promise<LacreScanReply>;
  /** Derruba o Worker (por exemplo, regex que travou) e cria outro; pedidos pendentes são cancelados. */
  restart(): void;
  dispose(): void;
}

interface Pending {
  resolve(message: WorkerToUi): void;
  reject(error: Error): void;
}

export function createAnalysisClient(onMessage: (message: WorkerToUi) => void): AnalysisClient {
  let nextRequestId = 1;
  const pending = new Map<number, Pending>();

  const handle = (event: MessageEvent<unknown>): void => {
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

  const spawn = (): Worker => {
    const created = new Worker(createScriptUrl(workerUrl), { type: 'module' });
    created.onmessage = handle;
    return created;
  };
  let worker = spawn();

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
    async previewProfile(file, spec) {
      const r = await ask((requestId) => ({
        type: 'preview-profile',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        file,
        spec,
      }));
      return r.type === 'preview-result' ? r.preview : unexpected();
    },
    async fingerprint() {
      const r = await ask((requestId) => ({
        type: 'fingerprint',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
      }));
      return r.type === 'fingerprint-result' ? r.fingerprint : unexpected();
    },
    async lacreScan(types, custom) {
      const r = await ask((requestId) => ({
        type: 'lacre-scan',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        types,
        custom,
      }));
      return r.type === 'lacre-scan-result'
        ? { counts: r.counts, samples: r.samples }
        : unexpected();
    },
    restart() {
      for (const waiting of pending.values()) waiting.reject(new RequestCancelled());
      pending.clear();
      worker.terminate();
      worker = spawn();
    },
    dispose() {
      for (const waiting of pending.values()) waiting.reject(new RequestCancelled());
      pending.clear();
      worker.terminate();
    },
  };
}
