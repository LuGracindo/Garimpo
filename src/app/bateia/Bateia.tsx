// A bateia: tela de trabalho depois da análise. Perfil no alto; Peneira e pepitas à esquerda;
// detalhe à direita (SDD 2.5). O filtro é a única fonte de verdade e vai inteiro ao Worker.

import { useEffect, useState } from 'preact/hooks';
import type { AnalysisResult } from '../../core/analyzer.ts';
import { EMPTY_FILTER, filterKey, isEmptyFilter, type Filter } from '../../core/filter.ts';
import type { Histogram } from '../../core/histogram.ts';
import { megabytes, numero } from '../format.ts';
import { RequestCancelled, type AnalysisClient } from '../worker-client.ts';
import { t } from '../strings.ts';
import { Detalhe } from './Detalhe.tsx';
import { ListaPepitas } from './ListaPepitas.tsx';
import { Peneira } from './Peneira.tsx';
import { Perfil } from './Perfil.tsx';

interface Props {
  client: AnalysisClient;
  analysis: AnalysisResult;
  name: string;
  size: number;
  elapsedMs: number;
  onReset: () => void;
}

export function Bateia({ client, analysis, name, size, elapsedMs, onReset }: Props) {
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [counts, setCounts] = useState<Map<number, number> | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const [failed, setFailed] = useState(false);

  const summary = analysis.summary;
  const axis = summary.firstTimeMs !== null && summary.lastTimeMs !== null ? 'time' : 'order';
  const id = filterKey(filter);

  useEffect(() => {
    let alive = true;
    const fail = (error: unknown): void => {
      if (alive && !(error instanceof RequestCancelled)) setFailed(true);
    };
    setFailed(false);
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

  const nugget = analysis.nuggets.find((n) => n.id === filter.nuggetId) ?? null;
  const withoutNugget = { ...filter, nuggetId: null };

  return (
    <div class="bateia">
      <header class="bateia-topo">
        <div>
          <h2 class="cartao-titulo">
            {numero.format(summary.events)} eventos em {numero.format(summary.lines)} linhas.
          </h2>
          <p class="arquivo">
            {name} · {megabytes(size)} · {numero.format(Math.round(elapsedMs))} ms
            {total !== null && !isEmptyFilter(filter) ? ` · ${numero.format(total)} no filtro` : ''}
          </p>
        </div>
        <button type="button" class="botao" onClick={onReset}>
          {t.novaJazida}
        </button>
      </header>

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
          />
          <ListaPepitas
            nuggets={analysis.nuggets}
            counts={counts}
            selectedId={filter.nuggetId}
            filtered={!isEmptyFilter(withoutNugget)}
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
        />
      </div>
    </div>
  );
}
