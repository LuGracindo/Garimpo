import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, evaluate } from '../../scripts/lib/contrast.ts';

const css = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'ui', 'tokens.css'), 'utf8');

describe('identidade visual (@RNF-06)', () => {
  it('calcula contraste conforme a referência WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('todos os pares de cor exigidos passam nos dois temas', () => {
    const falhas = evaluate(css).filter((r) => !r.ok);
    expect(falhas.map((r) => `${r.tema}: ${r.fg} sobre ${r.bg} = ${r.ratio.toFixed(2)}`)).toEqual(
      [],
    );
  });
});
