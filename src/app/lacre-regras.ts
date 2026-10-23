// Padrões próprios do Lacre, salvos neste navegador (localStorage). Nada sai do aparelho.
// Cada regra é revalidada ao ler: o que está no armazenamento é entrada não confiável.

import {
  MAX_CUSTOM_RULES,
  isCustomRule,
  validateCustomRule,
  type CustomRule,
} from '../core/lacre.ts';

const STORAGE_KEY = 'garimpo.lacre-regras';

export function loadRules(): CustomRule[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const kept: CustomRule[] = [];
    for (const item of parsed) {
      if (kept.length >= MAX_CUSTOM_RULES) break;
      if (isCustomRule(item) && validateCustomRule(item, kept) === null) kept.push(item);
    }
    return kept;
  } catch {
    return [];
  }
}

export function storeRules(rules: readonly CustomRule[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules.slice(0, MAX_CUSTOM_RULES)));
  } catch {
    /* sem armazenamento: as regras valem só nesta sessão */
  }
}
