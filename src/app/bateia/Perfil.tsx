// Perfil (RF-23): barras empilhadas por severidade ao longo do tempo (ou da ordem das linhas).
// Seleção de intervalo por arrasto ou teclado; há uma tabela equivalente para leitores de tela.

import { useRef, useState } from 'preact/hooks';
import type { Histogram } from '../../core/histogram.ts';
import { SEVERITIES, type Severity } from '../../core/types.ts';
import { formatAxis, numero } from '../format.ts';
import { t } from '../strings.ts';

const WIDTH = 960;
const HEIGHT = 120;

interface Props {
  histogram: Histogram | null;
  from: number | null;
  to: number | null;
  onSelect: (from: number | null, to: number | null) => void;
}

interface Span {
  a: number;
  b: number;
}

function bucketTotals(h: Histogram): number[] {
  const totals = new Array<number>(h.buckets).fill(0);
  for (const row of h.counts) {
    for (let i = 0; i < h.buckets; i += 1) totals[i] = (totals[i] ?? 0) + (row[i] ?? 0);
  }
  return totals;
}

function spanOf(h: Histogram, from: number | null, to: number | null): Span | null {
  if (from === null && to === null) return null;
  const a = from === null ? 0 : Math.floor((from - h.start) / h.bucketSize);
  const b = to === null ? h.buckets - 1 : Math.ceil((to - h.start) / h.bucketSize) - 1;
  return { a: Math.max(0, Math.min(a, b)), b: Math.min(h.buckets - 1, Math.max(a, b)) };
}

export function Perfil({ histogram, from, to, onSelect }: Props) {
  const [table, setTable] = useState(false);
  const [cursor, setCursor] = useState<Span | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (!histogram) {
    return <section class="perfil" aria-label={t.perfilTitulo} />;
  }

  const h = histogram;
  const totals = bucketTotals(h);
  const peak = Math.max(1, ...totals);
  const barWidth = WIDTH / h.buckets;
  const committed = spanOf(h, from, to);
  const shown = cursor ?? committed;

  const commit = (span: Span): void => {
    const lo = Math.min(span.a, span.b);
    const hi = Math.max(span.a, span.b);
    onSelect(h.start + lo * h.bucketSize, h.start + (hi + 1) * h.bucketSize);
  };

  const bucketAt = (clientX: number): number => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    const ratio = (clientX - box.left) / box.width;
    return Math.max(0, Math.min(h.buckets - 1, Math.floor(ratio * h.buckets)));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const base = cursor ?? committed ?? { a: 0, b: 0 };
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      const edge = Math.max(0, Math.min(h.buckets - 1, base.b + step));
      setCursor(event.shiftKey ? { a: base.a, b: edge } : { a: edge, b: edge });
    } else if (event.key === 'Enter' && cursor) {
      event.preventDefault();
      commit(cursor);
      setCursor(null);
    } else if (event.key === 'Escape' && (cursor || committed)) {
      event.preventDefault();
      event.stopPropagation();
      setCursor(null);
      onSelect(null, null);
    }
  };

  const bars: unknown[] = [];
  for (let i = 0; i < h.buckets; i += 1) {
    let y = HEIGHT;
    // Do mais severo (embaixo) ao menos severo (em cima).
    for (let r = SEVERITIES.length - 1; r >= 0; r -= 1) {
      const count = h.counts[r]?.[i] ?? 0;
      if (count === 0) continue;
      const height = Math.max(1, (count / peak) * (HEIGHT - 4));
      y -= height;
      const severity = SEVERITIES[r] as Severity;
      bars.push(
        <rect
          key={`${i}-${r}`}
          class={`barra barra-${severity.toLowerCase()}`}
          x={i * barWidth + 0.5}
          y={y}
          width={Math.max(1, barWidth - 1)}
          height={height}
        />,
      );
    }
  }

  const last = h.start + h.buckets * h.bucketSize;
  const resumo = t.perfilResumo(numero.format(h.total), numero.format(h.untimed));

  return (
    <section class="perfil" aria-label={t.perfilTitulo}>
      <div class="perfil-topo">
        <h2 class="subtitulo">{t.perfilTitulo}</h2>
        <button type="button" class="botao-discreto" onClick={() => setTable(!table)}>
          {table ? t.verComoGrafico : t.verComoTabela}
        </button>
      </div>
      {table ? (
        <div class="perfil-tabela" role="region" aria-label={t.perfilTabela} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.intervalo}</th>
                <th scope="col">{t.eventos}</th>
                <th scope="col">
                  <span class="entrada-oculta">{t.selecionar}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.map((total, i) =>
                total === 0 ? null : (
                  <tr key={i}>
                    <td>{formatAxis(h.axis, h.start + i * h.bucketSize)}</td>
                    <td>{numero.format(total)}</td>
                    <td>
                      <button
                        type="button"
                        class="botao-discreto"
                        onClick={() => commit({ a: i, b: i })}
                      >
                        {t.selecionar}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          ref={svgRef}
          class="perfil-grafico"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="application"
          aria-label={t.perfilAjuda}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const i = bucketAt(event.clientX);
            setAnchor(i);
            setCursor({ a: i, b: i });
          }}
          onPointerMove={(event) => {
            if (anchor !== null) setCursor({ a: anchor, b: bucketAt(event.clientX) });
          }}
          onPointerUp={(event) => {
            if (anchor !== null) commit({ a: anchor, b: bucketAt(event.clientX) });
            setAnchor(null);
            setCursor(null);
          }}
          onPointerCancel={() => {
            setAnchor(null);
            setCursor(null);
          }}
        >
          <line class="perfil-base" x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} />
          {bars}
          {shown ? (
            <rect
              class={cursor ? 'selecao selecao-ativa' : 'selecao'}
              x={Math.min(shown.a, shown.b) * barWidth}
              y="0"
              width={(Math.abs(shown.b - shown.a) + 1) * barWidth}
              height={HEIGHT}
            />
          ) : null}
        </svg>
      )}
      <div class="perfil-eixo" aria-hidden="true">
        <span>{formatAxis(h.axis, h.start)}</span>
        <span>{formatAxis(h.axis, last)}</span>
      </div>
      <p class="nota">{resumo}</p>
    </section>
  );
}
