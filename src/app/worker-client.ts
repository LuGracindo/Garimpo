// Criação do Worker compatível com Trusted Types (CSP: require-trusted-types-for 'script').
// Com Trusted Types ativo, `new Worker(url)` exige um TrustedScriptURL; a política abaixo só
// aceita URLs da mesma origem. A política se chama "garimpo-worker" e a CSP permite só esse nome.

import workerUrl from '../worker/worker.ts?worker&url';
import type { NormalizationMode, ProfileId } from '../core/types.ts';
import {
  DEFAULT_BLOCK_SIZE,
  PROTOCOL_VERSION,
  isWorkerToUi,
  type UiToWorker,
  type WorkerToUi,
} from '../shared/protocol.ts';

interface TrustedTypesApi {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): { createScriptURL(input: string): unknown };
}

function createScriptUrl(url: string): string {
  const api = (window as unknown as { trustedTypes?: TrustedTypesApi }).trustedTypes;
  if (!api) return url;

  const policy = api.createPolicy('garimpo-worker', {
    createScriptURL: (input) => {
      const resolved = new URL(input, window.location.href);
      if (resolved.origin !== window.location.origin) {
        throw new TypeError('URL de Worker fora da origem do aplicativo.');
      }
      return resolved.href;
    },
  });
  return policy.createScriptURL(url) as unknown as string;
}

export interface OpenChoices {
  profile?: ProfileId;
  mode?: NormalizationMode;
}

export interface AnalysisClient {
  open(file: Blob, choices?: OpenChoices): number;
  cancel(requestId: number): void;
  dispose(): void;
}

export function createAnalysisClient(onMessage: (message: WorkerToUi) => void): AnalysisClient {
  const worker = new Worker(createScriptUrl(workerUrl), { type: 'module' });
  let nextRequestId = 1;

  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (isWorkerToUi(event.data)) onMessage(event.data);
  };

  const send = (message: UiToWorker): void => worker.postMessage(message);

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
    dispose() {
      worker.terminate();
    },
  };
}
