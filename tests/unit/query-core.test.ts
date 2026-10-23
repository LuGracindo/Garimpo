import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Analyzer } from '../../src/core/analyzer.ts';
import { EMPTY_FILTER, filterKey, isEmptyFilter, isFilter } from '../../src/core/filter.ts';
import { bucketGeometry, buildHistogram, chooseBucketSize } from '../../src/core/histogram.ts';
import { selectEvents } from '../../src/core/query.ts';
import { TextScanner } from '../../src/core/textsearch.ts';
import { extractContext } from '../../src/core/context.ts';
import { pageOf, visibleWindow } from '../../src/core/virtual.ts';

const encoder = new TextEncoder();

function build(lines: string[]): Analyzer {
  const analyzer = new Analyzer({ profile: 'iso-level' });
  analyzer.feed(encoder.encode(`${lines.join('\n')}\n`), 0);
  analyzer.finish();
  return analyzer;
}

const base = '2026-10-22T14:';
const sample = [
  `${base}00:00Z INFO [t] a.B - inicio`,
  `${base}00:10Z ERROR [t] a.B - falha 1`,
  `${base}00:20Z WARN [t] a.B - lento`,
  `${base}00:30Z ERROR [t] a.B - falha 2`,
  `${base}01:00Z INFO [t] a.B - fim`,
];

describe('filtro (@RF-25)', () => {
  it('chave canônica ignora ordem e repetição de níveis', () => {
    const a = { ...EMPTY_FILTER, levels: ['ERROR', 'WARN'] as const };
    const b = { ...EMPTY_FILTER, levels: ['WARN', 'ERROR', 'WARN'] as const };
    expect(filterKey({ ...a, levels: [...a.levels] })).toBe(
      filterKey({ ...b, levels: [...b.levels] }),
    );
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
    expect(isEmptyFilter({ ...EMPTY_FILTER, text: 'x' })).toBe(false);
  });

  it('valida a forma do filtro recebido', () => {
    expect(isFilter(EMPTY_FILTER)).toBe(true);
    expect(isFilter({ ...EMPTY_FILTER, levels: ['ERROR'] })).toBe(true);
    expect(isFilter({ ...EMPTY_FILTER, levels: ['BANANA'] })).toBe(false);
    expect(isFilter({ ...EMPTY_FILTER, from: 'ontem' })).toBe(false);
    expect(isFilter({ ...EMPTY_FILTER, nuggetId: -1 })).toBe(false);
    expect(isFilter({ ...EMPTY_FILTER, text: 'x'.repeat(501) })).toBe(false);
    expect(isFilter(null)).toBe(false);
  });
});

describe('seleção de eventos (@RF-25)', () => {
  const analyzer = build(sample);
  const index = analyzer.index;
  const sel = (patch: object, flags: Uint8Array | null = null) => [
    ...selectEvents(index, { ...EMPTY_FILTER, ...patch }, 'time', flags),
  ];

  it('sem filtro devolve todos, em ordem', () => {
    expect(sel({})).toEqual([0, 1, 2, 3, 4]);
  });

  it('filtra por nível, intervalo (fim exclusivo) e pepita', () => {
    expect(sel({ levels: ['ERROR'] })).toEqual([1, 3]);
    expect(sel({ levels: ['ERROR', 'WARN'] })).toEqual([1, 2, 3]);
    const t = (s: string) => Date.parse(`${base}${s}Z`);
    expect(sel({ from: t('00:10'), to: t('00:30') })).toEqual([1, 2]);
    expect(sel({ from: t('00:30') })).toEqual([3, 4]);
    // "falha 1" e "falha 2" são a mesma pepita ("falha <N>").
    expect(sel({ nuggetId: index.nuggets.at(1) })).toEqual([1, 3]);
  });

  it('combina filtros e a marca de texto', () => {
    const flags = new Uint8Array([0, 1, 1, 0, 1]);
    expect(sel({ levels: ['ERROR'] }, flags)).toEqual([1]);
    expect(sel({}, flags)).toEqual([1, 2, 4]);
  });

  it('no eixo de ordem, o intervalo vale para o índice do evento', () => {
    const r = [...selectEvents(index, { ...EMPTY_FILTER, from: 1, to: 3 }, 'order', null)];
    expect(r).toEqual([1, 2]);
  });
});

describe('histograma do Perfil (@RF-23)', () => {
  it('escolhe tamanhos redondos e cabe no máximo de baldes', () => {
    expect(chooseBucketSize(0)).toBe(1);
    expect(chooseBucketSize(60_000, 240)).toBe(500);
    expect(chooseBucketSize(7 * 86_400_000, 240)).toBe(3_600_000 * 1);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000_000_000 }),
        fc.integer({ min: 10, max: 400 }),
        (range, max) => {
          const size = chooseBucketSize(range, max);
          expect(Math.floor(range / size) + 1).toBeLessThanOrEqual(max);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('soma por severidade e total fecham com o filtro', () => {
    const analyzer = build(sample);
    const range = {
      axis: 'time' as const,
      minTime: Date.parse(`${base}00:00Z`),
      maxTime: Date.parse(`${base}01:00Z`),
      eventCount: 5,
    };
    const all = selectEvents(analyzer.index, EMPTY_FILTER, 'time', null);
    const h = buildHistogram(analyzer.index, all, range);
    expect(h.total).toBe(5);
    expect(h.counts.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0)).toBe(5);
    expect(h.counts[3]?.reduce((a, b) => a + b, 0)).toBe(2);
    expect(h.untimed).toBe(0);

    const errors = selectEvents(
      analyzer.index,
      { ...EMPTY_FILTER, levels: ['ERROR'] },
      'time',
      null,
    );
    const he = buildHistogram(analyzer.index, errors, range);
    // A geometria não muda ao filtrar: o Perfil não "pula".
    expect(he.start).toBe(h.start);
    expect(he.bucketSize).toBe(h.bucketSize);
    expect(he.buckets).toBe(h.buckets);
    expect(he.total).toBe(2);
  });

  it('sem tempo, usa o eixo de ordem (@RF-14)', () => {
    const g = bucketGeometry(
      { axis: 'order', minTime: null, maxTime: null, eventCount: 1000 },
      100,
    );
    expect(g.bucketSize).toBe(10);
    expect(g.buckets).toBe(100);
  });
});

describe('busca de texto literal (@RF-25)', () => {
  const dados = encoder.encode('Erro: Falha ÇÃO\nnada\nfalha de novo\n');
  const acertos = (texto: string, cs: boolean): number[] => {
    const out: number[] = [];
    new TextScanner(texto, cs).scan(dados, 100, (o) => out.push(o));
    return out;
  };

  it('acha acertos com o deslocamento no arquivo', () => {
    expect(acertos('falha', false)).toEqual([106, 123]);
    expect(acertos('falha', true)).toEqual([123]);
  });

  it('ignora maiúsculas só para ASCII', () => {
    expect(acertos('çãO', false)).toEqual([]);
    expect(acertos('ÇÃO', false)).toEqual([112]);
  });

  it('texto vazio é erro e quebras de linha viram espaço', () => {
    expect(() => new TextScanner('', true)).toThrow(RangeError);
    expect(acertos('nada\nfalha', true)).toEqual([]);
  });
});

describe('contexto da ocorrência (@RF-26)', () => {
  const b = (s: string) => encoder.encode(s);

  it('junta linhas antes, do evento e depois, na ordem', () => {
    const lines = extractContext(
      {
        before: b('a\nb\nc\n'),
        beforeFromStart: true,
        event: b('E1\n  at x\n'),
        after: b('d\ne\nf\n'),
        afterToEnd: true,
      },
      2,
      2,
    );
    expect(lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'before:b',
      'before:c',
      'event:E1',
      'event:  at x',
      'after:d',
      'after:e',
    ]);
  });

  it('descarta a primeira linha cortada antes e a última incompleta depois', () => {
    const lines = extractContext(
      {
        before: b('pedaço\nb\nc\n'),
        beforeFromStart: false,
        event: b('E\n'),
        after: b('d\nincomple'),
        afterToEnd: false,
      },
      5,
      5,
    );
    expect(lines.map((l) => l.text)).toEqual(['b', 'c', 'E', 'd']);
  });

  it('aceita CRLF, zero linhas e corta linhas gigantes', () => {
    const lines = extractContext(
      {
        before: b('a\r\n'),
        beforeFromStart: true,
        event: b(`${'x'.repeat(5000)}\r\n`),
        after: b('z\r\n'),
        afterToEnd: true,
      },
      0,
      1,
    );
    expect(lines.map((l) => l.kind)).toEqual(['event', 'after']);
    expect(lines[0]?.cut).toBe(true);
    expect(lines[0]?.text.length).toBe(2000);
    expect(lines[1]?.text).toBe('z');
  });
});

describe('lista virtualizada (@RF-27)', () => {
  it('desenha só a janela visível mais a folga', () => {
    const w = visibleWindow({ scrollTop: 0, viewportHeight: 300, rowHeight: 30, total: 1_000_000 });
    expect(w.start).toBe(0);
    expect(w.end).toBeLessThan(30);
    expect(w.totalHeight).toBe(30_000_000);
  });

  it('segue a rolagem e respeita o fim da lista', () => {
    const meio = visibleWindow({
      scrollTop: 3000,
      viewportHeight: 300,
      rowHeight: 30,
      total: 1000,
      overscan: 2,
    });
    expect(meio.start).toBe(98);
    expect(meio.offsetTop).toBe(98 * 30);
    const fim = visibleWindow({
      scrollTop: 29_900,
      viewportHeight: 300,
      rowHeight: 30,
      total: 1000,
    });
    expect(fim.end).toBe(1000);
    expect(visibleWindow({ scrollTop: 50, viewportHeight: 300, rowHeight: 30, total: 0 }).end).toBe(
      0,
    );
  });

  it('nunca desenha mais que a janela, qualquer que seja a rolagem', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40_000_000 }),
        fc.integer({ min: 100, max: 2000 }),
        (scrollTop, viewport) => {
          const w = visibleWindow({
            scrollTop,
            viewportHeight: viewport,
            rowHeight: 28,
            total: 1_000_000,
          });
          expect(w.end - w.start).toBeLessThanOrEqual(Math.ceil(viewport / 28) + 1 + 12);
          expect(w.start).toBeLessThanOrEqual(w.end);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('calcula a página de um índice', () => {
    expect(pageOf(0, 100)).toBe(0);
    expect(pageOf(99, 100)).toBe(0);
    expect(pageOf(100, 100)).toBe(1);
  });
});
