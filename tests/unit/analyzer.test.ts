import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Analyzer, DEFAULT_WEIGHTS } from '../../src/core/analyzer.ts';
import { PROFILES, generateLines } from '../../fixtures/generator.ts';
import type { Profile as GenProfile } from '../../fixtures/generator.ts';
import { SEVERITIES } from '../../src/core/types.ts';

const encoder = new TextEncoder();

function logText(profile: GenProfile, seed: number, events: number): string {
  return `${[...generateLines({ profile, seed, maxEvents: events })].join('\n')}\n`;
}

function analyze(text: string, profile: GenProfile, cuts: number[] = []) {
  const bytes = encoder.encode(text);
  const analyzer = new Analyzer({ profile, topNuggets: 1000 });
  // Divide em pedaços alinhados à quebra de linha, como o leitor faz.
  let start = 0;
  const points = [...cuts, bytes.length].sort((a, b) => a - b);
  for (const point of points) {
    let end = Math.min(point, bytes.length);
    if (end < bytes.length) {
      const next = bytes.indexOf(0x0a, end);
      end = next === -1 ? bytes.length : next + 1;
    }
    if (end > start) {
      analyzer.feed(bytes.subarray(start, end), start);
      start = end;
    }
  }
  return { analyzer, result: analyzer.finish(), bytes };
}

describe('agregador de pepitas (@RF-20)', () => {
  for (const profile of PROFILES) {
    it(`${profile}: os totais fecham e o resultado é reprodutível`, () => {
      const text = logText(profile, 11, 3000);
      const a = analyze(text, profile);
      const b = analyze(text, profile);
      const { summary, nuggets } = a.result;

      expect(summary.events).toBe(3000);
      expect(nuggets.reduce((sum, n) => sum + n.count, 0)).toBe(3000);
      expect(SEVERITIES.reduce((sum, s) => sum + summary.severityCounts[s], 0)).toBe(3000);
      expect(a.analyzer.index.length).toBe(3000);
      expect(summary.nuggetCount).toBe(nuggets.length);
      expect(b.result).toEqual(a.result);
    });
  }

  it('pepitas ficam poucas e as mensagens variáveis se agrupam', () => {
    const { summary } = analyze(logText('iso-level', 3, 5000), 'iso-level').result;
    expect(summary.nuggetCount).toBeLessThan(40);
  });

  it('iso-level e jsonl, com a mesma semente, contam os mesmos erros', () => {
    const iso = analyze(logText('iso-level', 7, 4000), 'iso-level').result.summary;
    const json = analyze(logText('jsonl', 7, 4000), 'jsonl').result.summary;
    expect(iso.severityCounts).toEqual(json.severityCounts);
    expect(iso.events).toBe(json.events);
  });

  it('o tamanho dos pedaços não muda o resultado', () => {
    const text = logText('iso-level', 2, 1500);
    const size = encoder.encode(text).length;
    const base = analyze(text, 'iso-level').result;
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: size }), { minLength: 1, maxLength: 12 }),
        (cuts) => {
          expect(analyze(text, 'iso-level', cuts).result).toEqual(base);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('os deslocamentos de exemplo apontam para o início do evento', () => {
    const text = logText('iso-level', 4, 800);
    const { result, bytes } = analyze(text, 'iso-level');
    const decoder = new TextDecoder();
    for (const nugget of result.nuggets) {
      for (const offset of nugget.sampleOffsets) {
        const line = decoder.decode(bytes.subarray(offset, bytes.indexOf(0x0a, offset)));
        expect(line).toMatch(/^2026-10-\d{2}T/);
      }
    }
  });
});

describe('prioridade (@RF-22)', () => {
  const linhas = (nivel: string, n: number, msg: string, minuto: number): string[] =>
    Array.from(
      { length: n },
      (_, i) =>
        `2026-10-22T14:${String(minuto).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z ${nivel} [t] a.B - ${msg}`,
    );

  it('aplica prioridade = peso × (1 + log10(contagem)) × fatorRecência', () => {
    // 10 ocorrências distribuídas em 10 minutos; sem recência extra além da última décima.
    const text =
      Array.from(
        { length: 10 },
        (_, i) => `2026-10-22T14:${String(i).padStart(2, '0')}:00Z ERROR [t] a.B - falha ${i}`,
      ).join('\n') + '\n';
    const { result } = analyze(text, 'iso-level');
    const n = result.nuggets[0];
    expect(n?.count).toBe(10);
    // Intervalo de 9 min; a última décima (54 s) contém só a última ocorrência: 1/10.
    const esperado = DEFAULT_WEIGHTS.ERROR * (1 + Math.log10(10)) * (1 + 1 / 10);
    expect(n?.priority).toBeCloseTo(esperado, 10);
  });

  it('um erro raro pode superar muitos INFO, e a pepita nova é marcada', () => {
    const text =
      [...linhas('INFO', 50, 'rotina', 0), ...linhas('ERROR', 3, 'quebrou', 59)].join('\n') + '\n';
    const { result } = analyze(text, 'iso-level');
    expect(result.nuggets[0]?.template).toBe('quebrou');
    expect(result.nuggets[0]?.isNew).toBe(true);
    expect(result.nuggets[1]?.isNew).toBe(false);
    expect(result.nuggets[0]?.dominant).toBe('ERROR');
  });

  it('sem intervalo de tempo, nada é "nova" e a recência é neutra', () => {
    const text = '2026-10-22T14:00:00Z WARN [t] a.B - igual\n'.repeat(5);
    const { result } = analyze(text, 'iso-level');
    expect(result.nuggets[0]?.isNew).toBe(false);
    expect(result.nuggets[0]?.priority).toBeCloseTo(DEFAULT_WEIGHTS.WARN * (1 + Math.log10(5)), 10);
  });
});

describe('explicar o agrupamento (@RF-21)', () => {
  it('lista os marcadores que variaram, com até 5 exemplos distintos', () => {
    const text =
      Array.from(
        { length: 30 },
        (_, i) =>
          `2026-10-22T14:00:${String(i).padStart(2, '0')}Z ERROR [t] a.B - falha em 192.0.2.${i + 1} após ${100 + i} ms`,
      ).join('\n') + '\n';
    const { result } = analyze(text, 'iso-level');
    const nugget = result.nuggets[0];
    expect(nugget?.template).toBe('falha em <IP> após <N> ms');
    const ip = nugget?.markers.find((m) => m.marker === '<IP>');
    expect(ip?.distinct).toBe(30);
    expect(ip?.examples).toHaveLength(5);
    expect(new Set(ip?.examples).size).toBe(5);
  });

  it('limita os valores distintos acompanhados e avisa', () => {
    const text =
      Array.from({ length: 200 }, (_, i) => `2026-10-22T14:00:00Z INFO [t] a.B - id ${i}`).join(
        '\n',
      ) + '\n';
    const marker = analyze(text, 'iso-level').result.nuggets[0]?.markers[0];
    expect(marker?.distinct).toBe(50);
    expect(marker?.capped).toBe(true);
  });
});

describe('limites', () => {
  it('reúne o excesso de pepitas em uma só e avisa', () => {
    const text =
      Array.from(
        { length: 30 },
        (_, i) => `2026-10-22T14:00:00Z INFO [t] a.B - mensagem${'x'.repeat(i)}`,
      ).join('\n') + '\n';
    const analyzer = new Analyzer({ profile: 'iso-level', maxNuggets: 10, topNuggets: 100 });
    analyzer.feed(encoder.encode(text), 0);
    const { summary, nuggets } = analyzer.finish();
    expect(summary.overflow).toBe(true);
    expect(nuggets.reduce((sum, n) => sum + n.count, 0)).toBe(30);
    expect(summary.nuggetCount).toBe(11);
  });

  it('tolera BOM, CRLF, UTF-8 e linhas enormes', () => {
    const grande = 'x'.repeat(200_000);
    const text = `﻿2026-10-22T14:00:00Z ERROR [t] a.B - ação inválida\r\n2026-10-22T14:00:01Z ERROR [t] a.B - ${grande}\r\n`;
    const { result } = analyze(text, 'iso-level');
    expect(result.summary.events).toBe(2);
    expect(result.nuggets.map((n) => n.template)).toContain('ação inválida');
    expect(result.summary.maxLineBytes).toBeGreaterThan(200_000);
  });

  it('arquivo sem quebra final e arquivo vazio', () => {
    expect(
      analyze('2026-10-22T14:00:00Z INFO [t] a.B - fim', 'iso-level').result.summary.events,
    ).toBe(1);
    expect(analyze('', 'iso-level').result.summary.events).toBe(0);
  });
});
