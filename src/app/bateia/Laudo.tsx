// Tela do Laudo (SDD 9.1): impressão digital, escolha do Lacre, pré-visualização e exportação.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { AnalysisResult } from '../../core/analyzer.ts';
import type { CustomProfileSpec } from '../../core/custom-profile.ts';
import { LACRE_DEFAULT_TYPES, LACRE_TYPES, Lacre, type LacreType } from '../../core/lacre.ts';
import {
  buildLaudo,
  renderLaudoHtml,
  sealLaudo,
  type FingerprintInfo,
  type Laudo,
} from '../../core/laudo.ts';
import { sha256Hex } from '../../worker/fingerprint.ts';
import { BUILD } from '../build-info.ts';
import { download, safeFileName } from '../download.ts';
import { numero } from '../format.ts';
import { t } from '../strings.ts';
import { RequestCancelled, type AnalysisClient, type LacreScanReply } from '../worker-client.ts';

interface Props {
  client: AnalysisClient;
  analysis: AnalysisResult;
  name: string;
  size: number;
  modifiedAt: number | null;
  custom: CustomProfileSpec | null;
  lacreTypes: ReadonlySet<LacreType>;
  onLacreTypes: (types: ReadonlySet<LacreType>) => void;
  onBack: () => void;
}

interface Built {
  laudo: Laudo;
  lacre: Lacre;
}

export function LaudoTela({
  client,
  analysis,
  name,
  size,
  modifiedAt,
  custom,
  lacreTypes,
  onLacreTypes,
  onBack,
}: Props) {
  const [fp, setFp] = useState<FingerprintInfo | null>(null);
  const [fpFailed, setFpFailed] = useState(false);
  const [scan, setScan] = useState<LacreScanReply | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const typesKey = [...lacreTypes].sort().join(',');

  useEffect(() => {
    heading.current?.focus();
    let alive = true;
    client
      .fingerprint()
      .then((result) => {
        if (alive) setFp(result);
      })
      .catch((error: unknown) => {
        if (alive && !(error instanceof RequestCancelled)) setFpFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [client]);

  // Varredura do arquivo inteiro: quanto dado sensível há, por tipo, e exemplos antes/depois.
  useEffect(() => {
    let alive = true;
    setScan(null);
    const types = [...LACRE_TYPES];
    client
      .lacreScan(types)
      .then((result) => {
        if (alive) setScan(result);
      })
      .catch(() => {
        /* a varredura é informativa: sem ela, o laudo continua válido */
      });
    return () => {
      alive = false;
    };
  }, [client]);

  // O laudo é refeito (e lacrado) quando a impressão digital chega ou o Lacre muda.
  useEffect(() => {
    if (!fp) return undefined;
    let alive = true;
    const lacre = new Lacre(lacreTypes);
    const data = buildLaudo({
      build: BUILD,
      generatedAt: new Date().toISOString(),
      jazida: { nome: name, tamanho: size, modificadoEm: modifiedAt, impressaoDigital: fp },
      analysis,
      custom,
      lacre,
    });
    void sealLaudo(data, sha256Hex).then((laudo) => {
      if (alive) setBuilt({ laudo, lacre });
    });
    return () => {
      alive = false;
    };
  }, [fp, typesKey, analysis, name, size, modifiedAt, custom]);

  const toggle = (type: LacreType, on: boolean): void => {
    const next = new Set(lacreTypes);
    if (on) next.add(type);
    else next.delete(type);
    onLacreTypes(next);
  };

  const laudo = built?.laudo ?? null;
  const base = laudo
    ? `laudo-${safeFileName(name)}-${laudo.jazida.impressaoDigital.raiz.slice(0, 8)}${laudo.lacre.ativo ? '-lacrado' : ''}`
    : '';
  const mapping = built?.lacre.mapping() ?? [];
  const active = lacreTypes.size > 0;

  return (
    <section class="laudo" aria-labelledby="titulo-laudo">
      <div class="laudo-topo">
        <div>
          <h2 class="cartao-titulo" id="titulo-laudo" ref={heading} tabIndex={-1}>
            {t.laudoTitulo}
          </h2>
          <p class="nota">{t.laudoAjuda}</p>
        </div>
        <button type="button" class="botao" onClick={onBack}>
          {t.voltarBateia}
        </button>
      </div>

      <section class="cartao" aria-labelledby="titulo-lacre">
        <h3 class="subtitulo" id="titulo-lacre">
          {t.lacreTitulo}
        </h3>
        <label class="caixa">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) =>
              onLacreTypes(e.currentTarget.checked ? new Set(LACRE_DEFAULT_TYPES) : new Set())
            }
          />
          <span>{t.lacreLigado}</span>
        </label>
        <p class="nota">{t.lacreAviso}</p>
        <ul class="lacre-tipos">
          {LACRE_TYPES.map((type) => {
            const found = scan ? (scan.counts[type] ?? 0) : null;
            return (
              <li key={type}>
                <label class="caixa">
                  <input
                    type="checkbox"
                    checked={lacreTypes.has(type)}
                    onChange={(e) => toggle(type, e.currentTarget.checked)}
                  />
                  <span>{t.lacreTipoLabels[type]}</span>
                </label>
                <span class="lacre-n" aria-label={t.lacreEncontrados}>
                  {found === null ? '…' : found === 0 ? t.lacreNada : numero.format(found)}
                </span>
              </li>
            );
          })}
        </ul>
        {scan === null ? <p class="nota">{t.lacreVarrendo}</p> : null}
        {scan && scan.samples.length > 0 ? (
          <>
            <h4 class="rotulo">{t.lacreExemplos}</h4>
            <div class="previa-tabela" role="region" aria-label={t.lacreExemplos} tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">{t.lacreAntes}</th>
                    <th scope="col">{t.lacreDepois}</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.samples.map((sample, i) => (
                    <tr key={i}>
                      <td>{t.lacreTipoLabels[sample.type]}</td>
                      <td class="previa-linha">{sample.antes}</td>
                      <td class="previa-linha">{sample.depois}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section class="cartao" aria-labelledby="titulo-previa-laudo">
        <h3 class="subtitulo" id="titulo-previa-laudo">
          {t.laudoPrevia}
        </h3>
        {fpFailed ? (
          <p class="erro" role="alert">
            {t.laudoFalhaImpressao}
          </p>
        ) : !laudo ? (
          <p class="nota" role="status">
            {t.laudoCalculando}
          </p>
        ) : (
          <>
            <dl class="laudo-dados">
              <div>
                <dt>{t.laudoHash}</dt>
                <dd class="mono">{laudo.integridade.valor}</dd>
              </div>
              <div>
                <dt>{t.laudoImpressao}</dt>
                <dd class="mono">
                  {laudo.jazida.impressaoDigital.metodo} · {laudo.jazida.impressaoDigital.blocos} ·{' '}
                  {laudo.jazida.impressaoDigital.raiz}
                </dd>
              </div>
              <div>
                <dt>{t.laudoGeradoEm}</dt>
                <dd class="mono">{laudo.geradoEm}</dd>
              </div>
              <div>
                <dt>{t.laudoSecaoJazida}</dt>
                <dd class="mono">
                  {laudo.jazida.nome} · {numero.format(laudo.jazida.tamanho)} bytes
                </dd>
              </div>
              <div>
                <dt>{t.laudoSecaoFormato}</dt>
                <dd class="mono">
                  {laudo.formato.perfil ?? '—'} ({laudo.formato.origem}) · {laudo.agrupamento.modo}
                </dd>
              </div>
              <div>
                <dt>{t.laudoSecaoContadores}</dt>
                <dd class="mono">
                  {numero.format(laudo.contadores.linhas)} linhas ·{' '}
                  {numero.format(laudo.contadores.eventos)} eventos ·{' '}
                  {numero.format(laudo.contadores.pepitas)} pepitas
                </dd>
              </div>
              <div>
                <dt>{t.laudoSecaoLacre}</dt>
                <dd class="mono">
                  {laudo.lacre.ativo
                    ? Object.entries(laudo.lacre.substituicoes)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', ')
                    : t.laudoNenhuma}
                </dd>
              </div>
            </dl>

            <h4 class="rotulo">
              {t.laudoSecaoPepitas} ({laudo.pepitas.length})
            </h4>
            <ol class="pepitas">
              {laudo.pepitas.slice(0, 10).map((p) => (
                <li key={p.id} class={`pepita sev-${p.nivel.toLowerCase()}`}>
                  <div class="pepita-topo">
                    <span class="sev">{p.nivel}</span>
                    <span class="pepita-contagem">{numero.format(p.ocorrencias)}×</span>
                    <span class="pepita-id">{p.idCurto}</span>
                  </div>
                  <p class="pepita-gabarito">{p.gabarito || '(mensagem vazia)'}</p>
                </li>
              ))}
            </ol>
            {laudo.pepitas.length > 10 ? (
              <p class="nota">
                Mostrando 10 de {laudo.pepitas.length}; o arquivo exportado traz todas.
              </p>
            ) : null}

            <h4 class="rotulo">{t.laudoSecaoDecisoes}</h4>
            <ol class="avisos">
              {laudo.decisoes.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ol>
            <h4 class="rotulo">{t.laudoSecaoLimites}</h4>
            <ul class="avisos">
              {laudo.limitacoes.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>

            <div class="acoes">
              <button
                type="button"
                class="botao"
                onClick={() => download(`${base}.html`, 'text/html', renderLaudoHtml(laudo))}
              >
                {t.laudoBaixarHtml}
              </button>
              <button
                type="button"
                class="botao-discreto"
                onClick={() =>
                  download(`${base}.json`, 'application/json', JSON.stringify(laudo, null, 2))
                }
              >
                {t.laudoBaixarJson}
              </button>
              {laudo.lacre.ativo && mapping.length > 0 ? (
                <button
                  type="button"
                  class="botao-discreto"
                  onClick={() =>
                    download(
                      `${base}-mapa-marcadores.json`,
                      'application/json',
                      JSON.stringify(
                        {
                          aviso: t.laudoMapaAviso,
                          laudo: laudo.integridade.valor,
                          marcadores: mapping,
                        },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  {t.laudoBaixarMapa}
                </button>
              ) : null}
            </div>
            {laudo.lacre.ativo && mapping.length > 0 ? (
              <p class="nota">{t.laudoMapaAviso}</p>
            ) : null}
            <p class="nota mono">{t.laudoVerificar}</p>
          </>
        )}
      </section>
    </section>
  );
}
