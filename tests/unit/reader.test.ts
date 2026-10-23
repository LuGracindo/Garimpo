import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readAlignedChunks, scanLines } from '../../src/worker/reader.ts';

function naive(data: Uint8Array): { lines: number; max: number } {
  let newlines = 0;
  let current = 0;
  let max = 0;
  for (const byte of data) {
    if (byte === 0x0a) {
      newlines += 1;
      max = Math.max(max, current);
      current = 0;
    } else current += 1;
  }
  max = Math.max(max, current);
  const trailing = data.length > 0 && data[data.length - 1] !== 0x0a ? 1 : 0;
  return { lines: newlines + trailing, max };
}

// bytes com muitas quebras de linha, ASCII e UTF-8 multibyte
const bytes = fc.array(fc.constantFrom(0x0a, 0x0a, 0x61, 0x62, 0xc3, 0xa7, 0x20, 0x0d), {
  maxLength: 300,
});

describe('leitor em streaming (@RF-02, @RNF-03)', () => {
  it('conta linhas e maior linha igual a uma leitura ingênua, em qualquer tamanho de bloco', async () => {
    await fc.assert(
      fc.asyncProperty(bytes, fc.integer({ min: 1, max: 64 }), async (list, blockSize) => {
        const data = Uint8Array.from(list);
        const result = await scanLines(new Blob([data]), { blockSize });
        const expected = naive(data);
        expect(result.lines).toBe(expected.lines);
        expect(result.maxLineBytes).toBe(expected.max);
        expect(result.bytesRead).toBe(data.length);
      }),
    );
  });

  it('entrega pedaços contíguos, alinhados à quebra de linha, que reconstituem o arquivo', async () => {
    await fc.assert(
      fc.asyncProperty(bytes, fc.integer({ min: 1, max: 64 }), async (list, blockSize) => {
        const data = Uint8Array.from(list);
        const chunks = [];
        for await (const chunk of readAlignedChunks(new Blob([data]), blockSize)) chunks.push(chunk);

        let expectedStart = 0;
        const parts: number[] = [];
        chunks.forEach((chunk, index) => {
          expect(chunk.startOffset).toBe(expectedStart);
          expectedStart = chunk.endOffset;
          if (index < chunks.length - 1) expect(chunk.bytes[chunk.bytes.length - 1]).toBe(0x0a);
          parts.push(...chunk.bytes);
        });
        expect(Uint8Array.from(parts)).toEqual(data);
      }),
    );
  });

  it('arquivo vazio tem zero linhas', async () => {
    const result = await scanLines(new Blob([]), { blockSize: 16 });
    expect(result.lines).toBe(0);
  });

  it('cancela entre blocos sem ler o arquivo inteiro', async () => {
    let calls = 0;
    const blob = new Blob([new Uint8Array(10_000).fill(0x0a)]);
    const result = await scanLines(blob, { blockSize: 100, isCancelled: () => ++calls > 3 });
    expect(result.cancelled).toBe(true);
    expect(result.bytesRead).toBeLessThan(10_000);
  });

  it('rejeita tamanho de bloco inválido', async () => {
    await expect(scanLines(new Blob(['a']), { blockSize: 0 })).rejects.toThrow(RangeError);
  });
});
