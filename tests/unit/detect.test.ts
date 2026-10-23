import { describe, expect, it } from 'vitest';
import { detectProfile } from '../../src/core/detect.ts';
import { PROFILES, generateLines } from '../../fixtures/generator.ts';

describe('detecção automática do formato (@RF-10)', () => {
  for (const profile of PROFILES) {
    it(`${profile}: reconhece com confiança nos logs sintéticos`, () => {
      const sample = [...generateLines({ profile, seed: 5, maxEvents: 400 })].slice(0, 500);
      const detection = detectProfile(sample);
      expect(detection.best).toBe(profile);
      expect(detection.confident).toBe(true);
      expect(detection.candidates[0]?.profile).toBe(profile);
    });
  }

  it('texto sem estrutura não é detectado com confiança', () => {
    const detection = detectProfile(['olá mundo', 'isto não é um log', 'nem isto', 'nada']);
    expect(detection.confident).toBe(false);
  });

  it('amostra vazia não escolhe nenhum perfil', () => {
    const detection = detectProfile([]);
    expect(detection.best).toBeNull();
    expect(detection.confident).toBe(false);
  });

  it('formatos misturados em partes iguais pedem decisão da pessoa', () => {
    const iso = '2026-10-22T14:00:00Z INFO [t] a.B - ok';
    const json = '{"time":"2026-10-22T14:00:00Z","level":"info","msg":"ok"}';
    const sample = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? iso : json));
    expect(detectProfile(sample).confident).toBe(false);
  });

  it('usa só as primeiras 500 linhas', () => {
    const iso = '2026-10-22T14:00:00Z INFO [t] a.B - ok';
    const sample = [
      ...Array.from({ length: 500 }, () => iso),
      ...Array.from({ length: 5000 }, () => 'lixo'),
    ];
    expect(detectProfile(sample).confident).toBe(true);
  });
});
