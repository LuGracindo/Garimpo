import { describe, expect, it } from 'vitest';
import { generateLines } from '../../fixtures/generator.ts';
import { EMPTY_FILTER } from '../../src/core/filter.ts';
import { analyzeBlob } from '../../src/worker/analyze-file.ts';
import { Session, Superseded } from '../../src/worker/session.ts';

async function abrir(
  text: string,
  profile: 'iso-level' | 'jsonl' | 'http-combined' | 'lvl-dash' = 'iso-level',
) {
  const blob = new Blob([text]);
  const out = await analyzeBlob(blob, { blockSize: 64 * 1024, profile });
  if (out.kind !== 'ready') throw new Error('análise não concluiu');
  return { session: new Session(blob, out.analyzer, out.result), result: out.result, text };
}

const log = `${[...generateLines({ profile: 'iso-level', seed: 21, maxEvents: 3000 })].join('\n')}\n`;

describe('sessão de consulta (@RF-25, @RF-26, @RF-27)', () => {
  it('sem filtro, o total é o número de eventos e as contagens por pepita fecham', async () => {
    const { session, result } = await abrir(log);
    const q = await session.query(EMPTY_FILTER);
    expect(q.total).toBe(3000);
    const soma = q.nuggetCounts.reduce((acc, [, n]) => acc + n, 0);
    const exibidas = result.nuggets.reduce((acc, n) => acc + n.count, 0);
    expect(soma).toBe(exibidas);
    for (const [id, n] of q.nuggetCounts) {
      expect(n).toBe(result.nuggets.find((x) => x.id === id)?.count);
    }
  });

  it('filtra por nível e as ocorrências vêm do arquivo, na ordem', async () => {
    const { session, result } = await abrir(log);
    const filtro = { ...EMPTY_FILTER, levels: ['ERROR' as const] };
    const q = await session.query(filtro);
    expect(q.total).toBe(result.summary.severityCounts.ERROR);
    const page = await session.occurrences(filtro, 0, 50);
    expect(page.rows.length).toBe(Math.min(50, q.total));
    for (const row of page.rows) {
      expect(row.severity).toBe('ERROR');
      expect(row.text).toMatch(/^2026-10-\d{2}T[\d:.]+Z ERROR /);
    }
    const tempos = page.rows.map((r) => r.timeMs ?? 0);
    expect([...tempos].sort((a, b) => a - b)).toEqual(tempos);
  });

  it('busca texto literal, com e sem diferenciar maiúsculas, e combina com nível', async () => {
    const { session, text } = await abrir(log);
    const esperado = text.split('\n').filter((l) => l.includes('Pagamento recusado')).length;
    const q = await session.query({ ...EMPTY_FILTER, text: 'pagamento RECUSADO' });
    expect(q.total).toBe(esperado);
    const exato = await session.query({
      ...EMPTY_FILTER,
      text: 'pagamento RECUSADO',
      caseSensitive: true,
    });
    expect(exato.total).toBe(0);
    const combinado = await session.query({
      ...EMPTY_FILTER,
      text: 'Pagamento recusado',
      levels: ['WARN'],
    });
    expect(combinado.total).toBe(0);
  });

  it('o texto também acha linhas de continuação (stack trace) do evento', async () => {
    const { session, text } = await abrir(log);
    const eventosComPilha = text
      .split('\n')
      .filter((l) => l.includes('NullPointerException')).length;
    expect(eventosComPilha).toBeGreaterThan(0);
    const q = await session.query({ ...EMPTY_FILTER, text: 'NullPointerException' });
    expect(q.total).toBe(eventosComPilha);
  });

  it('filtrar por pepita limita o total, sem mudar as contagens das outras', async () => {
    const { session, result } = await abrir(log);
    const alvo = result.nuggets[0];
    if (!alvo) throw new Error('sem pepita');
    const q = await session.query({ ...EMPTY_FILTER, nuggetId: alvo.id });
    expect(q.total).toBe(alvo.count);
    expect(q.nuggetCounts.length).toBe(result.nuggets.length);
  });

  it('o histograma ignora o intervalo e fecha com o total filtrado', async () => {
    const { session, result } = await abrir(log);
    const meio = (result.summary.firstTimeMs ?? 0) + 3_000;
    const h = await session.histogram({ ...EMPTY_FILTER, from: meio, to: meio + 100 });
    expect(h.total).toBe(3000);
    expect(h.counts.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0)).toBe(3000);
  });

  it('o intervalo restringe as ocorrências', async () => {
    const { session, result } = await abrir(log);
    const inicio = result.summary.firstTimeMs ?? 0;
    const q = await session.query({ ...EMPTY_FILTER, from: inicio, to: inicio + 60_000 });
    expect(q.total).toBeGreaterThan(0);
    expect(q.total).toBeLessThan(3000);
  });

  it('contexto: o evento aparece inteiro, com vizinhas antes e depois', async () => {
    const { session } = await abrir(log);
    const page = await session.occurrences({ ...EMPTY_FILTER, levels: ['ERROR'] }, 5, 1);
    const evento = page.rows[0];
    if (!evento) throw new Error('sem ocorrência');
    const ctx = await session.context(evento.event, 3, 3);
    expect(ctx.filter((l) => l.kind === 'before')).toHaveLength(3);
    expect(ctx.filter((l) => l.kind === 'after')).toHaveLength(3);
    expect(ctx.find((l) => l.kind === 'event')?.text).toBe(evento.text);
    expect(await session.context(-1, 3, 3)).toEqual([]);
    expect(await session.context(999_999, 3, 3)).toEqual([]);
  });

  it('contexto no começo e no fim do arquivo não inventa linhas', async () => {
    const { session } = await abrir(log);
    const primeiro = await session.context(0, 5, 0);
    expect(primeiro.filter((l) => l.kind === 'before')).toHaveLength(0);
    const ultimo = await session.context(2999, 0, 5);
    expect(ultimo.filter((l) => l.kind === 'after')).toHaveLength(0);
  });

  it('uma busca de outro texto abandona a anterior (Superseded)', async () => {
    const { session } = await abrir(log);
    const antiga = session.query({ ...EMPTY_FILTER, text: 'Pagamento' });
    const nova = session.query({ ...EMPTY_FILTER, text: 'Timeout' });
    let erro: unknown;
    try {
      await antiga;
    } catch (e) {
      erro = e;
    }
    expect(erro instanceof Superseded).toBe(true);
    expect((await nova).total).toBeGreaterThan(0);
  });

  it('consultas iguais em andamento dividem o trabalho', async () => {
    const { session } = await abrir(log);
    const filtro = { ...EMPTY_FILTER, text: 'Timeout' };
    const [a, b, c] = await Promise.all([
      session.query(filtro),
      session.occurrences(filtro, 0, 5),
      session.histogram(filtro),
    ]);
    expect(a.total).toBe(b.total);
    expect(c.total).toBe(a.total);
  });

  it('funciona nos outros perfis (jsonl e lvl-dash)', async () => {
    for (const profile of ['jsonl', 'lvl-dash'] as const) {
      const texto = `${[...generateLines({ profile, seed: 3, maxEvents: 500 })].join('\n')}\n`;
      const { session } = await abrir(texto, profile);
      const q = await session.query({ ...EMPTY_FILTER, levels: ['ERROR'] });
      expect(q.total).toBeGreaterThan(0);
      const page = await session.occurrences({ ...EMPTY_FILTER, levels: ['ERROR'] }, 0, 3);
      expect(page.rows.length).toBe(3);
    }
  });

  it('impressão digital do arquivo e varredura do Lacre', async () => {
    const texto =
      '2026-10-22T10:00:00Z ERROR [t] a.B - falha ana@empresa.com ip 10.1.2.3\n' +
      '2026-10-22T10:00:01Z INFO [t] a.B - ok bia@empresa.com\n' +
      '2026-10-22T10:00:02Z INFO [t] a.B - nada sensivel\n';
    const { session } = await abrir(texto);
    const fp = await session.fingerprint(() => false);
    expect(fp.bytes).toBe(new TextEncoder().encode(texto).length);
    expect(fp.raiz).toMatch(/^[0-9a-f]{64}$/);
    const scan = await session.lacreScan(['email', 'ipv4'], () => false);
    expect(scan.counts.email).toBe(2);
    expect(scan.counts.ipv4).toBe(1);
    expect(scan.counts.cpf).toBe(0);
    const amostra = scan.samples.find((x) => x.type === 'email');
    expect(amostra?.antes).toContain('ana@empresa.com');
    expect(amostra?.depois).not.toContain('ana@empresa.com');
    let erro: unknown;
    try {
      await session.lacreScan(['email'], () => true);
    } catch (e) {
      erro = e;
    }
    expect(erro instanceof Superseded).toBe(true);
  });
});
