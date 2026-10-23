// Pipeline de normalização do fingerprint (SDD 7.2). As etapas rodam nesta ordem:
//  1 ANSI · 2 espaços · 3 timestamps · 4 UUID · 5 e-mail · 6 IP · 7 URL · 8 hex · 9 tokens ·
//  10 números · 11 aspas (só no modo agressivo).
//
// Decisões de implementação (registradas no SDD, seção 19):
//  - A entrada é cortada em MAX_INPUT_CHARS caracteres, o que limita o custo de qualquer
//    expressão regular (defesa contra ReDoS, SEG).
//  - JWT (começa com "eyJ") é reconhecido no início da etapa 8, antes dos trechos hexadecimais,
//    senão o hexadecimal consumiria partes do token. O marcador é o mesmo da etapa 9.
//  - Na etapa 8, só vira <HEX> a sequência com pelo menos uma letra a-f; só dígitos é número.
//    Além das sequências de 8 ou mais dígitos, entram as de 6 e 7 que misturam letras a-f e
//    dígitos (hashes curtos de commit ou de cache). Palavras como "decade" não são afetadas.
//  - Na etapa 9, o token precisa ter ao menos uma letra e um dígito, para que nomes longos de
//    classe (ex.: NullPointerExceptionHandler) não virem <TOKEN>.
//  - Na etapa 7, o host é mantido e a query string é descartada.

import type { NormalizationMode } from './types.ts';

export const MAX_INPUT_CHARS = 4096;

export interface Capture {
  marker: string;
  value: string;
}

export interface Normalized {
  template: string;
  captures: Capture[];
}

type Replacer = (text: string, captures: Capture[]) => string;

function marker(re: RegExp, token: string): Replacer {
  return (text, captures) =>
    text.replace(re, (value) => {
      captures.push({ marker: token, value });
      return token;
    });
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

const TIMESTAMP = new RegExp(
  [
    String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+|:\d{3})?(?:Z|[+-]\d{2}:?\d{2})?`,
    String.raw`\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}(?: [+-]\d{4})?`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b`,
    String.raw`\b1\d{9}(?:\d{3})?\b`,
  ].join('|'),
  'g',
);

const UUID = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const IP = new RegExp(
  [
    String.raw`\[(?=[0-9A-Fa-f.]*:)[0-9A-Fa-f:.]+\](?::\d{1,5})?`,
    String.raw`\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b`,
    String.raw`\b(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}\b`,
  ].join('|'),
  'g',
);

const SEGMENT_NUMERIC = /^\d+$/;
const SEGMENT_HEX = /^(?=[0-9A-Fa-f]*\d)(?=[0-9A-Fa-f]*[A-Fa-f])[0-9A-Fa-f]{6,}$/;

function normalizePath(path: string, captures: Capture[]): string {
  return path
    .split('/')
    .map((segment) => {
      if (SEGMENT_NUMERIC.test(segment) || SEGMENT_HEX.test(segment)) {
        captures.push({ marker: ':id', value: segment });
        return ':id';
      }
      return segment;
    })
    .join('/');
}

const URL_RE = /\bhttps?:\/\/[^\s"'()]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const BARE_PATH = /(?<![\w<>:/.-])\/[\w.~%:<>/-]+/g;

const urlStep: Replacer = (text, captures) => {
  const withUrls = text.replace(URL_RE, (full) => {
    const trailing = TRAILING_PUNCTUATION.exec(full)?.[0] ?? '';
    const body = trailing ? full.slice(0, full.length - trailing.length) : full;
    const withoutScheme = body.replace(/^https?:\/\//, '');
    const cut = withoutScheme.search(/[/?#]/);
    const host = cut === -1 ? withoutScheme : withoutScheme.slice(0, cut);
    const rest = cut === -1 ? '' : withoutScheme.slice(cut);
    const pathEnd = rest.search(/[?#]/);
    const path = pathEnd === -1 ? rest : rest.slice(0, pathEnd);
    captures.push({ marker: '<URL>', value: body });
    return `<URL>${host}${normalizePath(path, captures)}${trailing}`;
  });
  return withUrls.replace(BARE_PATH, (path) => normalizePath(path, captures));
};

const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g;
const HEX = new RegExp(
  [
    String.raw`\b0x[0-9A-Fa-f]{4,}\b`,
    String.raw`\b(?=[0-9A-Fa-f]*[A-Fa-f])[0-9A-Fa-f]{8,}\b`,
    String.raw`\b(?=[0-9A-Fa-f]*\d)(?=[0-9A-Fa-f]*[A-Fa-f])[0-9A-Fa-f]{6,7}\b`,
  ].join('|'),
  'g',
);
const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g;

const NUMBER =
  /(?<![\w.])\d+(?:[.,]\d+)?(?=(?:ms|us|µs|ns|s|m|h|d|KB|MB|GB|TB|kb|mb|gb|tb|B|%)\b|\b)/g;

const QUOTED = /"[^"]{0,200}"|(?<!\w)'[^']{0,200}'(?!\w)/g;

const STEPS: readonly Replacer[] = [
  // 1
  (text) => text.replace(ANSI, ''),
  // 2
  (text) => text.replace(/\s+/g, ' ').trim(),
  // 3
  marker(TIMESTAMP, '<TS>'),
  // 4
  marker(UUID, '<UUID>'),
  // 5
  marker(EMAIL, '<EMAIL>'),
  // 6
  marker(IP, '<IP>'),
  // 7
  urlStep,
  // 8
  (text, captures) => marker(HEX, '<HEX>')(marker(JWT, '<TOKEN>')(text, captures), captures),
  // 9
  marker(TOKEN, '<TOKEN>'),
  // 10
  marker(NUMBER, '<N>'),
  // 11
  marker(QUOTED, '<STR>'),
];

const LAST_STEP: Readonly<Record<NormalizationMode, number>> = {
  conservador: 6,
  padrao: 10,
  agressivo: 11,
};

export function normalizeMessage(message: string, mode: NormalizationMode): Normalized {
  let text = message.length > MAX_INPUT_CHARS ? message.slice(0, MAX_INPUT_CHARS) : message;
  const captures: Capture[] = [];
  const last = LAST_STEP[mode];
  for (let i = 0; i < last; i += 1) {
    const step = STEPS[i];
    if (step) text = step(text, captures);
  }
  return { template: text, captures };
}
