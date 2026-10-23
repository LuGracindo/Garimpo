// A bateia: tela de trabalho depois da análise. Perfil no alto; Peneira e pepitas à esquerda;
// detalhe à direita (SDD 2.5). O filtro é a única fonte de verdade e vai inteiro ao Worker.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AnalysisResult } from '../../core/analyzer.ts';
import { EMPTY_FILTER, filterKey, isEmptyFilter, type Filter } from '../../core/filter.ts';
import type { CustomProfileSpec } from '../../core/custom-profile.ts';
import type { Histogram } from '../../core/histogram.ts';
import { Lacre, type LacreType } from '../../core/lacre.ts';
import { megabytes, numero } from '../format.ts';
import {
  OCCURRENCE_EVENT,
  actionFor,
  readShortcutsEnabled,
  writeShortcutsEnabled,
} from '../shortcuts.ts';
import { RequestCancelled, RequestFailed, type AnalysisClient } from '../worker-client.ts';
import { t } from '../strings.ts';
import { Atalhos } from './Atalhos.tsx';
import { Detalhe, type Aba } from './Detalhe.tsx';
import { LaudoTela } from './Laudo.tsx';
import { ListaPepitas, visibleNuggets } from './ListaPepitas.tsx';
import { Peneira } from './Peneira.tsx';
import { Perfil } from './Perfil.tsx';

interface Props {
  client: AnalysisClient;
  analysis: AnalysisResult;
  name: string;
  size: number;
  elapsedMs: number;
  modifiedAt: number | null;
  custom: CustomProfileSpec | null;
  onReset: () => void;
}

export function Bateia({
  client,
  analysis,
  name,
  size,
  elapsedMs,
  modifiedAt,
  custom,
  onReset,
}: Props) {
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [counts, setCounts] = useState<Map<number, number> | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const [failed, setFailed] = useState(false);
  const [regexProblem, setRegexProblem] = useState<'prazo' | null>(null);
  const [aba, setAba] = useState<Aba>('resumo');
  const [ajuda, setAjuda] = useState(false);
  const [atalhos, setAtalhos] = useState(readShortcutsEnabled);
  const [view, setView] = useState<'bateia' | 'laudo'>('bateia');
  const [lacreTypes, setLacreTypes] = useState<ReadonlySet<LacreType>>(new Set());
  const lacreKey = [...lacreTypes].sort().join(',');
  // Uma instância só para exibição; o laudo usa a sua, para marcadores determinísticos.
  const mask = useMemo(() => {
    const lacre = new Lacre(lacreTypes);
    return (text: string): string => lacre.mask(text);
  }, [lacreKey]);

  const summary = analysis.summary;
  const axis = summary.firstTimeMs !== null && summary.lastTimeMs !== null ? 'time' : 'order';
  const id = filterKey(filter);

  useEffect(() => {
    let alive = true;
    const fail = (error: unknown): void => {
      if (!alive || error instanceof RequestCancelled) return;
      if (error instanceof RequestFailed && error.code === 'GAR-RGX-002') setRegexProblem('prazo');
      else setFailed(true);
    };
    setFailed(false);
    setRegexProblem(null);
    client
      .query(filter)
      .then((reply) => {
        if (!alive) return;
        setTotal(reply.total);
        setCounts(new Map(reply.nuggetCounts));
      })
      .catch(fail);
    client
      .histogram(filter)
      .then((reply) => {
        if (alive) setHistogram(reply);
      })
      .catch(fail);
    return () => {
      alive = false;
    };
  }, [client, id]);

  const withoutNuggetFilter = { ...filter, nuggetId: null };
  const rows = visibleNuggets(
    analysis.nuggets,
    counts,
    !isEmptyFilter(withoutNuggetFilter),
    filter.nuggetId,
  );

  // Os atalhos leem o estado mais recente por ref, para o ouvinte não precisar ser refeito.
  const live = useRef({ rows, filter, atalhos });
  live.current = { rows, filter, atalhos };
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!live.current.atalhos) return;
      if (viewRef.current === 'laudo') {
        if (event.key === 'Escape') setView('bateia');
        return;
      }
      const action = actionFor(event);
      if (!action) return;
      event.preventDefault();
      const { rows: shown, filter: current } = live.current;
      if (action.kind === 'focus-search') {
        document.getElementById('campo-texto')?.focus();
      } else if (action.kind === 'nugget') {
        if (shown.length === 0) return;
        const at = shown.findIndex((row) => row.nugget.id === current.nuggetId);
        const next = at === -1 ? (action.delta === 1 ? 0 : shown.length - 1) : at + action.delta;
        const target = shown[Math.max(0, Math.min(shown.length - 1, next))];
        if (target) setFilter({ ...current, nuggetId: target.nugget.id });
      } else if (action.kind === 'open') {
        setAba('ocorrencias');
        window.setTimeout(() => document.querySelector<HTMLElement>('.virtual')?.focus(), 50);
      } else if (action.kind === 'occurrence') {
        window.dispatchEvent(new CustomEvent(OCCURRENCE_EVENT, { detail: action.delta }));
      } else if (action.kind === 'laudo') {
        setView('laudo');
      } else if (action.kind === 'filters') {
        document.querySelector<HTMLElement>('.nivel')?.focus();
      } else {
        setAjuda(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nugget = analysis.nuggets.find((n) => n.id === filter.nuggetId) ?? null;

  return (
    <div class="bateia">
      <header class="bateia-topo">
        <div>
          <h2 class="cartao-titulo">
            {numero.format(summary.events)} eventos em {numero.format(summary.lines)} linhas.
          </h2>
          <p class="arquivo">
            {mask(name)} · {megabytes(size)} · {numero.format(Math.round(elapsedMs))} ms
            {total !== null && !isEmptyFilter(filter) ? ` · ${numero.format(total)} no filtro` : ''}
          </p>
        </div>
        <div class="bateia-acoes">
          <button type="button" class="botao-discreto" onClick={() => setView('laudo')}>
            {t.exportarLaudo} (e)
          </button>
          <button type="button" class="botao-discreto" onClick={() => setAjuda(true)}>
            {t.atalhosBotao} (?)
          </button>
          <button type="button" class="botao" onClick={onReset}>
            {t.novaJazida}
          </button>
        </div>
      </header>
      {ajuda ? (
        <Atalhos
          enabled={atalhos}
          onToggle={(value) => {
            setAtalhos(value);
            writeShortcutsEnabled(value);
          }}
          onClose={() => setAjuda(false)}
        />
      ) : null}

      {view === 'laudo' ? (
        <LaudoTela
          client={client}
          analysis={analysis}
          name={name}
          size={size}
          modifiedAt={modifiedAt}
          custom={custom}
          lacreTypes={lacreTypes}
          onLacreTypes={setLacreTypes}
          onBack={() => setView('bateia')}
        />
      ) : (
        <>
          {failed ? (
            <p class="erro" role="alert">
              {t.falhaConsulta}
            </p>
          ) : null}

          <Perfil
            histogram={histogram}
            from={filter.from}
            to={filter.to}
            onSelect={(from, to) => setFilter({ ...filter, from, to })}
          />

          <div class="bateia-corpo">
            <div class="bateia-esquerda">
              <Peneira
                filter={filter}
                axis={axis}
                severityCounts={summary.severityCounts}
                onChange={setFilter}
                textInputId="campo-texto"
                regexProblem={regexProblem}
              />
              <ListaPepitas
                nuggets={analysis.nuggets}
                counts={counts}
                selectedId={filter.nuggetId}
                filtered={!isEmptyFilter(withoutNuggetFilter)}
                mask={mask}
                onSelect={(nuggetId) => setFilter({ ...filter, nuggetId })}
              />
              {analysis.nuggets.length < summary.nuggetCount ? (
                <p class="nota">{t.pepitasLimite(analysis.nuggets.length, summary.nuggetCount)}</p>
              ) : null}
            </div>
            <Detalhe
              client={client}
              analysis={analysis}
              nugget={nugget}
              filter={filter}
              filterId={id}
              aba={aba}
              onAba={setAba}
              mask={mask}
            />
          </div>
        </>
      )}
    </div>
  );
}
