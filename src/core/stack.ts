// Assinatura de stack trace (SDD 7.3): classe da exceção + 3 primeiros frames + classe da
// última causa ("Caused by"). Entende o formato Java e JavaScript ("at ...") e o Python.

export interface StackSignature {
  exception: string | null;
  frames: string[];
  cause: string | null;
}

const MAX_FRAMES = 3;
const EXCEPTION_START = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?::|\s|$)/;
const EXCEPTION_NAME = /(Exception|Error|Throwable|Fault|Panic)$/;
const CAUSE = /^Caused by:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/;
const PYTHON_FRAME = /^File ".+", line \d+/;

function tidyFrame(frame: string): string {
  return frame
    .replace(/^at\s+/, '')
    .replace(/\/0x[0-9A-Fa-f]+/g, '')
    .replace(/\$\d+/g, '$N');
}

function looksLikeException(name: string): boolean {
  return name.includes('.') || EXCEPTION_NAME.test(name);
}

export function extractStack(lines: readonly string[]): StackSignature | null {
  let exception: string | null = null;
  let cause: string | null = null;
  const frames: string[] = [];

  for (const raw of lines) {
    const text = raw.trim();
    if (text.length === 0) continue;

    if (text.startsWith('at ') && text.length > 3) {
      if (frames.length < MAX_FRAMES) frames.push(tidyFrame(text));
      continue;
    }
    if (PYTHON_FRAME.test(text)) {
      if (frames.length < MAX_FRAMES) frames.push(tidyFrame(text));
      continue;
    }
    const causeMatch = CAUSE.exec(text);
    if (causeMatch) {
      cause = causeMatch[1] ?? null;
      continue;
    }
    // Só linhas sem indentação podem nomear a exceção; código indentado é ignorado.
    if (exception === null && raw === raw.trimStart() && !text.startsWith('...')) {
      const match = EXCEPTION_START.exec(text);
      const name = match?.[1];
      if (name && looksLikeException(name)) exception = name;
    }
  }

  if (exception === null && frames.length === 0 && cause === null) return null;
  return { exception, frames, cause };
}
