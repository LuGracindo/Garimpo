// Lista de pepitas com a contagem sob o filtro atual (RF-24). Escolher uma pepita a filtra.

import type { NuggetView } from '../../core/analyzer.ts';
import { numero } from '../format.ts';
import { t } from '../strings.ts';

interface Props {
  nuggets: NuggetView[];
  /** Contagem por pepita sob o filtro; null enquanto não chegou. */
  counts: Map<number, number> | null;
  selectedId: number | null;
  filtered: boolean;
  onSelect: (id: number | null) => void;
}

export function ListaPepitas({ nuggets, counts, selectedId, filtered, onSelect }: Props) {
  const rows = nuggets
    .map((nugget) => ({
      nugget,
      count: counts && filtered ? (counts.get(nugget.id) ?? 0) : nugget.count,
    }))
    .filter((row) => !filtered || row.count > 0 || row.nugget.id === selectedId);

  return (
    <section class="lista-pepitas" aria-labelledby="titulo-pepitas">
      <h2 class="subtitulo" id="titulo-pepitas">
        {t.pepitasTitulo}
      </h2>
      {rows.length === 0 ? (
        <p class="nota">{t.nenhumaPepita}</p>
      ) : (
        <ol class="pepitas">
          {rows.map(({ nugget, count }) => {
            const selected = nugget.id === selectedId;
            return (
              <li key={nugget.id}>
                <button
                  type="button"
                  class={`pepita pepita-botao sev-${nugget.dominant.toLowerCase()}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : nugget.id)}
                >
                  <span class="pepita-topo">
                    <span class="sev">{nugget.dominant}</span>
                    <span class="pepita-contagem">{numero.format(count)}×</span>
                    {nugget.isNew ? <span class="etiqueta">{t.nova}</span> : null}
                    <span class="pepita-id">{nugget.shortId}</span>
                  </span>
                  <span class="pepita-gabarito pepita-linhas">
                    {nugget.template || '(mensagem vazia)'}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
