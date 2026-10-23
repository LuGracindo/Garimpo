// Worker de análise. Lê o arquivo em streaming, detecta o formato (ou usa o perfil escolhido),
// segmenta em eventos e agrupa em pepitas. Nunca envia trechos do arquivo em mensagens de erro.
// Tipagem mínima do escopo global do Worker, para não misturar as libs DOM e WebWorker.

import {
  PROTOCOL_VERSION,
  isUiToWorker,
  type OpenOptions,
  type WorkerToUi,
} from '../shared/protocol.ts';
import { analyzeBlob } from './analyze-file.ts';

const scope = self as unknown as {
  postMessage(message: WorkerToUi): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

let active: { requestId: number; cancelled: boolean } | null = null;

function post(message: WorkerToUi): void {
  scope.postMessage(message);
}

async function runOpen(requestId: number, file: Blob, options: OpenOptions): Promise<void> {
  if (active) active.cancelled = true;
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

  void runOpen(message.requestId, message.file, message.options);
};
