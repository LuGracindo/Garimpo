// Worker isolado da busca por regex. Não guarda nada entre pedidos: recebe o padrão e o arquivo,
// devolve os deslocamentos das linhas que casam e dá sinal de vida a cada lote de linhas. Se uma
// linha travar o motor de regex, o sinal para e quem criou este Worker o derruba.

import { compilePattern, scanLines } from '../core/regex.ts';
import { readAlignedChunks } from './reader.ts';
import { REGEX_BLOCK_SIZE, type RegexReply, type RegexRequest } from './regex-scan.ts';

const scope = self as unknown as {
  postMessage(message: RegexReply): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

function isRequest(value: unknown): value is RegexRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['pattern'] === 'string' &&
    typeof v['caseSensitive'] === 'boolean' &&
    v['blob'] instanceof Blob
  );
}

async function run(request: RegexRequest): Promise<void> {
  const compiled = compilePattern(request.pattern, request.caseSensitive);
  if (!compiled.ok) {
    scope.postMessage({ type: 'invalid' });
    return;
  }
  for await (const chunk of readAlignedChunks(request.blob, REGEX_BLOCK_SIZE)) {
    let offsets: number[] = [];
    scanLines(
      chunk.bytes,
      chunk.startOffset,
      compiled.regex,
      (offset) => offsets.push(offset),
      () => {
        scope.postMessage({ type: 'beat', offsets });
        offsets = [];
      },
    );
  }
  scope.postMessage({ type: 'done' });
}

scope.onmessage = (event) => {
  if (isRequest(event.data)) void run(event.data);
};
