// Editor de perfil personalizado: a pessoa descreve o formato com uma regex de grupos nomeados e
// vê, ao vivo, como as primeiras linhas do arquivo seriam lidas.

import { useEffect, useRef, useState } from 'preact/hooks';
import {
  TIME_FORMATS,
  buildCustomProfile,
  type CustomProfileSpec,
  type Preview,
  type SpecProblem,
  type TimeFormat,
} from '../../core/custom-profile.ts';
import { SEVERITIES, type Severity } from '../../core/types.ts';
import { formatTime, numero } from '../format.ts';
import { t } from '../strings.ts';
import { RequestCancelled, type AnalysisClient } from '../worker-client.ts';

const PREVIEW_DEADLINE_MS = 3000;
const DEBOUNCE_MS = 350;

interface Row {
  key: string;
  level: Severity;
}

const MODELOS: { nome: string; spec: Omit<CustomProfileSpec, 'name'> }[] = [
  {
    nome: 'Data, nível e mensagem',
    spec: {
      pattern:
        '^(?<data>\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?) +(?<nivel>\\w+) +(?<msg>.*)$',
      timeFormat: 'iso',
      levelMap: {},
      continuation: 'general',
    },
  },
  {
    nome: 'Nível numérico, data e mensagem',
    spec: {
      pattern:
        '^Lvl: (?<nivel>\\d+) - .*? - (?<data>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}[:.]\\d{3}) - (?<msg>.*)$',
      timeFormat: 'iso',
      levelMap: { '1': 'ERROR', '2': 'WARN', '10': 'INFO' },
      continuation: 'general',
    },
  },
  {
    nome: 'Data brasileira, nível entre colchetes e mensagem',
    spec: {
      pattern:
        '^(?<data>\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?) \\[(?<nivel>\\w+)\\] (?<msg>.*)$',
      timeFormat: 'br',
      levelMap: {},
      continuation: 'general',
    },
  },
  {
    nome: 'Só a mensagem (linha inteira)',
    spec: { pattern: '^(?<msg>.+)$', timeFormat: 'iso', levelMap: {}, continuation: 'any' },
  },
];

function problemText(problem: SpecProblem): string {
  switch (problem) {
    case 'nome':
      return t.perfilProblemaNome;
    case 'padrao-vazio':
      return t.perfilProblemaVazio;
    case 'padrao-longo':
      return t.perfilProblemaLongo;
    case 'sintaxe':
      return t.perfilProblemaSintaxe;
    case 'sem-mensagem':
      return t.perfilProblemaMensagem;
    case 'aninhado':
      return t.perfilProblemaAninhado;
    case 'campos':
      return t.perfilProblemaCampos;
  }
}

interface Props {
  client: AnalysisClient;
  file: Blob;
  fileName: string;
  initial: CustomProfileSpec | null;
  onUse: (spec: CustomProfileSpec, save: boolean) => void;
  onCancel: () => void;
}

export function EditorPerfil({ client, file, fileName, initial, onUse, onCancel }: Props) {
  const start = initial ?? ({ name: '', ...MODELOS[0]?.spec } as CustomProfileSpec);
  const [name, setName] = useState(start.name);
  const [pattern, setPattern] = useState(start.pattern);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(start.timeFormat);
  const [continuation, setContinuation] = useState<'any' | 'general'>(start.continuation);
  const [rows, setRows] = useState<Row[]>(
    Object.entries(start.levelMap).map(([key, level]) => ({ key, level })),
  );
  const [save, setSave] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [slow, setSlow] = useState(false);
  const [problem, setProblem] = useState<SpecProblem | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  const levelMap: Record<string, Severity> = {};
  for (const row of rows) if (row.key.trim() !== '') levelMap[row.key.trim()] = row.level;
  const spec: CustomProfileSpec = {
    name: name.trim(),
    pattern,
    timeFormat,
    levelMap,
    continuation,
  };
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    // O nome só é exigido ao salvar; a pré-visualização usa um nome provisório.
    const probe = { ...spec, name: spec.name === '' ? 'teste' : spec.name };
    const built = buildCustomProfile(probe);
    setSlow(false);
    if (!built.ok) {
      setProblem(built.problem);
      setPreview(null);
      return undefined;
    }
    setProblem(null);
    let alive = true;
    const timer = window.setTimeout(() => {
      const deadline = window.setTimeout(() => {
        if (!alive) return;
        // Padrão que travou o Worker: derruba e recria.
        alive = false;
        setSlow(true);
        client.restart();
      }, PREVIEW_DEADLINE_MS);
      client
        .previewProfile(file, probe)
        .then((result) => {
          if (alive) setPreview(result);
        })
        .catch((error: unknown) => {
          if (alive && !(error instanceof RequestCancelled)) setPreview(null);
        })
        .finally(() => window.clearTimeout(deadline));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [specKey]);

  const loadModel = (index: number): void => {
    const model = MODELOS[index];
    if (!model) return;
    setPattern(model.spec.pattern);
    setTimeFormat(model.spec.timeFormat);
    setContinuation(model.spec.continuation);
    setRows(Object.entries(model.spec.levelMap).map(([key, level]) => ({ key, level })));
  };

  const canUse =
    problem === null && spec.name !== '' && preview !== null && preview.matched > 0 && !slow;

  return (
    <section class="cartao editor-perfil" aria-labelledby="titulo-editor">
      <h2 class="cartao-titulo" id="titulo-editor" ref={heading} tabIndex={-1}>
        {t.perfilEditorTitulo}
      </h2>
      <p class="arquivo">{fileName}</p>
      <p class="nota">{t.perfilEditorAjuda}</p>

      <div class="campo">
        <label class="rotulo" for="perfil-modelo">
          {t.perfilModelo}
        </label>
        <select
          id="perfil-modelo"
          class="entrada"
          onChange={(e) => {
            const index = Number(e.currentTarget.value);
            if (index >= 0) loadModel(index);
            e.currentTarget.value = '-1';
          }}
        >
          <option value="-1">{t.perfilModeloEscolher}</option>
          {MODELOS.map((m, i) => (
            <option key={m.nome} value={i}>
              {m.nome}
            </option>
          ))}
        </select>
      </div>

      <div class="campo">
        <label class="rotulo" for="perfil-nome">
          {t.perfilNome}
        </label>
        <input
          id="perfil-nome"
          class="entrada"
          type="text"
          maxLength={40}
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </div>

      <div class="campo">
        <label class="rotulo" for="perfil-padrao">
          {t.perfilPadrao}
        </label>
        <textarea
          id="perfil-padrao"
          class="entrada"
          rows={3}
          maxLength={500}
          spellcheck={false}
          value={pattern}
          onInput={(e) => setPattern(e.currentTarget.value)}
        />
        <p class="nota">{t.perfilGrupos}</p>
        {problem ? (
          <p class="erro" role="alert">
            {problemText(problem)}
          </p>
        ) : null}
        {slow ? (
          <p class="erro" role="alert">
            {t.perfilLento}
          </p>
        ) : null}
      </div>

      <div class="campo">
        <label class="rotulo" for="perfil-hora">
          {t.perfilHora}
        </label>
        <select
          id="perfil-hora"
          class="entrada"
          value={timeFormat}
          onChange={(e) => setTimeFormat(e.currentTarget.value as TimeFormat)}
        >
          {TIME_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t.perfilFormatosHora[f]}
            </option>
          ))}
        </select>
      </div>

      <fieldset class="campo mapa-niveis">
        <legend class="rotulo">{t.perfilNiveis}</legend>
        {rows.map((row, i) => (
          <div key={i} class="mapa-linha">
            <input
              class="entrada"
              type="text"
              aria-label={t.perfilNivelValor}
              maxLength={40}
              value={row.key}
              onInput={(e) => {
                const key = e.currentTarget.value;
                setRows(rows.map((r, j) => (j === i ? { ...r, key } : r)));
              }}
            />
            <select
              class="entrada"
              aria-label={t.perfilNivelPara}
              value={row.level}
              onChange={(e) => {
                const level = e.currentTarget.value as Severity;
                setRows(rows.map((r, j) => (j === i ? { ...r, level } : r)));
              }}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="botao-discreto"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              {t.remover}
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            class="botao-discreto"
            onClick={() => setRows([...rows, { key: '', level: 'INFO' }])}
          >
            {t.perfilAdicionarNivel}
          </button>
        </div>
        <p class="nota">{t.perfilNiveisAjuda}</p>
      </fieldset>

      <label class="caixa">
        <input
          type="checkbox"
          checked={continuation === 'any'}
          onChange={(e) => setContinuation(e.currentTarget.checked ? 'any' : 'general')}
        />
        <span>{t.perfilContinuacao}</span>
      </label>

      <section aria-labelledby="titulo-previa" class="previa">
        <h3 class="subtitulo" id="titulo-previa">
          {t.perfilPrevia}
        </h3>
        {preview ? (
          <>
            <p class="nota" role="status">
              {t.perfilPreviaResumo(
                numero.format(preview.matched),
                numero.format(preview.tested),
                numero.format(preview.withTime),
                numero.format(preview.withLevel),
              )}
            </p>
            <div class="previa-tabela" role="region" aria-label={t.perfilPrevia} tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t.perfilColLinha}</th>
                    <th scope="col">{t.perfilColHora}</th>
                    <th scope="col">{t.perfilColNivel}</th>
                    <th scope="col">{t.perfilColMensagem}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.samples.map((sample, i) => (
                    <tr key={i} class={sample.matched ? '' : 'previa-nao'}>
                      <td class="previa-linha">{sample.line}</td>
                      {sample.matched ? (
                        <>
                          <td>{sample.timeMs === null ? '—' : formatTime(sample.timeMs)}</td>
                          <td>{sample.level ?? '—'}</td>
                          <td>{sample.message}</td>
                        </>
                      ) : (
                        <td colSpan={3}>{t.perfilNaoCasou}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p class="nota">{problem ? t.perfilPreviaCorrija : t.carregando}</p>
        )}
      </section>

      <label class="caixa">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.currentTarget.checked)} />
        <span>{t.perfilSalvar}</span>
      </label>

      <div class="acoes">
        <button type="button" class="botao" disabled={!canUse} onClick={() => onUse(spec, save)}>
          {t.perfilUsar}
        </button>
        <button type="button" class="botao-discreto" onClick={onCancel}>
          {t.cancelar}
        </button>
      </div>
    </section>
  );
}
