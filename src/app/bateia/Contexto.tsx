// Contexto de uma ocorrência (RF-26): linhas ao redor, lidas do arquivo sob demanda.

import { useEffect, useState } from 'preact/hooks';
import type { ContextLine } from '../../core/context.ts';
import { MAX_CONTEXT_LINES } from '../../shared/protocol.ts';
import { RequestCancelled, type AnalysisClient } from '../worker-client.ts';
import { t } from '../strings.ts';

interface Props {
  client: AnalysisClient;
  event: number | null;
  mask: (text: string) => string;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_CONTEXT_LINES, Math.trunc(value)));
}

export function Contexto({ client, event, mask }: Props) {
  const [before, setBefore] = useState(5);
  const [after, setAfter] = useState(5);
  const [lines, setLines] = useState<ContextLine[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (event === null) {
      setLines(null);
      return undefined;
    }
    let alive = true;
    setFailed(false);
    client
      .context(event, before, after)
      .then((result) => {
        if (alive) setLines(result);
      })
      .catch((error: unknown) => {
        if (alive && !(error instanceof RequestCancelled)) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [client, event, before, after]);

  return (
    <section class="contexto" aria-labelledby="titulo-contexto">
      <div class="contexto-topo">
        <h3 class="subtitulo" id="titulo-contexto">
          {t.contextoTitulo}
        </h3>
        <label class="numero">
          <span>{t.contextoAntes}</span>
          <input
            type="number"
            min={0}
            max={MAX_CONTEXT_LINES}
            value={before}
            onChange={(e) => setBefore(clamp(e.currentTarget.valueAsNumber))}
          />
        </label>
        <label class="numero">
          <span>{t.contextoDepois}</span>
          <input
            type="number"
            min={0}
            max={MAX_CONTEXT_LINES}
            value={after}
            onChange={(e) => setAfter(clamp(e.currentTarget.valueAsNumber))}
          />
        </label>
      </div>
      {event === null ? (
        <p class="nota">{t.contextoVazio}</p>
      ) : failed ? (
        <p class="erro" role="alert">
          {t.falhaConsulta}
        </p>
      ) : (
        <pre class="contexto-linhas" tabIndex={0}>
          {(lines ?? []).map((line, i) => (
            <span key={i} class={`linha linha-${line.kind}`}>
              {mask(line.text)}
              {line.cut ? t.linhaCortada : ''}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}
