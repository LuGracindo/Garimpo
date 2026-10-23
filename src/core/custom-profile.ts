// Perfil personalizado (v1.1 antecipada): a pessoa descreve o formato com uma regex de grupos
// nomeados e o Garimpo monta um perfil a partir dela, sem mexer no código.
//
// Grupos reconhecidos (nome em português ou inglês):
//   msg | mensagem | message   obrigatório: o texto que vira a pepita
//   data | hora | time | timestamp   horário do evento
//   nivel | level   nível (mapeado por `levelMap`, ou pelos sinônimos conhecidos)
//   tag   texto que entra na chave da pepita sem normalização (ex.: código de status)
//
// A regex roda em cada linha do arquivo dentro do Worker de análise. Para limitar o risco de
// explosão de tempo: padrão com até 500 caracteres, só os primeiros 4096 caracteres de cada
// linha, e padrões com quantificadores aninhados são recusados.

import { levelFromNumber, normalizeLevel } from './levels.ts';
import { hasNestedQuantifier, MAX_PATTERN_LENGTH } from './regex.ts';
import { parseClfTime, parseIsoTime } from './profiles.ts';
import { SEVERITIES, type ParsedLine, type Profile, type Severity } from './types.ts';

export const TIME_FORMATS = ['iso', 'br', 'epoch-s', 'epoch-ms', 'clf'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const MAX_NAME_LENGTH = 40;
export const MAX_LEVEL_ENTRIES = 64;
export const MAX_LEVEL_KEY_LENGTH = 40;
export const MAX_PARSE_CHARS = 4096;

export interface CustomProfileSpec {
  name: string;
  pattern: string;
  timeFormat: TimeFormat;
  /** Texto capturado (sem diferenciar maiúsculas) → nível. O que faltar usa os sinônimos conhecidos. */
  levelMap: Record<string, Severity>;
  /** 'any': toda linha que não casa continua o evento anterior. 'general': só as regras gerais (indentada, `at`...). */
  continuation: 'any' | 'general';
}

export type SpecProblem =
  'nome' | 'padrao-vazio' | 'padrao-longo' | 'sintaxe' | 'sem-mensagem' | 'aninhado' | 'campos';

const MESSAGE_GROUPS = ['msg', 'mensagem', 'message'];
const TIME_GROUPS = ['data', 'hora', 'time', 'timestamp'];
const LEVEL_GROUPS = ['nivel', 'level'];

function group(groups: Record<string, string | undefined>, names: string[]): string | undefined {
  for (const name of names) {
    const value = groups[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Confere a forma de uma especificação vinda de fora (armazenamento local, mensagem do Worker). */
export function isCustomSpec(value: unknown): value is CustomProfileSpec {
  if (!isObject(value)) return false;
  const name = value['name'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) return false;
  const pattern = value['pattern'];
  if (typeof pattern !== 'string' || pattern.length > MAX_PATTERN_LENGTH) return false;
  if (!(TIME_FORMATS as readonly unknown[]).includes(value['timeFormat'])) return false;
  if (value['continuation'] !== 'any' && value['continuation'] !== 'general') return false;
  const map = value['levelMap'];
  if (!isObject(map)) return false;
  const entries = Object.entries(map);
  if (entries.length > MAX_LEVEL_ENTRIES) return false;
  return entries.every(
    ([key, level]) =>
      key.length > 0 &&
      key.length <= MAX_LEVEL_KEY_LENGTH &&
      (SEVERITIES as readonly unknown[]).includes(level),
  );
}

export function parseCustomTime(text: string, format: TimeFormat): number | null {
  const value = text.trim();
  switch (format) {
    case 'iso': {
      // Aceita milissegundos depois de dois-pontos (`10:00:00:123`), como alguns sistemas gravam.
      const colon = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}):(\d{1,3})$/.exec(value);
      return parseIsoTime(colon ? `${colon[1] ?? ''}.${colon[2] ?? ''}` : value);
    }
    case 'br': {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,:](\d{1,3}))?$/.exec(
        value,
      );
      if (!m) return null;
      const ms = Number((m[7] ?? '0').padEnd(3, '0'));
      const result = Date.UTC(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
        ms,
      );
      return Number.isNaN(result) ? null : result;
    }
    case 'epoch-s': {
      const n = Number(value);
      return Number.isFinite(n) && value !== '' ? Math.round(n * 1000) : null;
    }
    case 'epoch-ms': {
      const n = Number(value);
      return Number.isFinite(n) && value !== '' ? Math.round(n) : null;
    }
    case 'clf':
      return parseClfTime(value);
  }
}

/** Chave de nível: minúsculas, e números sem zeros à esquerda (`01` e `1` são o mesmo nível). */
function levelKey(text: string): string {
  const key = text.trim().toLowerCase();
  return /^\d+$/.test(key) ? String(Number(key)) : key;
}

function resolveLevel(text: string, map: Map<string, Severity>): Severity | null {
  const key = levelKey(text);
  const mapped = map.get(key);
  if (mapped) return mapped;
  const named = normalizeLevel(key);
  if (named) return named;
  if (/^\d+$/.test(key)) return levelFromNumber(Number(key));
  return null;
}

export type BuildResult = { ok: true; profile: Profile } | { ok: false; problem: SpecProblem };

export function buildCustomProfile(spec: CustomProfileSpec): BuildResult {
  if (!isCustomSpec(spec)) return { ok: false, problem: 'nome' };
  if (spec.pattern.trim() === '') return { ok: false, problem: 'padrao-vazio' };
  if (spec.pattern.length > MAX_PATTERN_LENGTH) return { ok: false, problem: 'padrao-longo' };
  if (hasNestedQuantifier(spec.pattern)) return { ok: false, problem: 'aninhado' };

  let regex: RegExp;
  try {
    regex = new RegExp(spec.pattern);
  } catch {
    return { ok: false, problem: 'sintaxe' };
  }
  const names = [...spec.pattern.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1] ?? '');
  if (!names.some((name) => MESSAGE_GROUPS.includes(name))) {
    return { ok: false, problem: 'sem-mensagem' };
  }
  const known = [...MESSAGE_GROUPS, ...TIME_GROUPS, ...LEVEL_GROUPS, 'tag'];
  if (names.some((name) => !known.includes(name))) return { ok: false, problem: 'campos' };

  const levels = new Map<string, Severity>();
  for (const [key, level] of Object.entries(spec.levelMap)) levels.set(levelKey(key), level);
  const format = spec.timeFormat;

  const profile: Profile = {
    id: 'custom',
    continuesAnyLine: spec.continuation === 'any',
    parse(line): ParsedLine | null {
      const match = regex.exec(
        line.length > MAX_PARSE_CHARS ? line.slice(0, MAX_PARSE_CHARS) : line,
      );
      if (!match?.groups) return null;
      const groups = match.groups;
      const time = group(groups, TIME_GROUPS);
      const level = group(groups, LEVEL_GROUPS);
      const tag = groups['tag'];
      const parsed: ParsedLine = {
        timeMs: time === undefined ? null : parseCustomTime(time, format),
        level: level === undefined ? null : resolveLevel(level, levels),
        message: group(groups, MESSAGE_GROUPS) ?? '',
      };
      if (tag !== undefined && tag !== '') parsed.tag = tag;
      return parsed;
    },
  };
  return { ok: true, profile };
}

export interface PreviewSample {
  line: string;
  matched: boolean;
  timeMs: number | null;
  level: Severity | null;
  message: string;
}

export interface Preview {
  tested: number;
  matched: number;
  withTime: number;
  withLevel: number;
  samples: PreviewSample[];
}

export const PREVIEW_SAMPLES = 12;

/** Testa o perfil nas linhas de amostra; devolve contagens e as primeiras linhas, casadas ou não. */
export function previewProfile(profile: Profile, lines: readonly string[]): Preview {
  const preview: Preview = { tested: 0, matched: 0, withTime: 0, withLevel: 0, samples: [] };
  for (const line of lines) {
    preview.tested += 1;
    const parsed = profile.parse(line);
    if (parsed) {
      preview.matched += 1;
      if (parsed.timeMs !== null) preview.withTime += 1;
      if (parsed.level !== null) preview.withLevel += 1;
    }
    if (preview.samples.length < PREVIEW_SAMPLES) {
      preview.samples.push({
        line: line.length > 300 ? line.slice(0, 300) : line,
        matched: parsed !== null,
        timeMs: parsed?.timeMs ?? null,
        level: parsed?.level ?? null,
        message: parsed?.message.slice(0, 300) ?? '',
      });
    }
  }
  return preview;
}
