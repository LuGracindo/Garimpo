import { useEffect, useRef, useState } from 'preact/hooks';
import { Logo } from '../ui/Logo.tsx';
import type { AnalysisResult } from '../core/analyzer.ts';
import type { CustomProfileSpec } from '../core/custom-profile.ts';
import type { ProfileId } from '../core/types.ts';
import type { ProfileCandidate, WorkerToUi } from '../shared/protocol.ts';
import { runSealSelfTest, type SealState } from './seal.ts';
import { Bateia } from './bateia/Bateia.tsx';
import { EditorPerfil } from './bateia/EditorPerfil.tsx';
import { deleteProfile, loadProfiles, saveProfile } from './custom-profiles.ts';
import { megabytes, numero } from './format.ts';
import { createAnalysisClient, type AnalysisClient } from './worker-client.ts';
import { t } from './strings.ts';

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'working';
      requestId: number;
      name: string;
      size: number;
      bytesRead: number;
      lines: number;
    }
  | {
      kind: 'done';
      name: string;
      size: number;
      lines: number;
      maxLineBytes: number;
      elapsedMs: number;
      analysis: AnalysisResult;
      modifiedAt: number | null;
      custom: CustomProfileSpec | null;
    }
  | { kind: 'choose'; name: string; candidates: ProfileCandidate[] }
  | {
      kind: 'editor';
      name: string;
      initial: CustomProfileSpec | null;
      candidates: ProfileCandidate[];
    }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: string; details: string };

function Selo({ state }: { state: SealState }) {
  const rotulo =
    state === 'lacrado' ? t.seloLacrado : state === 'sem-lacre' ? t.seloSemLacre : t.seloTestando;
  const ajuda =
    state === 'lacrado' ? t.seloLacradoAjuda : state === 'sem-lacre' ? t.seloSemLacreAjuda : '';
  const classe =
    state === 'lacrado'
      ? 'selo-lacrado'
      : state === 'sem-lacre'
        ? 'selo-sem-lacre'
        : 'selo-testando';

  return (
    <span class={`selo ${classe}`} title={ajuda}>
      <span class="selo-icone" aria-hidden="true" />
      <span>{rotulo}</span>
    </span>
  );
}

const STALL_MS = 15_000;

const ERROS: Record<string, { titulo: string; texto: string }> = {
  'GAR-BIN-001': { titulo: t.erroBinarioTitulo, texto: t.erroBinarioTexto },
  'GAR-LIM-001': { titulo: t.erroLimiteTitulo, texto: t.erroLimiteTexto },
  'GAR-MEM-001': { titulo: t.erroMemoriaTitulo, texto: t.erroMemoriaTexto },
};

/** Estado de erro: texto, ação sugerida e foco inicial no título (SDD 9.3). */
function Erro({ code, details, onReset }: { code: string; details: string; onReset: () => void }) {
  const titulo = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    titulo.current?.focus();
  }, []);
  const known = ERROS[code];
  return (
    <section class="cartao" role="alert" aria-labelledby="titulo-erro">
      <h2 class="cartao-titulo" id="titulo-erro" ref={titulo} tabIndex={-1}>
        {known ? known.titulo : t.erroInterno}
      </h2>
      {known ? <p class="nota">{known.texto}</p> : null}
      {details === 'travou' ? <p class="nota">{t.perfilTravou}</p> : null}
      <p class="arquivo">
        {code} · {details}
      </p>
      <div>
        <button type="button" class="botao" onClick={onReset}>
          {known ? t.tentarOutro : t.novaJazida}
        </button>
      </div>
    </section>
  );
}

export function App() {
  const [seal, setSeal] = useState<SealState>('testando');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [client, setClient] = useState<AnalysisClient | null>(null);
  const [saved, setSaved] = useState<CustomProfileSpec[]>(loadProfiles);

  const clientRef = useRef<AnalysisClient | null>(null);
  const currentRequest = useRef<number | null>(null);
  const currentFile = useRef<{ name: string; size: number; modifiedAt: number | null } | null>(
    null,
  );
  const currentCustom = useRef<CustomProfileSpec | null>(null);
  const currentBlob = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastProgress = useRef(0);
  const usingCustom = useRef(false);

  useEffect(() => {
    let alive = true;
    void runSealSelfTest().then((state) => {
      if (alive) setSeal(state);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onMessage = (message: WorkerToUi): void => {
      if (message.requestId !== currentRequest.current && message.type !== 'error') return;
      const file = currentFile.current;

      if (message.type === 'progress') {
        lastProgress.current = Date.now();
        setPhase({
          kind: 'working',
          requestId: message.requestId,
          name: file?.name ?? '',
          size: message.totalBytes,
          bytesRead: message.bytesRead,
          lines: message.lines,
        });
      } else if (message.type === 'ready') {
        setPhase({
          kind: 'done',
          name: file?.name ?? '',
          size: file?.size ?? message.bytesRead,
          lines: message.lines,
          maxLineBytes: message.maxLineBytes,
          elapsedMs: message.elapsedMs,
          analysis: message.analysis,
          modifiedAt: file?.modifiedAt ?? null,
          custom: currentCustom.current,
        });
      } else if (message.type === 'needs-profile') {
        setPhase({ kind: 'choose', name: file?.name ?? '', candidates: message.candidates });
      } else if (message.type === 'cancelled') {
        setPhase({ kind: 'cancelled' });
      } else if (message.type === 'error') {
        setPhase({ kind: 'error', code: message.code, details: message.details });
      }
    };

    const created = createAnalysisClient(onMessage);
    clientRef.current = created;
    setClient(created);
    return () => {
      created.dispose();
      clientRef.current = null;
    };
  }, []);

  const cancel = (): void => {
    const id = currentRequest.current;
    if (id !== null) clientRef.current?.cancel(id);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Perfil personalizado que trava o Worker: sem progresso por muito tempo, derruba e avisa.
  useEffect(() => {
    if (phase.kind !== 'working') return undefined;
    const timer = window.setInterval(() => {
      if (!usingCustom.current) return;
      if (Date.now() - lastProgress.current > STALL_MS) {
        clientRef.current?.restart();
        currentRequest.current = null;
        setPhase({ kind: 'error', code: 'GAR-IO-001', details: 'travou' });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

  const openFile = (file: File, profile?: ProfileId, custom?: CustomProfileSpec): void => {
    const client = clientRef.current;
    if (!client) return;
    currentFile.current = {
      name: file.name,
      size: file.size,
      modifiedAt: file.lastModified || null,
    };
    currentCustom.current = custom ?? null;
    currentBlob.current = file;
    usingCustom.current = custom !== undefined;
    lastProgress.current = Date.now();
    const requestId = client.open(
      file,
      custom ? { profile: 'custom', custom } : profile ? { profile } : {},
    );
    currentRequest.current = requestId;
    setPhase({
      kind: 'working',
      requestId,
      name: file.name,
      size: file.size,
      bytesRead: 0,
      lines: 0,
    });
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) openFile(file);
  };

  const reset = (): void => {
    currentRequest.current = null;
    currentFile.current = null;
    currentBlob.current = null;
    setPhase({ kind: 'idle' });
  };

  const percent =
    phase.kind === 'working' && phase.size > 0
      ? Math.min(100, Math.floor((phase.bytesRead / phase.size) * 100))
      : 0;

  return (
    <div class="app">
      <header class="topo">
        <div class="marca">
          <Logo />
          <div>
            <h1 class="nome">{t.produto}</h1>
            <p class="assinatura">{t.assinatura}</p>
          </div>
        </div>
        <Selo state={seal} />
      </header>

      <main class={phase.kind === 'done' ? 'principal principal-bateia' : 'principal'}>
        {phase.kind === 'done' && client ? (
          <Bateia
            client={client}
            analysis={phase.analysis}
            name={phase.name}
            size={phase.size}
            elapsedMs={phase.elapsedMs}
            modifiedAt={phase.modifiedAt}
            custom={phase.custom}
            onReset={reset}
          />
        ) : (
          <div class="painel">
            {phase.kind === 'working' ? (
              <section class="cartao" aria-labelledby="titulo-trabalho">
                <h2 class="cartao-titulo" id="titulo-trabalho">
                  {t.processando}
                </h2>
                <p class="arquivo">
                  {phase.name} · {megabytes(phase.size)}
                </p>
                <div
                  class="trilho"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label="Progresso da leitura"
                >
                  <div class="enchimento" style={{ transform: `scaleX(${percent / 100})` }} />
                </div>
                <dl class="numeros">
                  <div>
                    <dt>Lido</dt>
                    <dd>{percent}%</dd>
                  </div>
                  <div>
                    <dt>Linhas</dt>
                    <dd>{numero.format(phase.lines)}</dd>
                  </div>
                </dl>
                <span class="entrada-oculta" role="status" aria-live="polite">
                  {`Lido: ${Math.floor(percent / 10) * 10}%`}
                </span>
                <div>
                  <button type="button" class="botao" onClick={cancel}>
                    {t.cancelar}
                  </button>
                </div>
              </section>
            ) : phase.kind === 'choose' ? (
              <section class="cartao" aria-labelledby="titulo-formato">
                <h2 class="cartao-titulo" id="titulo-formato">
                  {phase.candidates.some((c) => c.score > 0) ? t.formatoIncerto : t.formatoNenhum}
                </h2>
                <p class="arquivo">{phase.name}</p>
                <ul class="escolhas">
                  {phase.candidates.map((candidate) => (
                    <li key={candidate.profile}>
                      <span class="escolha-nome">{candidate.profile}</span>
                      <span class="escolha-nota">{Math.round(candidate.score * 100)}%</span>
                      <button
                        type="button"
                        class="botao"
                        onClick={() => {
                          const file = currentBlob.current;
                          if (file) openFile(file, candidate.profile);
                        }}
                      >
                        {t.escolher}
                      </button>
                    </li>
                  ))}
                </ul>
                {saved.length > 0 ? (
                  <>
                    <h3 class="subtitulo">{t.perfilMeus}</h3>
                    <ul class="salvos">
                      {saved.map((spec) => (
                        <li key={spec.name}>
                          <span class="escolha-nome">{spec.name}</span>
                          <button
                            type="button"
                            class="botao-discreto"
                            onClick={() => {
                              const file = currentBlob.current;
                              if (file) openFile(file, undefined, spec);
                            }}
                          >
                            {t.perfilUsarSalvo}
                          </button>
                          <button
                            type="button"
                            class="botao-discreto"
                            onClick={() =>
                              setPhase({
                                kind: 'editor',
                                name: phase.name,
                                initial: spec,
                                candidates: phase.candidates,
                              })
                            }
                          >
                            {t.perfilEditar}
                          </button>
                          <button
                            type="button"
                            class="botao-discreto"
                            onClick={() => setSaved(deleteProfile(spec.name))}
                          >
                            {t.perfilExcluir}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <div class="acoes">
                  <button
                    type="button"
                    class="botao"
                    onClick={() =>
                      setPhase({
                        kind: 'editor',
                        name: phase.name,
                        initial: null,
                        candidates: phase.candidates,
                      })
                    }
                  >
                    {t.perfilCriar}
                  </button>
                  <button type="button" class="botao-discreto" onClick={reset}>
                    {t.novaJazida}
                  </button>
                </div>
              </section>
            ) : phase.kind === 'editor' && client && currentBlob.current ? (
              <EditorPerfil
                client={client}
                file={currentBlob.current}
                fileName={phase.name}
                initial={phase.initial}
                onUse={(spec, save) => {
                  if (save) setSaved(saveProfile(spec));
                  const file = currentBlob.current;
                  if (file) openFile(file, undefined, spec);
                }}
                onCancel={() =>
                  setPhase({ kind: 'choose', name: phase.name, candidates: phase.candidates })
                }
              />
            ) : phase.kind === 'cancelled' ? (
              <section class="cartao">
                <h2 class="cartao-titulo">{t.cancelado}</h2>
                <div>
                  <button type="button" class="botao" onClick={reset}>
                    {t.novaJazida}
                  </button>
                </div>
              </section>
            ) : phase.kind === 'error' ? (
              <Erro code={phase.code} details={phase.details} onReset={reset} />
            ) : (
              <section
                class={dragging ? 'soltar soltar-ativa' : 'soltar'}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <h2 class="soltar-titulo">{t.inicioTitulo}</h2>
                <p class="soltar-sub">{t.inicioSubtitulo}</p>
                <button type="button" class="botao" onClick={() => inputRef.current?.click()}>
                  {t.abrirArquivo}
                </button>
                <input
                  ref={inputRef}
                  class="entrada-oculta"
                  type="file"
                  accept=".log,.txt,.out,.jsonl,.ndjson,text/plain"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    if (file) openFile(file);
                    input.value = '';
                  }}
                />
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
