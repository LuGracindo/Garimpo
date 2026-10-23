// Robustez (M4): entradas aleatórias e hostis não derrubam o núcleo, e as invariantes se mantêm.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { escapeHtml, unescapeHtml } from '../../src/core/escape.ts';
import { LACRE_TYPES, Lacre, findSensitive } from '../../src/core/lacre.ts';
import {
  buildLaudo,
  extractLaudoFromHtml,
  isLaudo,
  renderLaudoHtml,
  sealLaudo,
  verifyLaudo,
} from '../../src/core/laudo.ts';
import { normalizeMessage } from '../../src/core/normalize.ts';
import { PROFILE_IDS } from '../../src/core/types.ts';
import { analyzeBlob } from '../../src/worker/analyze-file.ts';
import { fingerprintBlob, sha256Hex } from '../../src/worker/fingerprint.ts';

const CONTROLE = new RegExp(
  [
    '[',
    '\\u0000-\\u0008',
    '\\u000b\\u000c',
    '\\u000e-\\u001f',
    '\\u007f-\\u009f',
    '\\u2028\\u2029',
    ']',
  ].join(''),
  'g',
);

const RUNS = 40;

const ALNUM = [...'abcdefghijklmnopqrstuvwxyz0123456789'];
const palavra = (alfabeto: string[], min: number, max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...alfabeto), { minLength: min, maxLength: max }).map((x) => x.join(''));
const email = (): fc.Arbitrary<string> =>
  fc
    .array(palavra(ALNUM, 1, 10), { minLength: 3, maxLength: 3 })
    .map(
      ([a, b, c]) => `${a ?? 'a'}@${b ?? 'b'}.${(c ?? 'cc').replace(/\d/g, 'x').padEnd(2, 'x')}`,
    );

function aleatorio(maxLines: number): fc.Arbitrary<string> {
  return fc
    .array(fc.string({ maxLength: 160 }), { maxLength: maxLines })
    .map((lines) => lines.join('\n'));
}

describe('análise com texto aleatório (@RNF-ROB)', () => {
  for (const profile of PROFILE_IDS) {
    it(`perfil ${profile}: não lança e os contadores fecham`, async () => {
      await fc.assert(
        fc.asyncProperty(aleatorio(60), async (text) => {
          const blob = new Blob([text]);
          const out = await analyzeBlob(blob, { blockSize: 64, profile });
          if (out.kind !== 'ready') throw new Error(`desfecho inesperado: ${out.kind}`);
          const s = out.result.summary;
          const porNivel = Object.values(s.severityCounts).reduce((a, b) => a + b, 0);
          expect(porNivel).toBe(s.events);
          const porPepita = out.result.nuggets.reduce((a, n) => a + n.count, 0);
          if (out.result.nuggets.length === s.nuggetCount) expect(porPepita).toBe(s.events);
          expect(s.events).toBeLessThanOrEqual(s.lines);
        }),
        { numRuns: RUNS },
      );
    });
  }

  it('o tamanho do bloco de leitura não muda o resultado em entradas aleatórias', async () => {
    await fc.assert(
      fc.asyncProperty(aleatorio(40), fc.integer({ min: 1, max: 97 }), async (text, block) => {
        const a = await analyzeBlob(new Blob([text]), { blockSize: 1 << 20, profile: 'iso-level' });
        const b = await analyzeBlob(new Blob([text]), { blockSize: block, profile: 'iso-level' });
        if (a.kind !== 'ready' || b.kind !== 'ready') throw new Error('não concluiu');
        expect(b.result).toEqual(a.result);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Lacre com texto aleatório (@SEG-16)', () => {
  const todos = new Set(LACRE_TYPES);

  it('nunca lança e a segunda passada não muda nada', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (text) => {
        const lacre = new Lacre(todos);
        const once = lacre.mask(text);
        expect(new Lacre(todos).mask(once)).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  it('e-mails plantados no meio do texto somem da saída', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }),
        email(),
        fc.string({ maxLength: 60 }),
        (a, mail, b) => {
          const saida = new Lacre(new Set(['email'] as const)).mask(`${a} ${mail} ${b}`);
          expect(saida.includes(mail)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('o mesmo valor recebe sempre o mesmo marcador', () => {
    const lacre = new Lacre(new Set(['email'] as const));
    const a = lacre.mask('x ana@empresa.com y bia@empresa.com z ana@empresa.com');
    expect(a).toBe('x <EMAIL_1> y <EMAIL_2> z <EMAIL_1>');
  });
});

describe('escape de HTML (@SEG-04)', () => {
  it('a saída não tem marcação solta em nenhum contexto e volta ao original', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        for (const contexto of ['texto', 'atributo'] as const) {
          const saida = escapeHtml(text, contexto);
          expect(saida).not.toMatch(/[<>"'`=/]/);
          expect(saida).not.toMatch(/&(?!#?\w+;)/);
        }
        const semControle = text.replace(CONTROLE, '\ufffd');
        expect(unescapeHtml(escapeHtml(text))).toBe(semControle);
      }),
      { numRuns: 300 },
    );
  });
});

describe('laudo com logs aleatórios (@AUD-01)', () => {
  it('ida e volta pelo HTML preserva o selo e qualquer alteração o quebra', async () => {
    await fc.assert(
      fc.asyncProperty(aleatorio(30), fc.integer({ min: 0, max: 5000 }), async (text, posicao) => {
        const blob = new Blob([text]);
        const out = await analyzeBlob(blob, { blockSize: 128, profile: 'iso-level' });
        const fp = await fingerprintBlob(blob, { blockSize: 128 });
        if (out.kind !== 'ready' || !fp) throw new Error('não concluiu');
        const laudo = await sealLaudo(
          buildLaudo({
            build: { nome: 'Garimpo', versao: '0.0.0', build: 'teste' },
            generatedAt: '2026-10-22T20:00:00.000Z',
            jazida: {
              nome: `${text.slice(0, 20)}.log`,
              tamanho: blob.size,
              modificadoEm: null,
              impressaoDigital: fp,
            },
            analysis: out.result,
            custom: null,
            lacre: new Lacre(new Set(LACRE_TYPES)),
          }),
          sha256Hex,
        );
        const html = renderLaudoHtml(laudo);
        expect(html).not.toMatch(/<script/i);
        const volta = extractLaudoFromHtml(html);
        if (!isLaudo(volta)) throw new Error('laudo não reconhecido');
        expect((await verifyLaudo(volta, sha256Hex)).ok).toBe(true);

        // Altera um dígito qualquer do JSON (continua JSON válido): o selo tem de acusar.
        const json = JSON.stringify(laudo);
        const digitos = [...json.matchAll(/\d/g)].map((m) => m.index ?? 0);
        const i = digitos[posicao % digitos.length];
        if (i === undefined) return;
        const novo = json[i] === '9' ? '8' : String(Number(json[i]) + 1);
        const adulterado = JSON.parse(`${json.slice(0, i)}${novo}${json.slice(i + 1)}`) as unknown;
        if (!isLaudo(adulterado)) return;
        expect((await verifyLaudo(adulterado, sha256Hex)).ok).toBe(false);
      }),
      { numRuns: 25 },
    );
  });
});

describe('tempo das regexes embutidas com entradas hostis (@SEG-ReDoS)', () => {
  const N = 30_000;
  const hostis: [string, string][] = [
    ['arrobas', '@a'.repeat(N / 2)],
    ['pontos e dígitos', '1.'.repeat(N / 2)],
    ['zeros', '0'.repeat(N)],
    ['hex quase válido', 'ab'.repeat(N / 2)],
    ['token quase válido', 'aA1_-'.repeat(N / 5)],
    ['jwt incompleto', `eyJ${'a'.repeat(N)}.${'b'.repeat(N)}`],
    ['ips incompletos', '255.255.255.'.repeat(N / 12)],
    ['espaços', ' '.repeat(N) + 'x'],
    ['barras e dois-pontos', 'a/b:'.repeat(N / 4)],
    ['aspas abertas', '"'.repeat(N)],
    ['cartão quase válido', '4111 '.repeat(N / 5)],
  ];

  for (const [nome, texto] of hostis) {
    it(`normalização e Lacre terminam rápido: ${nome}`, () => {
      const inicio = performance.now();
      normalizeMessage(texto, 'agressivo');
      new Lacre(new Set(LACRE_TYPES)).mask(texto);
      findSensitive(texto, new Set(LACRE_TYPES));
      expect(performance.now() - inicio).toBeLessThan(2000);
    });
  }
});
