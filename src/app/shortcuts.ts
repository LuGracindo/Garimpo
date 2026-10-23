// Atalhos de teclado (SDD 9.4). Atalhos de uma tecla não valem enquanto se digita em um campo e
// podem ser desligados (WCAG 2.1.4). A preferência fica só neste navegador.

const STORAGE_KEY = 'garimpo.atalhos';

export function readShortcutsEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeShortcutsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* sem armazenamento: a preferência vale só até recarregar */
  }
}

/** true quando o foco está num lugar onde a tecla tem outro significado (digitar, ativar botão). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  const role = target.getAttribute('role');
  return (
    tag === 'BUTTON' || tag === 'A' || role === 'tab' || role === 'listbox' || role === 'option'
  );
}

export type ShortcutAction =
  | { kind: 'focus-search' }
  | { kind: 'nugget'; delta: 1 | -1 }
  | { kind: 'open' }
  | { kind: 'occurrence'; delta: 1 | -1 }
  | { kind: 'filters' }
  | { kind: 'help' };

/** Traduz a tecla em ação, ou null quando não é atalho (ou não vale neste foco). */
export function actionFor(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  switch (event.key) {
    case '/':
      return { kind: 'focus-search' };
    case 'j':
      return { kind: 'nugget', delta: 1 };
    case 'k':
      return { kind: 'nugget', delta: -1 };
    case 'Enter':
      return isActivatable(event.target) ? null : { kind: 'open' };
    case ']':
      return { kind: 'occurrence', delta: 1 };
    case '[':
      return { kind: 'occurrence', delta: -1 };
    case 'f':
      return { kind: 'filters' };
    case '?':
      return { kind: 'help' };
    default:
      return null;
  }
}

export const OCCURRENCE_EVENT = 'garimpo:ocorrencia';
