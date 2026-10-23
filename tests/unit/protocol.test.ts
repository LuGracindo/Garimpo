import { describe, expect, it } from 'vitest';
import { Analyzer } from '../../src/core/analyzer.ts';
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

  it('valida as escolhas de perfil e modo na abertura', () => {
    const com = (options: object) => ({
      ...open,
      options: { blockSize: 4 * 1024 * 1024, ...options },
    });
    expect(isUiToWorker(com({ profile: 'jsonl', mode: 'agressivo' }))).toBe(true);
    expect(isUiToWorker(com({ profile: 'xml' }))).toBe(false);
    expect(isUiToWorker(com({ mode: 'ousado' }))).toBe(false);
  });

  it('valida a resposta pronta, inclusive o resultado da análise', () => {
    const analyzer = new Analyzer({ profile: 'iso-level' });
    analyzer.feed(new TextEncoder().encode('2026-10-22T14:00:00Z ERROR [t] a.B - falha 1\n'), 0);
    const analysis = analyzer.finish();
    const ready = {
      type: 'ready',
      requestId: 1,
      protocolVersion: 1,
      bytesRead: 10,
      lines: 1,
      maxLineBytes: 10,
      elapsedMs: 3,
      analysis,
    };
    expect(isWorkerToUi(ready)).toBe(true);
    expect(isWorkerToUi({ ...ready, analysis: undefined })).toBe(false);
    expect(isWorkerToUi({ ...ready, analysis: { summary: {}, nuggets: [] } })).toBe(false);
    const quebrado = { ...analysis, nuggets: [{ ...analysis.nuggets[0], count: -1 }] };
    expect(isWorkerToUi({ ...ready, analysis: quebrado })).toBe(false);
  });

  it('valida o pedido de escolha de formato', () => {
    const base = { type: 'needs-profile', requestId: 1, protocolVersion: 1 };
    expect(isWorkerToUi({ ...base, candidates: [{ profile: 'jsonl', score: 0.4 }] })).toBe(true);
    expect(isWorkerToUi({ ...base, candidates: [{ profile: 'xml', score: 0.4 }] })).toBe(false);
    expect(isWorkerToUi({ ...base, candidates: 'jsonl' })).toBe(false);
  });
});
