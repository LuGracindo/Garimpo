// Peneira (RF-25): níveis, texto literal e intervalo. O filtro vive em Bateia; aqui só se edita.

import { useEffect, useState } from 'preact/hooks';
import { EMPTY_FILTER, MAX_TEXT_LENGTH, isEmptyFilter, type Filter } from '../../core/filter.ts';
import { compilePattern, hasNestedQuantifier } from '../../core/regex.ts';
import { SEVERITIES, type Severity } from '../../core/types.ts';
import { formatAxis, numero } from '../format.ts';
import { t } from '../strings.ts';

interface Props {
  filter: Filter;
  axis: 'time' | 'order';
  severityCounts: Record<Severity, number>;
  onChange: (filter: Filter) => void;
  textInputId: string;
  /** Falha da última busca por regex vinda do Worker (prazo estourado). */
  regexProblem: 'prazo' | null;
}

const TEXT_DEBOUNCE_MS = 300;

export function Peneira({
  filter,
  axis,
  severityCounts,
  onChange,
  textInputId,
  regexProblem,
}: Props) {
  const [text, setText] = useState(filter.text);

  // Mantém o campo em sincronia quando o filtro é limpo por fora.
  useEffect(() => {
    setText(filter.text);
  }, [filter.text]);

  const syntaxError = filter.regex && text !== '' && !compilePattern(text, filter.caseSensitive).ok;

  useEffect(() => {
    if (text === filter.text) return undefined;
    // Regex com erro de sintaxe nem chega ao Worker: o aviso aparece aqui, na hora.
    if (filter.regex && text !== '' && !compilePattern(text, filter.caseSensitive).ok)
      return undefined;
    const timer = window.setTimeout(() => onChange({ ...filter, text }), TEXT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, filter.regex, filter.caseSensitive]);

  const toggleLevel = (level: Severity): void => {
    const has = filter.levels.includes(level);
    const levels = has ? filter.levels.filter((l) => l !== level) : [...filter.levels, level];
    onChange({ ...filter, levels: levels.length === SEVERITIES.length ? [] : levels });
  };

  const hasRange = filter.from !== null || filter.to !== null;

  return (
    <section class="peneira" aria-labelledby="titulo-peneira">
      <h2 class="subtitulo" id="titulo-peneira">
        {t.peneiraTitulo}
      </h2>

      <fieldset class="niveis">
        <legend class="rotulo">{t.niveis}</legend>
        {[...SEVERITIES].reverse().map((level) => {
          const on = filter.levels.length === 0 || filter.levels.includes(level);
          return (
            <button
              key={level}
              type="button"
              class={`nivel nivel-${level.toLowerCase()}`}
              aria-pressed={on}
              onClick={() => toggleLevel(level)}
            >
              <span class="nivel-marca" aria-hidden="true" />
              <span>{level}</span>
              <span class="nivel-n">{numero.format(severityCounts[level])}</span>
            </button>
          );
        })}
      </fieldset>

      <div class="campo">
        <label class="rotulo" for={textInputId}>
          {t.textoRotulo}
        </label>
        <input
          id={textInputId}
          class="entrada"
          type="search"
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          placeholder={t.textoDica}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <label class="caixa">
          <input
            type="checkbox"
            checked={filter.caseSensitive}
            onChange={(event) =>
              onChange({ ...filter, caseSensitive: event.currentTarget.checked })
            }
          />
          <span>{t.diferenciarCaixa}</span>
        </label>
        <label class="caixa">
          <input
            type="checkbox"
            checked={filter.regex}
            onChange={(event) => onChange({ ...filter, regex: event.currentTarget.checked })}
          />
          <span>{t.regexRotulo}</span>
        </label>
        {syntaxError ? (
          <p class="erro" role="alert">
            {t.regexInvalida}
          </p>
        ) : regexProblem === 'prazo' && filter.regex ? (
          <p class="erro" role="alert">
            {t.regexPrazo}
          </p>
        ) : filter.regex && hasNestedQuantifier(text) ? (
          <p class="nota">{t.regexAviso}</p>
        ) : null}
      </div>

      {hasRange ? (
        <p class="chip">
          <span>
            {t.intervaloAtivo(
              filter.from === null ? '…' : formatAxis(axis, filter.from),
              filter.to === null ? '…' : formatAxis(axis, filter.to),
            )}
          </span>
          <button
            type="button"
            class="botao-discreto"
            onClick={() => onChange({ ...filter, from: null, to: null })}
          >
            {t.limparIntervalo}
          </button>
        </p>
      ) : null}

      {!isEmptyFilter(filter) ? (
        <button
          type="button"
          class="botao-discreto"
          onClick={() => {
            setText('');
            onChange(EMPTY_FILTER);
          }}
        >
          {t.limparTudo}
        </button>
      ) : null}
    </section>
  );
}
