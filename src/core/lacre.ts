// Lacre: mascara dados sensíveis conhecidos antes de mostrar ou exportar (RF-40, RF-41).
// Detectores são regras (regex mais validação de dígitos), não um modelo: não acham nomes nem
// endereços em texto livre. O Lacre reduz o risco de vazamento; não é garantia (SEG-16).

export const LACRE_TYPES = [
  'email',
  'ipv4',
  'ipv6',
  'cpf',
  'cnpj',
  'cartao',
  'jwt',
  'chave-api',
  'uuid',
  'telefone-br',
] as const;

export type LacreType = (typeof LACRE_TYPES)[number];

/** Ligados por padrão; UUID e telefone ficam desligados por risco de falso positivo. */
export const LACRE_DEFAULT_TYPES: readonly LacreType[] = [
  'email',
  'ipv4',
  'ipv6',
  'cpf',
  'cnpj',
  'cartao',
  'jwt',
  'chave-api',
];

export const LACRE_LABELS: Readonly<Record<LacreType, string>> = {
  email: 'E-mail',
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  cartao: 'Cartão de crédito',
  jwt: 'JWT',
  'chave-api': 'Chave de API',
  uuid: 'UUID',
  'telefone-br': 'Telefone brasileiro',
};

const MARKER_NAMES: Readonly<Record<LacreType, string>> = {
  email: 'EMAIL',
  ipv4: 'IPV4',
  ipv6: 'IPV6',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  cartao: 'CARTAO',
  jwt: 'JWT',
  'chave-api': 'CHAVE',
  uuid: 'UUID',
  'telefone-br': 'TELEFONE',
};

/** Textos maiores que isto são mascarados só até aqui, e o resto é descartado (limita o custo). */
export const LACRE_MAX_CHARS = 20_000;

/** Corta no limite sem partir um valor ao meio: recua até o último espaço próximo ao corte. */
function clip(text: string): string {
  if (text.length <= LACRE_MAX_CHARS) return text;
  const cut = text.slice(0, LACRE_MAX_CHARS);
  const space = cut.search(/\s\S{0,100}$/);
  return space > 0 ? cut.slice(0, space) : cut;
}

export function isLacreType(value: unknown): value is LacreType {
  return typeof value === 'string' && (LACRE_TYPES as readonly string[]).includes(value);
}

// ---- validadores ----

function allSame(digits: string): boolean {
  return /^(\d)\1*$/.test(digits);
}

export function isValidCpf(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || allSame(d)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(d[i]) * (size + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(d[size])) return false;
  }
  return true;
}

export function isValidCnpj(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14 || allSame(d)) return false;
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const size of [12, 13]) {
    let sum = 0;
    for (let i = 0; i < size; i += 1) {
      sum += Number(d[i]) * (weights[weights.length - size + i] ?? 0);
    }
    const check = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (check !== Number(d[size])) return false;
  }
  return true;
}

export function isValidCard(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19 || allSame(d)) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function isValidIpv6(text: string): boolean {
  const doubles = text.split('::').length - 1;
  if (doubles > 1) return false;
  const groups = text.split(':').filter((g) => g !== '');
  if (groups.length === 0 || groups.length > (doubles === 1 ? 7 : 8)) return false;
  if (doubles === 0 && groups.length !== 8) return false;
  return groups.every((g) => /^[0-9A-Fa-f]{1,4}$/.test(g));
}

// ---- detectores ----

interface Detector {
  type: LacreType;
  /** Menor número vence quando dois detectores casam o mesmo trecho. */
  priority: number;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

const DETECTORS: readonly Detector[] = [
  {
    type: 'jwt',
    priority: 0,
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
  },
  {
    type: 'chave-api',
    priority: 1,
    regex:
      /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[abprs]-[A-Za-z0-9-]{10,}|[sr]k_(?:live|test)_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35})\b/g,
  },
  {
    type: 'email',
    priority: 2,
    regex: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}/g,
  },
  {
    type: 'uuid',
    priority: 3,
    regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  },
  {
    type: 'cnpj',
    priority: 4,
    regex: /(?<![\d.\-/])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d])/g,
    validate: isValidCnpj,
  },
  {
    type: 'cpf',
    priority: 5,
    regex: /(?<![\d.\-/])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d])/g,
    validate: isValidCpf,
  },
  {
    type: 'cartao',
    priority: 6,
    regex: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
    validate: isValidCard,
  },
  {
    type: 'ipv4',
    priority: 7,
    regex:
      /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\d|\.\d)/g,
  },
  {
    type: 'ipv6',
    priority: 8,
    regex:
      /(?<![\w:])(?:(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:(?:[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4}){0,5})?|::[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4}){0,6})(?![\w:])/g,
    validate: isValidIpv6,
  },
  {
    type: 'telefone-br',
    priority: 9,
    regex: /(?<![\d])(?:\+?55[ -]?)?\(?[1-9]\d\)?[ -]?9?\d{4}[ -]?\d{4}(?![\d])/g,
  },
];

export interface SensitiveHit {
  type: LacreType;
  start: number;
  end: number;
  value: string;
}

/** Acha os trechos sensíveis (sem sobreposição) dos tipos pedidos. Não altera o texto. */
export function findSensitive(text: string, types: ReadonlySet<LacreType>): SensitiveHit[] {
  const input = clip(text);
  const found: (SensitiveHit & { priority: number })[] = [];
  for (const detector of DETECTORS) {
    if (!types.has(detector.type)) continue;
    for (const match of input.matchAll(detector.regex)) {
      const value = match[0];
      if (detector.validate && !detector.validate(value)) continue;
      const start = match.index ?? 0;
      found.push({
        type: detector.type,
        start,
        end: start + value.length,
        value,
        priority: detector.priority,
      });
    }
  }
  found.sort((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end);
  const hits: SensitiveHit[] = [];
  let cursor = 0;
  for (const item of found) {
    if (item.start < cursor) continue;
    hits.push({ type: item.type, start: item.start, end: item.end, value: item.value });
    cursor = item.end;
  }
  return hits;
}

export interface MarkerEntry {
  marker: string;
  type: LacreType;
  original: string;
}

/**
 * Mascara com marcadores consistentes: o mesmo valor recebe sempre o mesmo marcador
 * (`<EMAIL_1>`), numerado por ordem de aparição. O mapa fica só em memória.
 */
export class Lacre {
  readonly types: ReadonlySet<LacreType>;
  /** Substituições feitas, por tipo (conta repetições do mesmo valor). */
  readonly replacements: Record<LacreType, number>;
  private readonly markers = new Map<string, string>();
  private readonly entries: MarkerEntry[] = [];
  private readonly perType = new Map<LacreType, number>();

  constructor(types: Iterable<LacreType>) {
    this.types = new Set(types);
    this.replacements = Object.fromEntries(LACRE_TYPES.map((t) => [t, 0])) as Record<
      LacreType,
      number
    >;
  }

  get active(): boolean {
    return this.types.size > 0;
  }

  mask(text: string): string {
    if (!this.active || text === '') return text;
    const input = clip(text);
    const hits = findSensitive(input, this.types);
    if (hits.length === 0) return input;
    let out = '';
    let cursor = 0;
    for (const hit of hits) {
      out += input.slice(cursor, hit.start) + this.markerFor(hit);
      cursor = hit.end;
      this.replacements[hit.type] += 1;
    }
    return out + input.slice(cursor);
  }

  private markerFor(hit: SensitiveHit): string {
    // A chave inclui o tipo: o mesmo texto em tipos diferentes não se confunde.
    const key = `${hit.type}\u0000${hit.value}`;
    const known = this.markers.get(key);
    if (known) return known;
    const n = (this.perType.get(hit.type) ?? 0) + 1;
    this.perType.set(hit.type, n);
    const marker = `<${MARKER_NAMES[hit.type]}_${n}>`;
    this.markers.set(key, marker);
    this.entries.push({ marker, type: hit.type, original: hit.value });
    return marker;
  }

  /** Mapa marcador → valor original, na ordem de criação. Contém dados sensíveis. */
  mapping(): readonly MarkerEntry[] {
    return this.entries;
  }

  totalReplacements(): number {
    return LACRE_TYPES.reduce((sum, t) => sum + this.replacements[t], 0);
  }
}
