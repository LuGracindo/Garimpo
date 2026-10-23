// Cálculo de contraste WCAG 2.x e leitura dos tokens de src/ui/tokens.css.
// Sem dependências, para rodar em Node puro, no Vitest e na CI.

export type Tokens = Record<string, string>;

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new RangeError(`cor inválida: ${hex}`);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function readBlock(block: string): Tokens {
  const tokens: Tokens = {};
  for (const match of block.matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) tokens[name] = value;
  }
  return tokens;
}

/** Extrai o tema escuro (bloco :root principal) e o claro (bloco :root[data-theme='light']). */
export function parseThemes(css: string): { dark: Tokens; light: Tokens } {
  const darkMatch = css.match(/:root\s*\{([^}]*)\}/);
  const lightMatch = css.match(/:root\[data-theme='light'\]\s*\{([^}]*)\}/);
  if (!darkMatch?.[1] || !lightMatch?.[1]) throw new Error('Blocos de tema não encontrados.');
  return { dark: readBlock(darkMatch[1]), light: readBlock(lightMatch[1]) };
}

export interface Pair {
  fg: string;
  bg: string;
  min: number;
  uso: string;
}

/** Pares exigidos: texto normal 4.5:1; componentes de interface e ícones 3:1. */
export const PAIRS: readonly Pair[] = [
  { fg: 'areia', bg: 'leito', min: 4.5, uso: 'texto principal sobre a página' },
  { fg: 'areia', bg: 'argila', min: 4.5, uso: 'texto principal sobre painéis' },
  { fg: 'areia', bg: 'seixo', min: 4.5, uso: 'texto sobre superfície elevada' },
  { fg: 'poeira', bg: 'leito', min: 4.5, uso: 'texto secundário sobre a página' },
  { fg: 'poeira', bg: 'argila', min: 4.5, uso: 'texto secundário sobre painéis' },
  { fg: 'ouro', bg: 'leito', min: 4.5, uso: 'destaque (texto ou rótulo) sobre a página' },
  { fg: 'ouro', bg: 'argila', min: 3, uso: 'destaque (componente) sobre painéis' },
  { fg: 'ferrugem', bg: 'leito', min: 4.5, uso: 'erro e crítico' },
  { fg: 'cobre', bg: 'leito', min: 4.5, uso: 'aviso' },
  { fg: 'agua', bg: 'leito', min: 4.5, uso: 'informação e links' },
  { fg: 'musgo', bg: 'leito', min: 4.5, uso: 'sucesso e selo Lacrado' },
  { fg: 'seixo', bg: 'leito', min: 1.0, uso: 'borda (decorativa, sem exigência)' },
];

export interface Result extends Pair {
  tema: 'dark' | 'light';
  ratio: number;
  ok: boolean;
}

export function evaluate(css: string): Result[] {
  const themes = parseThemes(css);
  const out: Result[] = [];
  for (const tema of ['dark', 'light'] as const) {
    const tokens = themes[tema];
    for (const pair of PAIRS) {
      const fg = tokens[pair.fg];
      const bg = tokens[pair.bg];
      if (!fg || !bg) throw new Error(`token ausente: ${pair.fg} ou ${pair.bg} (${tema})`);
      const ratio = contrast(fg, bg);
      out.push({ ...pair, tema, ratio, ok: ratio >= pair.min });
    }
  }
  return out;
}
