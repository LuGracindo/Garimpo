// Cálculo da janela de uma lista virtualizada (RF-27): só as linhas visíveis (mais uma folga)
// existem no DOM; o resto é só altura.

export interface VirtualInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  total: number;
  overscan?: number;
}

export interface VirtualWindow {
  /** Primeira linha a desenhar (inclusiva) e última (exclusiva). */
  start: number;
  end: number;
  /** Deslocamento vertical da primeira linha desenhada. */
  offsetTop: number;
  totalHeight: number;
}

export function visibleWindow(input: VirtualInput): VirtualWindow {
  const overscan = input.overscan ?? 6;
  const rowHeight = Math.max(1, input.rowHeight);
  const total = Math.max(0, input.total);
  const first = Math.floor(Math.max(0, input.scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, input.viewportHeight) / rowHeight) + 1;
  const start = Math.min(total, Math.max(0, first - overscan));
  const end = Math.min(total, first + visible + overscan);
  return { start, end, offsetTop: start * rowHeight, totalHeight: total * rowHeight };
}

export function pageOf(index: number, pageSize: number): number {
  return Math.floor(index / pageSize);
}
