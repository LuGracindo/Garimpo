// Lista virtualizada de ocorrências (RF-27): só as linhas visíveis existem no DOM; as páginas
// de dados vêm do Worker sob demanda e ficam em cache enquanto o filtro não muda.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Filter } from '../../core/filter.ts';
import { pageOf, visibleWindow } from '../../core/virtual.ts';
import type { OccurrenceRowMessage } from '../../shared/protocol.ts';
import { formatTime, numero } from '../format.ts';
import { OCCURRENCE_EVENT } from '../shortcuts.ts';
import { RequestCancelled, type AnalysisClient } from '../worker-client.ts';
import { t } from '../strings.ts';

export const ROW_HEIGHT = 28;
export const PAGE_SIZE = 100;
const FALLBACK_VIEWPORT = 360;

interface Props {
  client: AnalysisClient;
  filter: Filter;
  label: string;
  onActive: (row: OccurrenceRowMessage | null) => void;
  mask: (text: string) => string;
}

export function Ocorrencias({ client, filter, label, onActive, mask }: Props) {
  const pages = useRef(new Map<number, OccurrenceRowMessage[]>());
  const inflight = useRef(new Set<number>());
  const box = useRef<HTMLDivElement | null>(null);
  const [version, setVersion] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);

  const viewport = box.current?.clientHeight || FALLBACK_VIEWPORT;
  const count = total ?? 0;
  const win = visibleWindow({
    scrollTop,
    viewportHeight: viewport,
    rowHeight: ROW_HEIGHT,
    total: count,
  });

  const load = (page: number): void => {
    if (pages.current.has(page) || inflight.current.has(page)) return;
    inflight.current.add(page);
    client
      .occurrences(filter, page * PAGE_SIZE, PAGE_SIZE)
      .then((reply) => {
        pages.current.set(page, reply.rows);
        setTotal(reply.total);
        setVersion((v) => v + 1);
      })
      .catch((error: unknown) => {
        if (!(error instanceof RequestCancelled)) setFailed(true);
      })
      .finally(() => {
        inflight.current.delete(page);
      });
  };

  // Primeira página e páginas das linhas visíveis.
  useEffect(() => {
    load(0);
    if (count === 0) return;
    for (
      let page = pageOf(win.start, PAGE_SIZE);
      page <= pageOf(Math.max(win.start, win.end - 1), PAGE_SIZE);
      page += 1
    ) {
      load(page);
    }
  }, [win.start, win.end, count]);

  const rowAt = (index: number): OccurrenceRowMessage | undefined =>
    pages.current.get(pageOf(index, PAGE_SIZE))?.[index % PAGE_SIZE];

  useEffect(() => {
    onActive(rowAt(active) ?? null);
  }, [active, version]);

  const move = (next: number): void => {
    if (count === 0) return;
    const index = Math.max(0, Math.min(count - 1, next));
    setActive(index);
    const el = box.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  };

  // Atalhos [ e ] chegam por evento da janela, com o passo (−1 ou +1).
  const latest = useRef({ active, move });
  latest.current = { active, move };
  useEffect(() => {
    const onStep = (event: Event): void => {
      const delta = (event as CustomEvent<number>).detail;
      latest.current.move(latest.current.active + delta);
    };
    window.addEventListener(OCCURRENCE_EVENT, onStep);
    return () => window.removeEventListener(OCCURRENCE_EVENT, onStep);
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    const pageRows = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
    const target =
      event.key === 'ArrowDown'
        ? active + 1
        : event.key === 'ArrowUp'
          ? active - 1
          : event.key === 'PageDown'
            ? active + pageRows
            : event.key === 'PageUp'
              ? active - pageRows
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? count - 1
                  : null;
    if (target === null) return;
    event.preventDefault();
    move(target);
  };

  if (failed) {
    return (
      <p class="erro" role="alert">
        {t.falhaConsulta}
      </p>
    );
  }
  if (total === 0) return <p class="nota">{t.nenhumaOcorrencia}</p>;

  const items: unknown[] = [];
  for (let i = win.start; i < win.end; i += 1) {
    const row = rowAt(i);
    items.push(
      <div
        key={i}
        id={`ocorrencia-${i}`}
        role="option"
        aria-selected={i === active}
        aria-setsize={count}
        aria-posinset={i + 1}
        class={i === active ? 'ocorrencia ocorrencia-ativa' : 'ocorrencia'}
        onClick={() => {
          setActive(i);
          box.current?.focus();
        }}
      >
        {row ? (
          <>
            <span class="oc-tempo">{row.timeMs === null ? '—' : formatTime(row.timeMs)}</span>
            <span class={`oc-nivel sev-${row.severity.toLowerCase()}`}>
              <span class="sev">{row.severity}</span>
            </span>
            <span class="oc-texto">{mask(row.text)}</span>
          </>
        ) : (
          <span class="oc-texto nota">{t.carregando}</span>
        )}
      </div>,
    );
  }

  return (
    <div class="ocorrencias">
      <p class="nota">{total === null ? t.carregando : `${numero.format(count)} ocorrências`}</p>
      <div
        ref={box}
        class="virtual"
        role="listbox"
        aria-label={label}
        aria-activedescendant={`ocorrencia-${active}`}
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        <div class="virtual-altura" style={{ height: `${win.totalHeight}px` }}>
          <div class="virtual-janela" style={{ transform: `translateY(${win.offsetTop}px)` }}>
            {items}
          </div>
        </div>
      </div>
    </div>
  );
}
