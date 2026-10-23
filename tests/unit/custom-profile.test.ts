import { describe, expect, it } from 'vitest';
import {
  buildCustomProfile,
  isCustomSpec,
  parseCustomTime,
  previewProfile,
  type CustomProfileSpec,
} from '../../src/core/custom-profile.ts';
import { analyzeBlob, previewBlob } from '../../src/worker/analyze-file.ts';
import { isUiToWorker, isWorkerToUi } from '../../src/shared/protocol.ts';

const spec: CustomProfileSpec = {
  name: 'Sistema X',
  pattern:
    '^Lvl: (?<nivel>\\d+) - (?<tag>\\S+) - (?<data>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3}) - (?<msg>.*)$',
  timeFormat: 'iso',
  levelMap: { '1': 'ERROR', '2': 'WARN', '10': 'INFO' },
  continuation: 'general',
};

const linhas = [
  'Lvl: 10 - ABC - 2026-10-22 10:00:00:123 - Pedido 10 criado',
  'Lvl: 01 - ABC - 2026-10-22 10:00:01:500 - Falha ao gravar pedido 11',
  '    at app.Servico.gravar(Servico.java:10)',
  'Lvl: 02 - ABC - 2026-10-22 10:00:02:000 - Lento',
];

describe('perfil personalizado (@RF-11, @SEG-12)', () => {
  it('monta o perfil e interpreta tempo, nível, tag e mensagem', () => {
    const built = buildCustomProfile(spec);
    if (!built.ok) throw new Error(built.problem);
    const parsed = built.profile.parse(linhas[0] ?? '');
    expect(parsed?.message).toBe('Pedido 10 criado');
    expect(parsed?.level).toBe('INFO');
    expect(parsed?.tag).toBe('ABC');
    expect(parsed?.timeMs).toBe(Date.UTC(2026, 9, 22, 10, 0, 0, 123));
    expect(built.profile.parse(linhas[1] ?? '')?.level).toBe('ERROR');
    expect(built.profile.parse('sem formato')).toBeNull();
  });

  it('níveis fora do mapa usam sinônimos e números conhecidos', () => {
    const built = buildCustomProfile({
      ...spec,
      pattern: '^(?<nivel>\\w+) (?<msg>.*)$',
      levelMap: { x: 'FATAL' },
    });
    if (!built.ok) throw new Error(built.problem);
    expect(built.profile.parse('X boom')?.level).toBe('FATAL');
    expect(built.profile.parse('warning cuidado')?.level).toBe('WARN');
    expect(built.profile.parse('60 caiu')?.level).toBe('FATAL');
    expect(built.profile.parse('zzz ?')?.level).toBeNull();
  });

  it('recusa padrões sem mensagem, inválidos, longos, aninhados e com grupos desconhecidos', () => {
    const problema = (pattern: string) => {
      const r = buildCustomProfile({ ...spec, pattern });
      return r.ok ? 'ok' : r.problem;
    };
    expect(problema('^(?<nivel>\\w+)$')).toBe('sem-mensagem');
    expect(problema('(?<msg>')).toBe('sintaxe');
    expect(problema('')).toBe('padrao-vazio');
    expect(problema(`^(?<msg>${'a'.repeat(600)})`)).toBe('nome');
    expect(problema('^(?<msg>(a+)+)$')).toBe('aninhado');
    expect(problema('^(?<segredo>x) (?<msg>.*)$')).toBe('campos');
    expect(problema('^(?<msg>.*)$')).toBe('ok');
  });

  it('valida a forma da especificação vinda de fora', () => {
    expect(isCustomSpec(spec)).toBe(true);
    expect(isCustomSpec({ ...spec, name: '' })).toBe(false);
    expect(isCustomSpec({ ...spec, timeFormat: 'xyz' })).toBe(false);
    expect(isCustomSpec({ ...spec, levelMap: { a: 'NADA' } })).toBe(false);
    expect(isCustomSpec({ ...spec, continuation: 'tudo' })).toBe(false);
    expect(isCustomSpec(null)).toBe(false);
  });

  it('formatos de hora', () => {
    expect(parseCustomTime('2026-10-22 10:00:00:123', 'iso')).toBe(
      Date.UTC(2026, 9, 22, 10, 0, 0, 123),
    );
    expect(parseCustomTime('22/10/2026 10:00:00,5', 'br')).toBe(
      Date.UTC(2026, 9, 22, 10, 0, 0, 500),
    );
    expect(parseCustomTime('1760000000', 'epoch-s')).toBe(1_760_000_000_000);
    expect(parseCustomTime('1760000000123', 'epoch-ms')).toBe(1_760_000_000_123);
    expect(parseCustomTime('22/Oct/2026:10:00:00 -0300', 'clf')).toBe(
      Date.UTC(2026, 9, 22, 13, 0, 0),
    );
    expect(parseCustomTime('lixo', 'iso')).toBeNull();
    expect(parseCustomTime('', 'epoch-s')).toBeNull();
  });

  it('a pré-visualização conta o que casou e mostra as primeiras linhas', () => {
    const built = buildCustomProfile(spec);
    if (!built.ok) throw new Error(built.problem);
    const preview = previewProfile(built.profile, linhas);
    expect(preview.tested).toBe(4);
    expect(preview.matched).toBe(3);
    expect(preview.withTime).toBe(3);
    expect(preview.withLevel).toBe(3);
    expect(preview.samples[2]?.matched).toBe(false);
  });

  it('analisa um arquivo inteiro com o perfil personalizado e agrupa em pepitas', async () => {
    const texto = `${linhas.join('\n')}\n${linhas[1]}\n${linhas[2]}\n`;
    const blob = new Blob([texto]);
    const out = await analyzeBlob(blob, { blockSize: 64 * 1024, custom: spec });
    if (out.kind !== 'ready') throw new Error('não concluiu');
    expect(out.result.summary.profile).toBe('custom');
    expect(out.result.summary.profileSource).toBe('manual');
    expect(out.result.summary.events).toBe(4);
    // A linha "at ..." é continuação do evento anterior (regra geral).
    expect(out.result.summary.unparsed).toBe(0);
    expect(out.result.summary.severityCounts.ERROR).toBe(2);
    const erro = out.result.nuggets.find((n) => n.dominant === 'ERROR');
    expect(erro?.count).toBe(2);
    const preview = await previewBlob(blob, spec);
    expect(preview.matched).toBe(4);
  });

  it('o protocolo aceita perfil personalizado e pré-visualização, e recusa spec inválida', () => {
    const base = { requestId: 1, protocolVersion: 1 };
    const file = new Blob(['x']);
    const open = {
      type: 'open',
      file,
      options: { blockSize: 4 * 1024 * 1024, profile: 'custom', custom: spec },
      ...base,
    };
    expect(isUiToWorker(open)).toBe(true);
    expect(
      isUiToWorker({ ...open, options: { ...open.options, custom: { ...spec, name: '' } } }),
    ).toBe(false);
    expect(isUiToWorker({ type: 'preview-profile', file, spec, ...base })).toBe(true);
    expect(
      isUiToWorker({ type: 'preview-profile', file, spec: { ...spec, pattern: 3 }, ...base }),
    ).toBe(false);
    const preview = {
      tested: 1,
      matched: 1,
      withTime: 1,
      withLevel: 1,
      samples: [{ line: 'a', matched: true, timeMs: null, level: 'INFO', message: 'a' }],
    };
    expect(isWorkerToUi({ type: 'preview-result', preview, ...base })).toBe(true);
    expect(
      isWorkerToUi({ type: 'preview-result', preview: { ...preview, tested: -1 }, ...base }),
    ).toBe(false);
  });
});
