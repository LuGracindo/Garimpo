import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateLines } from '../../fixtures/generator.ts';
import { canonicalJson } from '../../src/core/canonical.ts';
import { escapeHtml, truncate, unescapeHtml } from '../../src/core/escape.ts';
import { LACRE_DEFAULT_TYPES, Lacre } from '../../src/core/lacre.ts';
import {
  buildLaudo,
  extractLaudoFromHtml,
  isLaudo,
  renderLaudoHtml,
  sealLaudo,
  verifyLaudo,
  type LaudoInput,
} from '../../src/core/laudo.ts';
import { analyzeBlob } from '../../src/worker/analyze-file.ts';
import { fingerprintBlob, sha256Hex } from '../../src/worker/fingerprint.ts';

const log = `${[...generateLines({ profile: 'iso-level', seed: 5, maxEvents: 1500 })].join('\n')}\n`;

async function entrada(opts: Partial<LaudoInput> = {}, texto = log): Promise<LaudoInput> {
  const blob = new Blob([texto]);
  const out = await analyzeBlob(blob, { blockSize: 64 * 1024, profile: 'iso-level' });
  if (out.kind !== 'ready') throw new Error('não concluiu');
  const fp = await fingerprintBlob(blob, { blockSize: 64 * 1024 });
  if (!fp) throw new Error('sem impressão digital');
  return {
    build: { nome: 'Garimpo', versao: '0.0.0', build: 'teste' },
    generatedAt: '2026-10-22T20:00:00.000Z',
    jazida: {
      nome: 'app.log',
      tamanho: blob.size,
      modificadoEm: Date.UTC(2026, 9, 22),
      impressaoDigital: fp,
    },
    analysis: out.result,
    custom: null,
    lacre: null,
    ...opts,
  };
}

describe('rótulos do selo (@AUD-02)', () => {
  it('algoritmo ou canonicalização trocados reprovam o laudo', async () => {
    const laudo = await sealLaudo(buildLaudo(await entrada()), sha256Hex);
    expect((await verifyLaudo(laudo, sha256Hex)).ok).toBe(true);
    const outroAlgoritmo = { ...laudo, integridade: { ...laudo.integridade, algoritmo: 'sha257' } };
    expect((await verifyLaudo(outroAlgoritmo as typeof laudo, sha256Hex)).ok).toBe(false);
    const outraCanon = { ...laudo, integridade: { ...laudo.integridade, canonicalizacao: 'x' } };
    expect((await verifyLaudo(outraCanon as typeof laudo, sha256Hex)).ok).toBe(false);
  });
});

describe('JSON canônico (@AUD-03)', () => {
  it('ordena as chaves e não usa espaços', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});

describe('escape do laudo (@SEG-04)', () => {
  it('neutraliza marcação, aspas e crases', () => {
    const payloads = [
      '<script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      "' onmouseover='alert(1)",
      '`${alert(1)}`',
      '</pre><svg onload=alert(1)>',
      'javascript:alert(1)',
    ];
    for (const p of payloads) {
      const out = escapeHtml(p);
      expect(out).not.toMatch(/[<>"'`]/);
      expect(unescapeHtml(out)).toBe(p);
    }
  });
  it('propriedade: a saída nunca tem caracteres perigosos, para qualquer texto', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        expect(escapeHtml(s)).not.toMatch(/[<>"'`]/);
        expect(escapeHtml(s, 'atributo')).not.toMatch(/[<>"'`\n\t]/);
      }),
      { numRuns: 200 },
    );
  });
  it('trunca sem partir par substituto', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('a😀b', 2)).toBe('a…');
    expect(truncate('abcdef', 3)).toBe('abc…');
  });
});

describe('impressão digital da jazida (@AUD-02)', () => {
  it('SHA-256 conhecido', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('é determinística, sensível ao conteúdo e ao tamanho do bloco, e conta os blocos', async () => {
    const a = await fingerprintBlob(new Blob(['x'.repeat(1000)]), { blockSize: 300 });
    const b = await fingerprintBlob(new Blob(['x'.repeat(1000)]), { blockSize: 300 });
    const c = await fingerprintBlob(new Blob(['x'.repeat(999) + 'y']), { blockSize: 300 });
    expect(a).toEqual(b);
    expect(a?.blocos).toBe(4);
    expect(a?.raiz).not.toBe(c?.raiz);
    expect(a?.raiz).toMatch(/^[0-9a-f]{64}$/);
  });
  it('arquivo vazio tem zero blocos; cancelar devolve null', async () => {
    expect((await fingerprintBlob(new Blob([])))?.blocos).toBe(0);
    expect(await fingerprintBlob(new Blob(['abc']), { isCancelled: () => true })).toBeNull();
  });
});

describe('laudo (@AUD-01 a @AUD-06)', () => {
  it('registra build, jazida, formato, contadores, limites e a declaração de limites', async () => {
    const laudo = await sealLaudo(buildLaudo(await entrada()), sha256Hex);
    expect(laudo.schema).toBe('garimpo-laudo/1');
    expect(laudo.gerador.build).toBe('teste');
    expect(laudo.jazida.impressaoDigital.raiz).toMatch(/^[0-9a-f]{64}$/);
    expect(laudo.formato.perfil).toBe('iso-level');
    expect(laudo.contadores.eventos).toBe(1500);
    expect(laudo.agrupamento.pesos['ERROR']).toBe(5);
    expect(laudo.limites.tamanhoMaximoEventoBytes).toBeGreaterThan(0);
    expect(laudo.limitacoes.length).toBeGreaterThanOrEqual(4);
    expect(laudo.decisoes.join(' ')).toContain('Lacre desligado');
    expect(laudo.pepitas.length).toBeGreaterThan(0);
    expect(isLaudo(laudo)).toBe(true);
  });

  it('o hash de integridade confere e detecta qualquer alteração', async () => {
    const laudo = await sealLaudo(buildLaudo(await entrada()), sha256Hex);
    expect((await verifyLaudo(laudo, sha256Hex)).ok).toBe(true);
    const adulterado = structuredClone(laudo);
    adulterado.contadores.eventos += 1;
    expect((await verifyLaudo(adulterado, sha256Hex)).ok).toBe(false);
    const adulterado2 = structuredClone(laudo);
    adulterado2.pepitas[0]!.gabarito = 'outra coisa';
    expect((await verifyLaudo(adulterado2, sha256Hex)).ok).toBe(false);
  });

  it('é reproduzível: mesma jazida e configuração dão o mesmo laudo, salvo a data de geração', async () => {
    const a = await sealLaudo(buildLaudo(await entrada()), sha256Hex);
    const b = await sealLaudo(buildLaudo(await entrada()), sha256Hex);
    expect(b).toEqual(a);
    const c = await sealLaudo(
      buildLaudo(await entrada({ generatedAt: '2026-10-23T00:00:00.000Z' })),
      sha256Hex,
    );
    const semVariaveis = (laudo: typeof a): Record<string, unknown> => {
      const copia: Record<string, unknown> = { ...laudo };
      delete copia.geradoEm;
      delete copia.integridade;
      return copia;
    };
    const restoC = semVariaveis(c);
    const restoA = semVariaveis(a);
    expect(restoC).toEqual(restoA);
    expect(c.integridade.valor).not.toBe(a.integridade.valor);
  });

  it('o Lacre mascara nome, gabaritos e exemplos, e conta as substituições', async () => {
    const texto =
      '2026-10-22T10:00:00Z ERROR [t] a.B - falha para ana@empresa.com cpf 529.982.247-25 ip 10.1.2.3\n' +
      '2026-10-22T10:00:01Z ERROR [t] a.B - falha para bia@empresa.com cpf 111.444.777-35 ip 10.1.2.4\n';
    const lacre = new Lacre(LACRE_DEFAULT_TYPES);
    const laudo = await sealLaudo(
      buildLaudo(
        await entrada(
          {
            lacre,
            jazida: {
              nome: 'cliente-ana@empresa.com.log',
              tamanho: 10,
              modificadoEm: null,
              impressaoDigital: (await entrada({}, texto)).jazida.impressaoDigital,
            },
          },
          texto,
        ),
      ),
      sha256Hex,
    );
    const json = JSON.stringify(laudo);
    expect(json).not.toContain('ana@empresa.com');
    expect(json).not.toContain('bia@empresa.com');
    expect(json).not.toContain('529.982.247-25');
    expect(json).not.toContain('10.1.2.3');
    expect(laudo.lacre.ativo).toBe(true);
    expect(laudo.lacre.substituicoes['email']).toBeGreaterThan(0);
    expect(lacre.mapping().length).toBeGreaterThan(0);
  });

  it('HTML: sem scripts, com CSP restritiva, payloads hostis só como texto', async () => {
    const hostil = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    const texto = `2026-10-22T10:00:00Z ERROR [t] a.B - ${hostil}\n`;
    const base = await entrada({}, texto);
    const laudo = await sealLaudo(
      buildLaudo({ ...base, jazida: { ...base.jazida, nome: `"><svg onload=alert(1)>${hostil}` } }),
      sha256Hex,
    );
    const html = renderLaudoHtml(laudo);
    expect(html).toContain('default-src &#39;none&#39;');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/onerror=|onload=/);
    expect(html).toContain('O que este laudo não garante');
    expect(html).toContain('&lt;script&gt;');
  });

  it('ida e volta: o laudo embutido no HTML é relido e o hash confere', async () => {
    const laudo = await sealLaudo(buildLaudo(await entrada()), sha256Hex);
    const html = renderLaudoHtml(laudo);
    const lido = extractLaudoFromHtml(html);
    expect(lido).toEqual(laudo);
    expect(isLaudo(lido) && (await verifyLaudo(lido, sha256Hex)).ok).toBe(true);
    expect(extractLaudoFromHtml('<html></html>')).toBeNull();
  });

  it('ida e volta do JSON', async () => {
    const laudo = await sealLaudo(buildLaudo(await entrada()), sha256Hex);
    const lido = JSON.parse(JSON.stringify(laudo)) as unknown;
    expect(isLaudo(lido) && (await verifyLaudo(lido, sha256Hex)).ok).toBe(true);
  });

  it('caracteres especiais de Unicode no conteúdo não quebram a releitura', async () => {
    const texto = `2026-10-22T10:00:00Z ERROR [t] a.B - falha com\u0085separadores 😀 &amp; <b>\n`;
    const laudo = await sealLaudo(buildLaudo(await entrada({}, texto)), sha256Hex);
    const lido = extractLaudoFromHtml(renderLaudoHtml(laudo));
    expect(lido).toEqual(laudo);
  });

  it('o verificador confere a jazida original e acusa quando o arquivo muda', async () => {
    const { verifyAgainstJazida } = await import('../../src/worker/verify-laudo.ts');
    const base = await entrada();
    const laudo = await sealLaudo(buildLaudo(base), sha256Hex);
    const bom = await verifyAgainstJazida(laudo, new Blob([log]));
    expect(bom.every((c) => c.ok)).toBe(true);
    expect(bom.length).toBeGreaterThan(8);
    const alterado = log.replace('INFO', 'WARN');
    const ruim = await verifyAgainstJazida(laudo, new Blob([alterado]));
    expect(ruim.some((c) => !c.ok)).toBe(true);
  });
});
