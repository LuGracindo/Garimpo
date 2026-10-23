// Perfis personalizados salvos neste navegador (localStorage). Nada sai do aparelho.

import { isCustomSpec, type CustomProfileSpec } from '../core/custom-profile.ts';

const STORAGE_KEY = 'garimpo.perfis';
export const MAX_SAVED_PROFILES = 20;

export function loadProfiles(): CustomProfileSpec[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCustomSpec).slice(0, MAX_SAVED_PROFILES);
  } catch {
    return [];
  }
}

function store(list: CustomProfileSpec[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* sem armazenamento: o perfil vale só nesta sessão */
  }
}

/** Salva (ou substitui, se o nome já existe) e devolve a lista atualizada. */
export function saveProfile(spec: CustomProfileSpec): CustomProfileSpec[] {
  const others = loadProfiles().filter((p) => p.name !== spec.name);
  const next = [spec, ...others].slice(0, MAX_SAVED_PROFILES);
  store(next);
  return next;
}

export function deleteProfile(name: string): CustomProfileSpec[] {
  const next = loadProfiles().filter((p) => p.name !== name);
  store(next);
  return next;
}
