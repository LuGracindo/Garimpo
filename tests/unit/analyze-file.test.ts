import { describe, expect, it } from 'vitest';
import { generateLines } from '../../fixtures/generator.ts';
import { analyzeBlob, readSample } from '../../src/worker/analyze-file.ts';

const blobDe = (texto: string): Blob => new Blob([texto]);

describe('análise de arquivo (@RF-10, @RF-11)', () => {
  const log = `${[...generateLines({ profile: 'iso-level', seed: 1, maxEvents: 2000 })].join('\n')}\n`;

  it('detecta o formato, analisa e informa a confiança', async () => {
    const outcome = await analyzeBlob(blobDe(log), { blockSize: 64 * 1024 });
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.result.summary.profile).toBe('iso-level');
    expect(outcome.result.summary.profileSource).toBe('auto');
    expect(outcome.result.summary.confidence).toBeGreaterThan(0.6);
    expect(outcome.result.summary.events).toBe(2000);
  });

  it('formato incerto devolve as alternativas em vez de adivinhar', async () => {
    const outcome = await analyzeBlob(blobDe('abc\ndef\nghi\n'), { blockSize: 64 * 1024 });
    expect(outcome.kind).toBe('needs-profile');
    if (outcome.kind !== 'needs-profile') return;
    expect(outcome.candidates).toHaveLength(3);
  });

  it('perfil escolhido pela pessoa dispensa a detecção (@RF-11)', async () => {
    const outcome = await analyzeBlob(blobDe('abc\ndef\n'), {
      blockSize: 64 * 1024,
      profile: 'jsonl',
    });
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.result.summary.profileSource).toBe('manual');
    expect(outcome.result.summary.unparsed).toBe(0);
    expect(outcome.result.summary.headerLines).toBe(2);
  });

  it('cancelar interrompe sem devolver resultado parcial', async () => {
    let chamadas = 0;
    const outcome = await analyzeBlob(blobDe(log), {
      blockSize: 64 * 1024,
      isCancelled: () => {
        chamadas += 1;
        return chamadas > 2;
      },
    });
    expect(outcome.kind).toBe('cancelled');
  });

  it('arquivo vazio gera resultado vazio, sem erro', async () => {
    const outcome = await analyzeBlob(blobDe(''), { blockSize: 64 * 1024 });
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.result.summary.events).toBe(0);
  });

  it('a amostra ignora linhas vazias e descarta a última linha cortada', async () => {
    const grande = `a\n\n${'b'.repeat(2 * 1024 * 1024)}`;
    const sample = await readSample(blobDe(grande));
    expect(sample).toEqual(['a']);
  });

  it('o tamanho do bloco não muda o resultado', async () => {
    const a = await analyzeBlob(blobDe(log), { blockSize: 64 * 1024, profile: 'iso-level' });
    const b = await analyzeBlob(blobDe(log), { blockSize: 1024 * 1024, profile: 'iso-level' });
    expect(a.kind).toBe('ready');
    expect(b).toEqual(a);
  });
});
