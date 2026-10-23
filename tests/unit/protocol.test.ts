import { describe, expect, it } from 'vitest';
import { isUiToWorker, isWorkerToUi } from '../../src/shared/protocol.ts';

const open = {
  type: 'open',
  requestId: 1,
  protocolVersion: 1,
  file: new Blob(['x']),
  options: { blockSize: 4 * 1024 * 1024 },
};

describe('protocolo UI e Worker (@SEG-08)', () => {
  it('aceita mensagens válidas', () => {
    expect(isUiToWorker(open)).toBe(true);
    expect(isUiToWorker({ type: 'cancel', requestId: 0, protocolVersion: 1 })).toBe(true);
  });

  it('rejeita versão, tipo, arquivo e tamanho de bloco inválidos', () => {
    expect(isUiToWorker({ ...open, protocolVersion: 2 })).toBe(false);
    expect(isUiToWorker({ ...open, file: 'texto' })).toBe(false);
    expect(isUiToWorker({ ...open, options: { blockSize: 1 } })).toBe(false);
    expect(isUiToWorker({ type: 'eval', requestId: 1, protocolVersion: 1 })).toBe(false);
    expect(isUiToWorker(null)).toBe(false);
    expect(isUiToWorker('open')).toBe(false);
  });

  it('valida as respostas do Worker', () => {
    expect(
      isWorkerToUi({
        type: 'progress',
        requestId: 1,
        protocolVersion: 1,
        bytesRead: 1,
        totalBytes: 2,
        lines: 3,
      }),
    ).toBe(true);
    expect(
      isWorkerToUi({
        type: 'progress',
        requestId: 1,
        protocolVersion: 1,
        bytesRead: -1,
        totalBytes: 2,
        lines: 3,
      }),
    ).toBe(false);
    expect(isWorkerToUi({ type: 'qualquer', requestId: 1, protocolVersion: 1 })).toBe(false);
  });
});
