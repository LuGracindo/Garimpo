// Fingerprint de um evento (SDD 7.1 a 7.4, RF-20).
// Sem pilha reconhecida: a chave é o gabarito da mensagem normalizada.
// Com pilha: a chave é a assinatura (exceção + 3 primeiros frames + causa), que agrupa falhas
// iguais mesmo que a mensagem varie (SDD 7.3). O gabarito da mensagem do primeiro evento fica
// em `headTemplate`, para exibição.

import { normalizeMessage, type Capture } from './normalize.ts';
import { extractStack } from './stack.ts';
import type { NormalizationMode, ParsedLine } from './types.ts';

export interface Fingerprint {
  /** Chave exata da pepita. É o próprio gabarito, não um hash (ADR-06). */
  key: string;
  headTemplate: string;
  captures: Capture[];
  hasStack: boolean;
}

export function fingerprintEvent(
  parsed: ParsedLine,
  continuation: readonly string[],
  mode: NormalizationMode,
): Fingerprint {
  const head = normalizeMessage(parsed.message, mode);
  const prefix = parsed.tag ? `${parsed.tag} ` : '';
  const stack = continuation.length > 0 ? extractStack(continuation) : null;

  if (stack && stack.frames.length > 0) {
    const signature =
      `${stack.exception ?? 'exceção'} @ ${stack.frames.join(' > ')}` +
      (stack.cause ? ` ← ${stack.cause}` : '');
    return {
      key: prefix + signature,
      headTemplate: head.template,
      captures: head.captures,
      hasStack: true,
    };
  }

  const suffix = stack?.exception ? ` ⟨${stack.exception}⟩` : '';
  return {
    key: prefix + head.template + suffix,
    headTemplate: head.template,
    captures: head.captures,
    hasStack: false,
  };
}

/** Identificador curto de 8 caracteres, só para referência visual (FNV-1a de 32 bits). */
export function shortId(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
