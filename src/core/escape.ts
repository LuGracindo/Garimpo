// Escape do laudo (SEG-04): UMA função para todo texto que entra em HTML. O laudo não tem
// scripts, URLs nem CSS dinâmico, então só há dois contextos: texto e valor de atributo.
// Tudo que vem do log passa por aqui, depois de truncado por limite.

export type EscapeContext = 'texto' | 'atributo';

const REPLACEMENTS: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
  '/': '&#47;',
};

/** Caracteres de controle (exceto tab e quebra de linha) viram o caractere de substituição. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;

export function escapeHtml(value: unknown, context: EscapeContext = 'texto'): string {
  const text = String(value).replace(CONTROL, '\uFFFD');
  const escaped = text.replace(/[&<>"'`=/]/g, (ch) => REPLACEMENTS[ch] ?? ch);
  return context === 'atributo' ? escaped.replace(/\n/g, '&#10;').replace(/\t/g, '&#9;') : escaped;
}

/** Desfaz o escape de `escapeHtml` (usado pelo verificador para reler o JSON embutido). */
export function unescapeHtml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|#96|#61|#47|#10|#9);/g, (entity) => {
    switch (entity) {
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&#39;':
        return "'";
      case '&#96;':
        return '`';
      case '&#61;':
        return '=';
      case '&#47;':
        return '/';
      case '&#10;':
        return '\n';
      case '&#9;':
        return '\t';
      default:
        return '&';
    }
  });
}

/** Trunca por limite de caracteres, sem cortar um par substituto ao meio. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}
