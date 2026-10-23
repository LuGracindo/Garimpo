import { useEffect, useRef, useState } from 'preact/hooks';
import { Logo } from '../ui/Logo.tsx';
import type { WorkerToUi } from '../shared/protocol.ts';
import { runSealSelfTest, type SealState } from './seal.ts';
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
    }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: string; details: string };

const numero = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function megabytes(bytes: number): string {
  return `${decimal.format(bytes / (1024 * 1024))} MB`;
}

function Selo({ state }: { state: SealState }) {
  const rotulo =
    state === 'lacrado' ? t.seloLacrado : state === 'sem-lacre' ? t.seloSemLacre : t.seloTestando;
  const ajuda =
    state === 'lacrado' ? t.seloLacradoAjuda : state === 'sem-lacre' ? t.seloSemLacreAjuda : '';
  const classe =
    state === 'lacrado' ? 'selo-lacrado' : state === 'sem-lacre' ? 'selo-sem-lacre' : 'selo-testando';

  return (
    <span class={`selo ${classe}`} title={ajuda}>
      <span class="selo-icone" aria-hidden="true" />
      <span>{rotulo}</span>
    </span>
  );
}

export function App() {
  const [seal, setSeal] = useState<SealState>('testando');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);

  const clientRef = useRef<AnalysisClient | null>(null);
  const currentRequest = useRef<number | null>(null);
  const currentFile = useRef<{ name: string; size: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
        });
      } else if (message.type === 'cancelled') {
        setPhase({ kind: 'cancelled' });
      } else {
        setPhase({ kind: 'error', code: message.code, details: message.details });
      }
    };

    clientRef.current = createAnalysisClient(onMessage);
    return () => {
      clientRef.current?.dispose();
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

  const openFile = (file: File): void => {
    const client = clientRef.current;
    if (!client) return;
    currentFile.current = { name: file.name, size: file.size };
    const requestId = client.open(file);
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

      <main class="principal">
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
          ) : phase.kind === 'done' ? (
            <section class="cartao" aria-labelledby="titulo-pronto">
              <h2 class="cartao-titulo" id="titulo-pronto">
                {numero.format(phase.lines)} linhas em {megabytes(phase.size)}.
              </h2>
              <p class="arquivo">{phase.name}</p>
              <dl class="numeros">
                <div>
                  <dt>Maior linha</dt>
                  <dd>{numero.format(phase.maxLineBytes)} bytes</dd>
                </div>
                <div>
                  <dt>Tempo</dt>
                  <dd>{numero.format(Math.round(phase.elapsedMs))} ms</dd>
                </div>
              </dl>
              <p class="nota">{t.m0Nota}</p>
              <div>
                <button type="button" class="botao" onClick={reset}>
                  {t.novaJazida}
                </button>
              </div>
            </section>
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
            <section class="cartao" role="alert">
              <p class="erro">{t.erroInterno}</p>
              <p class="arquivo">
                {phase.code} · {phase.details}
              </p>
              <div>
                <button type="button" class="botao" onClick={reset}>
                  {t.novaJazida}
                </button>
              </div>
            </section>
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
      </main>
    </div>
  );
}
