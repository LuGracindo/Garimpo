// Perfis de formato da v1: iso-level, jsonl e http-combined (SDD 8.1).
// Timestamps sem fuso assumem UTC (RF-15, valor padrão); isso deve constar no laudo.

import { levelFromNumber, normalizeLevel } from './levels.ts';
import type { ParsedLine, Profile, ProfileId, Severity } from './types.ts';

/** Regras gerais de continuação (SDD 8.3). */
export function isGeneralContinuation(line: string): boolean {
  return (
    line.startsWith(' ') ||
    line.startsWith('\t') ||
    line.startsWith('at ') ||
    line.startsWith('...') ||
    line.startsWith('Caused by:')
  );
}

/** Interpreta data e hora ISO 8601, com espaço no lugar do T e vírgula decimal. Sem fuso: UTC. */
export function parseIsoTime(text: string): number | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,](\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!match) return null;
  const fraction = (match[3] ?? '').slice(0, 3).padEnd(3, '0');
  let zone = match[4] ?? 'Z';
  if (zone !== 'Z' && !zone.includes(':')) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const ms = Date.parse(`${match[1]}T${match[2]}.${fraction}${zone}`);
  return Number.isNaN(ms) ? null : ms;
}

const ISO_LINE =
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)\s+\[?([A-Za-z]+)\]?\s+(.*)$/;
const THREAD = /^\[[^\]]*\]\s+/;
const LOGGER = /^(\S+)\s+-\s+/;

export const isoLevelProfile: Profile = {
  id: 'iso-level',
  continuesAnyLine: true,
  parse(line) {
    const match = ISO_LINE.exec(line);
    if (!match) return null;
    const level = normalizeLevel(match[2] ?? '');
    if (level === null) return null;
    let rest = match[3] ?? '';
    const thread = THREAD.exec(rest);
    if (thread) rest = rest.slice(thread[0].length);
    const logger = LOGGER.exec(rest);
    if (logger) rest = rest.slice(logger[0].length);
    return { timeMs: parseIsoTime(match[1] ?? ''), level, message: rest };
  },
};

const TIME_KEYS = ['time', 'timestamp', 'ts', '@timestamp', 't'] as const;
const LEVEL_KEYS = ['level', 'severity', 'lvl', 'levelname', 'loglevel'] as const;
const MESSAGE_KEYS = ['msg', 'message', 'event', 'log'] as const;

function jsonTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Abaixo de 1e11 é segundos (até o ano 5138); acima, milissegundos.
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const iso = parseIsoTime(value);
    if (iso !== null) return iso;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function jsonLevel(value: unknown): Severity | null {
  if (typeof value === 'string') return normalizeLevel(value);
  if (typeof value === 'number') return levelFromNumber(value);
  return null;
}

function firstPresent(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

export const jsonlProfile: Profile = {
  id: 'jsonl',
  continuesAnyLine: false,
  parse(line) {
    const text = line.trimStart();
    if (text.charCodeAt(0) !== 0x7b) return null;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const message = firstPresent(record, MESSAGE_KEYS);
    return {
      timeMs: jsonTime(firstPresent(record, TIME_KEYS)),
      level: jsonLevel(firstPresent(record, LEVEL_KEYS)),
      message: typeof message === 'string' ? message : '',
    };
  },
};

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const CLF_TIME = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

export function parseClfTime(text: string): number | null {
  const m = CLF_TIME.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2] ?? ''];
  if (month === undefined) return null;
  const utc = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  const offsetMin = (Number(m[8]) * 60 + Number(m[9])) * (m[7] === '-' ? -1 : 1);
  const result = utc - offsetMin * 60_000;
  return Number.isNaN(result) ? null : result;
}

const HTTP_LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+)(?: [^"]*)?" (\d{3}) (?:\d+|-)/;

export const httpCombinedProfile: Profile = {
  id: 'http-combined',
  continuesAnyLine: false,
  parse(line) {
    const m = HTTP_LINE.exec(line);
    if (!m) return null;
    const status = Number(m[5]);
    // No http-combined a severidade vem do status (SDD 8.1): 5xx ERROR, 4xx WARN, demais INFO.
    const level: Severity = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    const parsed: ParsedLine = {
      timeMs: parseClfTime(m[2] ?? ''),
      level,
      message: `${m[3] ?? ''} ${m[4] ?? ''}`,
      tag: String(status),
    };
    return parsed;
  },
};

// Perfil lvl-dash: `Lvl: 10 - ------------ - 2026-01-15 10:00:00:123 - T1234 - User internal - mensagem`.
// O número do nível (Lvl) e o rótulo vêm do próprio sistema: 01 error, 02 warning, 10 sem rótulo.
// Sem rótulo reconhecido, vale o número: 0 FATAL, 1 ERROR, 2 WARN, demais INFO.
const LVL_DASH =
  /^Lvl:\s*(\d+)\s+-\s+(.{1,12}?)\s+-\s+(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})[:.,](\d{1,3})\s+-\s+(\S+)\s+-\s+(.*)$/;

function lvlDashLevel(number: number, label: string): Severity {
  const named = normalizeLevel(label);
  if (named !== null) return named;
  if (number === 0) return 'FATAL';
  if (number === 1) return 'ERROR';
  if (number === 2) return 'WARN';
  return 'INFO';
}

export const lvlDashProfile: Profile = {
  id: 'lvl-dash',
  continuesAnyLine: false,
  parse(line) {
    const m = LVL_DASH.exec(line);
    if (!m) return null;
    const rest = m[7] ?? '';
    // Depois do tempo e da thread vem o contexto ("User internal"), um " - " e a mensagem.
    const cut = rest.indexOf(' - ');
    const message = cut === -1 ? rest : rest.slice(cut + 3);
    return {
      timeMs: parseIsoTime(`${m[3] ?? ''} ${m[4] ?? ''}.${m[5] ?? ''}`),
      level: lvlDashLevel(Number(m[1]), (m[2] ?? '').trim()),
      message,
    };
  },
};

const BY_ID: Readonly<Record<ProfileId, Profile>> = {
  'iso-level': isoLevelProfile,
  jsonl: jsonlProfile,
  'http-combined': httpCombinedProfile,
  'lvl-dash': lvlDashProfile,
};

export function getProfile(id: ProfileId): Profile {
  return BY_ID[id];
}
