import { describe, expect, it } from 'vitest';
import { PROFILES, generateLines, utf8Length } from '../../fixtures/generator.ts';

const FAIXAS_DOCUMENTACAO = ['192.0.2', '198.51.100', '203.0.113'];

describe('gerador de logs sintéticos (@RF-08)', () => {
  for (const profile of PROFILES) {
    it(`${profile}: mesma semente gera o mesmo texto; semente diferente, texto diferente`, () => {
      const a = [...generateLines({ profile, seed: 7, maxEvents: 400 })].join('\n');
      const b = [...generateLines({ profile, seed: 7, maxEvents: 400 })].join('\n');
      const c = [...generateLines({ profile, seed: 8, maxEvents: 400 })].join('\n');
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });

    it(`${profile}: só usa dados pessoais fictícios`, () => {
      const text = [...generateLines({ profile, seed: 3, maxEvents: 600 })].join('\n');
      for (const match of text.matchAll(/[\w.]+@[\w.]+/g)) {
        expect(match[0].endsWith('@example.test')).toBe(true);
      }
      for (const match of text.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g)) {
        expect(FAIXAS_DOCUMENTACAO).toContain(match[1]);
      }
    });
  }

  it('jsonl: cada linha é um JSON válido', () => {
    for (const line of generateLines({ profile: 'jsonl', seed: 1, maxEvents: 300 })) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('respeita o tamanho alvo (com folga de uma linha)', () => {
    const target = 50_000;
    let bytes = 0;
    for (const line of generateLines({ profile: 'iso-level', seed: 1, targetBytes: target })) {
      bytes += utf8Length(line) + 1;
    }
    expect(bytes).toBeGreaterThanOrEqual(target);
    expect(bytes).toBeLessThan(target + 2_000);
  });

  it('exige um limite de parada', () => {
    expect(() => [...generateLines({ profile: 'iso-level', seed: 1 })]).toThrow(RangeError);
  });
});
