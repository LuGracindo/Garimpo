// Detalhe com as abas Resumo, Ocorrências e Sedimento (SDD, tela da Bateia).

import { useState } from 'preact/hooks';
import type { AnalysisResult, NuggetView } from '../../core/analyzer.ts';
import type { Filter } from '../../core/filter.ts';
import { SEVERITIES } from '../../core/types.ts';
import type { OccurrenceRowMessage } from '../../shared/protocol.ts';
import { formatTime, numero } from '../format.ts';
import type { AnalysisClient } from '../worker-client.ts';
import { t } from '../strings.ts';
import { Avisos } from './Avisos.tsx';
import { Contexto } from './Contexto.tsx';
import { Ocorrencias } from './Ocorrencias.tsx';

export type Aba = 'resumo' | 'ocorrencias' | 'sedimento';

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'resumo', rotulo: t.abaResumo },
  { id: 'ocorrencias', rotulo: t.abaOcorrencias },
  { id: 'sedimento', rotulo: t.abaSedimento },
];

interface Props {
  client: AnalysisClient;
  analysis: AnalysisResult;
  nugget: NuggetView | null;
  filter: Filter;
  filterId: string;
  aba: Aba;
  onAba: (aba: Aba) => void;
}

function Resumo({ analysis, nugget }: { analysis: AnalysisResult; nugget: NuggetView | null }) {
  const s = analysis.summary;
  const counts = nugget ? nugget.severityCounts : s.severityCounts;
  const first = nugget ? nugget.firstTimeMs : s.firstTimeMs;
  const last = nugget ? nugget.lastTimeMs : s.lastTimeMs;
  return (
    <div class="resumo">
      {nugget ? (
        <>
          <p class="rotulo">{t.gabarito}</p>
          <p class="pepita-gabarito">{nugget.template || '(mensagem vazia)'}</p>
          {nugget.hasStack ? (
            <>
              <p class="rotulo">{t.primeiraMensagem}</p>
              <p class="pepita-gabarito">{nugget.headTemplate || '(mensagem vazia)'}</p>
            </>
          ) : null}
          {nugget.markers.length > 0 ? (
            <>
              <p class="rotulo">{t.valoresVariaram}</p>
              <ul class="marcadores">
                {nugget.markers.map((marker) => (
                  <li key={marker.marker}>
                    <span class="marcador">{marker.marker}</span>
                    <span>{t.distintos(marker.distinct, marker.capped)}</span>
                    <span class="marcador-ex">{marker.examples.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : s.profile ? (
        <p class="nota">{t.formatoEscolhido(s.profile, s.profileSource, s.confidence)}</p>
      ) : null}
      <dl class="numeros">
        <div>
          <dt>{t.total}</dt>
          <dd>{numero.format(nugget ? nugget.count : s.events)}</dd>
        </div>
        {SEVERITIES.slice()
          .reverse()
          .map((level) => (
            <div key={level}>
              <dt>{level}</dt>
              <dd>{numero.format(counts[level])}</dd>
            </div>
          ))}
      </dl>
      <dl class="numeros">
        <div>
          <dt>{t.primeira}</dt>
          <dd>{first === null ? t.semHorario : formatTime(first)}</dd>
        </div>
        <div>
          <dt>{t.ultima}</dt>
          <dd>{last === null ? t.semHorario : formatTime(last)}</dd>
        </div>
      </dl>
      {nugget ? null : <Avisos analysis={analysis} />}
    </div>
  );
}

export function Detalhe({ client, analysis, nugget, filter, filterId, aba, onAba: setAba }: Props) {
  const [active, setActive] = useState<OccurrenceRowMessage | null>(null);

  const onTabKey = (event: KeyboardEvent): void => {
    const i = ABAS.findIndex((a) => a.id === aba);
    const next = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = ABAS[(next + ABAS.length) % ABAS.length];
    if (!target) return;
    setAba(target.id);
    document.getElementById(`aba-${target.id}`)?.focus();
  };

  return (
    <section class="detalhe" aria-label={t.abasRotulo}>
      <div class="abas" role="tablist" aria-label={t.abasRotulo} onKeyDown={onTabKey}>
        {ABAS.map((item) => (
          <button
            key={item.id}
            id={`aba-${item.id}`}
            type="button"
            role="tab"
            class="aba"
            aria-selected={aba === item.id}
            aria-controls="painel-aba"
            tabIndex={aba === item.id ? 0 : -1}
            onClick={() => setAba(item.id)}
          >
            {item.rotulo}
          </button>
        ))}
      </div>
      <div id="painel-aba" role="tabpanel" aria-labelledby={`aba-${aba}`} class="painel-aba">
        {aba === 'resumo' ? (
          <Resumo analysis={analysis} nugget={nugget} />
        ) : (
          <>
            <p class="nota">{aba === 'sedimento' ? t.sedimentoAjuda : t.ocorrenciasAjuda}</p>
            <Ocorrencias
              key={`${aba}-${filterId}`}
              client={client}
              filter={aba === 'sedimento' ? { ...filter, nuggetId: null } : filter}
              label={aba === 'sedimento' ? t.abaSedimento : t.ocorrenciasLista}
              onActive={setActive}
            />
            <Contexto client={client} event={active ? active.event : null} />
          </>
        )}
      </div>
    </section>
  );
}
