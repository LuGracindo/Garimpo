// Formatação de números e instantes para a interface.

export const numero = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function megabytes(bytes: number): string {
  return `${decimal.format(bytes / (1024 * 1024))} MB`;
}

/** Instante em UTC, no formato `2026-10-22 14:03:05` (milissegundos só quando existem). */
export function formatTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  const text = date.toISOString().replace('T', ' ').replace('Z', '');
  return text.endsWith('.000') ? text.slice(0, -4) : text;
}

/** Posição no eixo do Perfil: instante, ou número do evento quando o log não tem tempo. */
export function formatAxis(axis: 'time' | 'order', value: number): string {
  return axis === 'time' ? formatTime(value) : `evento ${numero.format(Math.floor(value) + 1)}`;
}
