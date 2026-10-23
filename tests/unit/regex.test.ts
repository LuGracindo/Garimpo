import { describe, expect, it } from 'vitest';
import { generateLines } from '../../fixtures/generator.ts';
import { EMPTY_FILTER } from '../../src/core/filter.ts';
import {
  MAX_PATTERN_LENGTH,
  compilePattern,
  hasNestedQuantifier,
  scanLines,
} from '../../src/core/regex.ts';
import { analyzeBlob } from '../../src/worker/analyze-file.ts';
import {
  RegexInvalid,
  RegexTimeout,
  createWorkerScanner,
  type RegexRequest,
  type WorkerLike,
} from '../../src/worker/regex-scan.ts';
import { Session } from '../../src/worker/session.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('regex segura (@RF-25, @SEG-12)', () => {
  it('compila com ou sem diferenciar maiúsculas e recusa padrão vazio, longo ou inválido', () => {
    const livre = compilePattern('erro', false);
    const exato = compilePattern('erro', true);
    expect(livre.ok && livre.regex.test('ERRO')).toBe(true);
    expect(exato.ok && exato.regex.test('ERRO')).toBe(false);
    expect(compilePattern('', false)).toEqual({ ok: false, problem: 'vazio' });
    expect(compilePattern('a'.repeat(MAX_PATTERN_LENGTH + 1), false)).toEqual({
      ok: false,
      problem: 'longo',
    });
    expect(compilePattern('(', false)).toEqual({ ok: false, problem: 'sintaxe' });
  });

  it('avisa de quantificadores aninhados, sem acusar padrões comuns', () => {
    expect(hasNestedQuantifier('(a+)+')).toBe(true);
    expect(hasNestedQuantifier('(x*)*$')).toBe(true);
    expect(hasNestedQuantifier('^(\\w+\\s?)*$')).toBe(true);
    expect(hasNestedQuantifier('(a|b)+')).toBe(false);
    expect(hasNestedQuantifier('a+b+')).toBe(false);
    expect(hasNestedQuantifier('ERROR.*(timeout|falha)')).toBe(false);
  });

  it('scanLines devolve o deslocamento em bytes do início de cada linha que casa', () => {
    const texto = 'ação ok\r\nfalha 1\nsem\nfalha 2';
    const regex = /falha/;
    const hits: number[] = [];
    let batches = 0;
    scanLines(
      bytes(texto),
      100,
      regex,
      (o) => hits.push(o),
      () => (batches += 1),
    );
    const primeira = 100 + bytes('ação ok\r\n').length;
    const segunda = primeira + bytes('falha 1\nsem\n').length;
    expect(hits).toEqual([primeira, segunda]);
    expect(batches).toBeGreaterThan(0);
  });

  const log = `${[...generateLines({ profile: 'iso-level', seed: 21, maxEvents: 2000 })].join('\n')}\n`;

  async function abrir() {
    const blob = new Blob([log]);
    const out = await analyzeBlob(blob, { blockSize: 64 * 1024, profile: 'iso-level' });
    if (out.kind !== 'ready') throw new Error('análise não concluiu');
    return new Session(blob, out.analyzer, out.result);
  }

  it('o filtro por regex concorda com o texto literal quando o padrão é literal', async () => {
    const session = await abrir();
    const literal = await session.query({ ...EMPTY_FILTER, text: 'Timeout' });
    const regex = await session.query({ ...EMPTY_FILTER, text: 'Timeout', regex: true });
    expect(regex.total).toBe(literal.total);
    expect(regex.total).toBeGreaterThan(0);
  });

  it('a regex combina alternativas e âncoras linha a linha', async () => {
    const session = await abrir();
    const a = await session.query({ ...EMPTY_FILTER, text: '^\\S+ ERROR ', regex: true });
    const erros = await session.query({ ...EMPTY_FILTER, levels: ['ERROR'] });
    expect(a.total).toBe(erros.total);
    const alt = await session.query({ ...EMPTY_FILTER, text: 'Timeout|Pagamento', regex: true });
    expect(alt.total).toBeGreaterThan(0);
  });

  it('regex inválida lança RegexInvalid', async () => {
    const session = await abrir();
    let erro: unknown;
    try {
      await session.query({ ...EMPTY_FILTER, text: '(', regex: true });
    } catch (e) {
      erro = e;
    }
    expect(erro instanceof RegexInvalid).toBe(true);
  });
});

function fakeWorker(script: (reply: (data: unknown) => void, request: RegexRequest) => void) {
  let terminated = 0;
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(request) {
      script((data) => worker.onmessage?.({ data }), request);
    },
    terminate() {
      terminated += 1;
    },
  };
  return { worker, terminated: () => terminated };
}

describe('Worker de regex com prazo (@SEG-12)', () => {
  const blob = new Blob(['x']);

  it('entrega os acertos e encerra o Worker ao terminar', async () => {
    const fake = fakeWorker((reply) => {
      reply({ type: 'beat', offsets: [1, 5] });
      reply({ type: 'beat', offsets: [9] });
      reply({ type: 'done' });
    });
    const got: number[] = [];
    await createWorkerScanner(blob, () => fake.worker, 100).scan(
      'x',
      false,
      (o) => got.push(...o),
      () => false,
    );
    expect(got).toEqual([1, 5, 9]);
    expect(fake.terminated()).toBe(1);
  });

  it('derruba o Worker que fica sem dar sinal de vida (regex catastrófica)', async () => {
    const fake = fakeWorker(() => {
      /* nunca responde */
    });
    let erro: unknown;
    try {
      await createWorkerScanner(blob, () => fake.worker, 30).scan(
        '(a+)+$',
        false,
        () => {},
        () => false,
      );
    } catch (e) {
      erro = e;
    }
    expect(erro instanceof RegexTimeout).toBe(true);
    expect(fake.terminated()).toBe(1);
  });

  it('o sinal de vida renova o prazo: varredura longa mas ativa não estoura', async () => {
    const fake = fakeWorker((reply) => {
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        reply({ type: 'beat', offsets: [] });
        if (n === 6) {
          clearInterval(timer);
          reply({ type: 'done' });
        }
      }, 15);
    });
    await createWorkerScanner(blob, () => fake.worker, 40).scan(
      'x',
      false,
      () => {},
      () => false,
    );
    expect(fake.terminated()).toBe(1);
  });

  it('traduz "invalid" e ignora mensagens fora do formato', async () => {
    const fake = fakeWorker((reply) => {
      reply({ lixo: true });
      reply({ type: 'invalid' });
    });
    let erro: unknown;
    try {
      await createWorkerScanner(blob, () => fake.worker, 100).scan(
        '(',
        false,
        () => {},
        () => false,
      );
    } catch (e) {
      erro = e;
    }
    expect(erro instanceof RegexInvalid).toBe(true);
  });
});
