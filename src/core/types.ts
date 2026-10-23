// Tipos do núcleo de análise (M1). Nada aqui depende de DOM nem de Worker.

export type Severity = 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/** Do menos para o mais severo; o índice é o "ranking" usado em comparações. */
export const SEVERITIES: readonly Severity[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

export type BuiltinProfileId = 'iso-level' | 'jsonl' | 'http-combined' | 'lvl-dash';

/** `custom` é o perfil montado pela pessoa a partir de uma regex (ver custom-profile.ts). */
export type ProfileId = BuiltinProfileId | 'custom';

/** Perfis embutidos, os únicos considerados na detecção automática. */
export const PROFILE_IDS: readonly BuiltinProfileId[] = [
  'iso-level',
  'jsonl',
  'http-combined',
  'lvl-dash',
];

export type NormalizationMode = 'conservador' | 'padrao' | 'agressivo';

export const NORMALIZATION_MODES: readonly NormalizationMode[] = [
  'conservador',
  'padrao',
  'agressivo',
];

/** Resultado de interpretar uma linha que inicia um evento. */
export interface ParsedLine {
  /** Instante em ms desde a época Unix (UTC), ou null quando a linha não tem tempo válido. */
  timeMs: number | null;
  /** Nível normalizado, ou null quando não reconhecido. */
  level: Severity | null;
  /** Mensagem sem timestamp e sem nível (SDD 7.1). */
  message: string;
  /** Texto que entra na chave da pepita sem passar pela normalização (ex.: status HTTP). */
  tag?: string;
}

export interface Profile {
  readonly id: ProfileId;
  /** Devolve os campos quando a linha inicia um evento; null quando não inicia. */
  parse(line: string): ParsedLine | null;
  /** true quando qualquer linha que não inicia evento é continuação do evento anterior. */
  readonly continuesAnyLine: boolean;
}
