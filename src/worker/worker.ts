// Worker de análise. No marco M0 ele só lê e conta linhas; o parser chega no M1.
// Tipagem mínima do escopo global do Worker, para não misturar as libs DOM e WebWorker.

import { PROTOCOL_VERSION, isUiToWorker, type WorkerToUi } from '../shared/protocol.ts';
import { scanLines } from './reader.ts';

const scope = self as unknown as {
  postMessage(message: WorkerToUi): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

let active: { requestId: number; cancelled: boolean } | null = null;

function post(message: WorkerToUi): void {
  scope.postMessage(message);
}

async function runOpen(requestId: number, file: Blob, blockSize: number): Promise<void> {
  if (active) active.cancelled = true;
  const job = { requestId, cancelled: false };
  active = job;
  const startedAt = performance.now();

  try {
    const result = await scanLines(file, {
      blockSize,
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

    if (result.cancelled) {
      post({ type: 'cancelled', requestId, protocolVersion: PROTOCOL_VERSION });
      return;
    }

    post({
      type: 'ready',
      requestId,
      protocolVersion: PROTOCOL_VERSION,
      bytesRead: result.bytesRead,
      lines: result.lines,
      maxLineBytes: result.maxLineBytes,
      elapsedMs: performance.now() - startedAt,
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

  void runOpen(message.requestId, message.file, message.options.blockSize);
};
