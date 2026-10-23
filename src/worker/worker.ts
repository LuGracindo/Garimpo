// Worker de análise. Lê o arquivo em streaming, detecta o formato (ou usa o perfil escolhido),
// segmenta em eventos e agrupa em pepitas. Nunca envia trechos do arquivo em mensagens de erro.
// Tipagem mínima do escopo global do Worker, para não misturar as libs DOM e WebWorker.

import {
  PROTOCOL_VERSION,
  isUiToWorker,
  type OpenOptions,
  type UiToWorker,
  type WorkerToUi,
} from '../shared/protocol.ts';
import { analyzeBlob } from './analyze-file.ts';
import { Session, Superseded } from './session.ts';

const scope = self as unknown as {
  postMessage(message: WorkerToUi): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

let active: { requestId: number; cancelled: boolean } | null = null;
let session: Session | null = null;
/** Último pedido de cada tipo de consulta: respostas de pedidos antigos viram 'cancelled'. */
const latest = new Map<string, number>();

function post(message: WorkerToUi): void {
  scope.postMessage(message);
}

async function runOpen(requestId: number, file: Blob, options: OpenOptions): Promise<void> {
  if (active) active.cancelled = true;
  session?.dispose();
  session = null;
  latest.clear();
  const job = { requestId, cancelled: false };
  active = job;
  const startedAt = performance.now();

  try {
    const outcome = await analyzeBlob(file, {
      blockSize: options.blockSize,
      profile: options.profile,
      mode: options.mode,
      isCancelled: () => job.cancelled,
      onProgress: (p) =>
        post({
          type: 'progress',
          requestId,
          protocolVersion: PROTOCOL_VERSION,
          bytesRead: p.bytesRead,
          totalBytes: p.totalBytes,
          lines: p.lines,
        }),
    });

    if (outcome.kind === 'cancelled') {
      post({ type: 'cancelled', requestId, protocolVersion: PROTOCOL_VERSION });
      return;
    }

    if (outcome.kind === 'needs-profile') {
      post({
        type: 'needs-profile',
        requestId,
        protocolVersion: PROTOCOL_VERSION,
        candidates: outcome.candidates,
      });
      return;
    }

    session = new Session(file, outcome.analyzer, outcome.result);
    post({
      type: 'ready',
      requestId,
      protocolVersion: PROTOCOL_VERSION,
      bytesRead: outcome.bytesRead,
      lines: outcome.result.summary.lines,
      maxLineBytes: outcome.result.summary.maxLineBytes,
      elapsedMs: performance.now() - startedAt,
      analysis: outcome.result,
    });
  } catch (error) {
    // SEG-19: só o nome do erro, nunca conteúdo do arquivo.
    post({
      type: 'error',
      requestId,
      protocolVersion: PROTOCOL_VERSION,
      code: 'GAR-IO-001',
      message: 'Não foi possível ler o arquivo.',
      details: error instanceof Error ? error.name : 'Erro desconhecido',
    });
  } finally {
    if (active === job) active = null;
  }
}

async function runQuery(message: Exclude<UiToWorker, { type: 'open' | 'cancel' }>): Promise<void> {
  const requestId = message.requestId;
  const kind = message.type;
  latest.set(kind, requestId);
  const stale = (): boolean => latest.get(kind) !== requestId;
  const current = session;
  if (!current) {
    post({ type: 'cancelled', requestId, protocolVersion: PROTOCOL_VERSION });
    return;
  }
  try {
    let reply: WorkerToUi;
    if (message.type === 'query') {
      const r = await current.query(message.filter);
      reply = { type: 'query-result', requestId, protocolVersion: PROTOCOL_VERSION, ...r };
    } else if (message.type === 'histogram') {
      const histogram = await current.histogram(message.filter);
      reply = { type: 'histogram-result', requestId, protocolVersion: PROTOCOL_VERSION, histogram };
    } else if (message.type === 'occurrences') {
      const r = await current.occurrences(message.filter, message.start, message.count);
      reply = { type: 'occurrences-result', requestId, protocolVersion: PROTOCOL_VERSION, ...r };
    } else {
      const lines = await current.context(message.event, message.before, message.after);
      reply = { type: 'context-result', requestId, protocolVersion: PROTOCOL_VERSION, lines };
    }
    if (stale() || session !== current) {
      post({ type: 'cancelled', requestId, protocolVersion: PROTOCOL_VERSION });
      return;
    }
    post(reply);
  } catch (error) {
    if (error instanceof Superseded || stale() || session !== current) {
      post({ type: 'cancelled', requestId, protocolVersion: PROTOCOL_VERSION });
      return;
    }
    post({
      type: 'error',
      requestId,
      protocolVersion: PROTOCOL_VERSION,
      code: 'GAR-IO-001',
      message: 'Não foi possível consultar o arquivo.',
      details: error instanceof Error ? error.name : 'Erro desconhecido',
    });
  }
}

scope.onmessage = (event) => {
  const message = event.data;

  if (!isUiToWorker(message)) {
    post({
      type: 'error',
      requestId: 0,
      protocolVersion: PROTOCOL_VERSION,
      code: 'GAR-PRO-001',
      message: 'Mensagem inválida recebida pelo Worker.',
      details: 'protocolo',
    });
    return;
  }

  if (message.type === 'cancel') {
    if (active && active.requestId === message.requestId) active.cancelled = true;
    return;
  }

  if (message.type === 'open') {
    void runOpen(message.requestId, message.file, message.options);
    return;
  }

  void runQuery(message);
};
