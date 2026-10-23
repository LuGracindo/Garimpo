// Laudo (RF-30 a RF-33, AUD-01 a AUD-06): relatório reproduzível e auditável de uma análise.
// Este módulo não depende de DOM nem de Worker. O hash de integridade usa uma função SHA-256
// injetada (Web Crypto no navegador e no Node), o que mantém tudo testável.

import { DEFAULT_MAX_NUGGETS, DEFAULT_TOP_NUGGETS, type AnalysisResult } from './analyzer.ts';
import { canonicalJson, type Json } from './canonical.ts';
import type { CustomProfileSpec } from './custom-profile.ts';
import { escapeHtml, truncate, unescapeHtml } from './escape.ts';
import { LACRE_LABELS, LACRE_TYPES, type Lacre } from './lacre.ts';
import { MAX_INPUT_CHARS } from './normalize.ts';
import { DEFAULT_LIMITS } from './segmenter.ts';
import { SEVERITIES } from './types.ts';

export const LAUDO_SCHEMA = 'garimpo-laudo/1';
export const INTEGRITY_ALGORITHM = 'sha256';
export const CANONICALIZATION = 'json-chaves-ordenadas';

/** Limites de tamanho dos campos que vêm do log (SEG-04). */
export const MAX_NAME_CHARS = 200;
export const MAX_TEMPLATE_CHARS = 1000;
export const MAX_EXAMPLE_CHARS = 200;

export const LIMITATIONS: readonly string[] = [
  'O agrupamento em pepitas é heurístico (regras fixas): mensagens totalmente livres podem ser agrupadas de forma imperfeita. Confira o gabarito antes de confiar na contagem.',
  'O Lacre mascara só padrões conhecidos (e-mail, IP, CPF, CNPJ, cartão, JWT, chaves de API e, se ligados, UUID e telefone). Nomes, endereços e dados em texto livre não são detectados. O Lacre reduz o risco de vazamento, mas não é garantia.',
  'A data e a hora de geração vêm do relógio do aparelho, que pode estar errado. Horários do log sem fuso foram lidos como UTC.',
  'O hash de integridade detecta alteração acidental ou simples, mas não prova autoria e não impede que alguém refaça o hash depois de editar o laudo. Não há assinatura digital.',
];

export interface BuildInfo {
  nome: string;
  versao: string;
  build: string;
}

export interface FingerprintInfo {
  metodo: string;
  tamanhoBloco: number;
  blocos: number;
  bytes: number;
  raiz: string;
}

export interface LaudoInput {
  build: BuildInfo;
  /** Instante de geração, em ISO 8601 (relógio do aparelho). */
  generatedAt: string;
  jazida: {
    nome: string;
    tamanho: number;
    modificadoEm: number | null;
    impressaoDigital: FingerprintInfo;
  };
  analysis: AnalysisResult;
  /** Perfil personalizado usado, se houver (entra no laudo para reprodutibilidade). */
  custom: CustomProfileSpec | null;
  /** Instância nova do Lacre (a mesma ordem de máscara gera sempre os mesmos marcadores). */
  lacre: Lacre | null;
  /** Intervenções manuais extras, em ordem (AUD-05). */
  decisoes?: readonly string[];
}

export interface LaudoData {
  schema: typeof LAUDO_SCHEMA;
  gerador: BuildInfo;
  geradoEm: string;
  relogio: string;
  jazida: {
    nome: string;
    tamanho: number;
    modificadoEm: string | null;
    codificacao: string;
    impressaoDigital: FingerprintInfo;
  };
  formato: {
    perfil: string | null;
    origem: string;
    confianca: number | null;
    fuso: string;
    personalizado: {
      nome: string;
      padrao: string;
      formatoHora: string;
      mapaNiveis: Record<string, string>;
      continuacao: string;
    } | null;
  };
  agrupamento: { modo: string; pesos: Record<string, number> };
  limites: {
    tamanhoMaximoEventoBytes: number;
    linhasMaximasPorEvento: number;
    caracteresMaximosNormalizados: number;
    pepitasMaximas: number;
    pepitasListadas: number;
    eventosTruncados: number;
    excessoDePepitas: boolean;
  };
  contadores: {
    linhas: number;
    linhasEmBranco: number;
    linhasDeCabecalho: number;
    linhasNaoInterpretadas: number;
    eventos: number;
    eventosForaDeOrdem: number;
    pepitas: number;
    bytes: number;
    maiorLinhaBytes: number;
  };
  periodo: { inicio: string | null; fim: string | null };
  niveis: Record<string, number>;
  lacre: {
    ativo: boolean;
    regras: string[];
    substituicoes: Record<string, number>;
  };
  pepitas: {
    id: number;
    idCurto: string;
    nivel: string;
    ocorrencias: number;
    nova: boolean;
    prioridade: number;
    gabarito: string;
    primeiraMensagem: string | null;
    niveis: Record<string, number>;
    primeira: string | null;
    ultima: string | null;
    valoresVariaram: {
      marcador: string;
      distintos: number;
      limitado: boolean;
      exemplos: string[];
    }[];
  }[];
  decisoes: string[];
  limitacoes: string[];
}

export interface Laudo extends LaudoData {
  integridade: { algoritmo: string; canonicalizacao: string; valor: string };
}

function iso(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function buildLaudo(input: LaudoInput): LaudoData {
  const { analysis, lacre, custom } = input;
  const s = analysis.summary;
  const mask = (text: string, max: number): string =>
    truncate(lacre && lacre.active ? lacre.mask(text) : text, max);

  const nome = mask(input.jazida.nome, MAX_NAME_CHARS);
  const pepitas: LaudoData['pepitas'] = analysis.nuggets.map((n) => ({
    id: n.id,
    idCurto: n.shortId,
    nivel: n.dominant,
    ocorrencias: n.count,
    nova: n.isNew,
    prioridade: round(n.priority),
    gabarito: mask(n.template, MAX_TEMPLATE_CHARS),
    primeiraMensagem: n.hasStack ? mask(n.headTemplate, MAX_TEMPLATE_CHARS) : null,
    niveis: Object.fromEntries(SEVERITIES.map((level) => [level, n.severityCounts[level]])),
    primeira: iso(n.firstTimeMs),
    ultima: iso(n.lastTimeMs),
    valoresVariaram: n.markers.map((m) => ({
      marcador: m.marker,
      distintos: m.distinct,
      limitado: m.capped,
      exemplos: m.examples.map((example) => mask(example, MAX_EXAMPLE_CHARS)),
    })),
  }));

  const decisoes: string[] = [];
  if (s.profile) {
    if (s.profileSource === 'auto' && s.confidence !== null) {
      decisoes.push(
        `Formato ${s.profile} detectado automaticamente, com confiança de ${Math.round(s.confidence * 100)}%.`,
      );
    } else if (s.profile === 'custom' && custom) {
      decisoes.push(
        `Formato definido pela pessoa: perfil personalizado “${truncate(custom.name, 40)}”.`,
      );
    } else {
      decisoes.push(`Formato ${s.profile} escolhido pela pessoa.`);
    }
  }
  decisoes.push(`Modo de agrupamento: ${s.mode}.`);
  if (lacre && lacre.active) {
    decisoes.push(`Lacre ligado para: ${[...lacre.types].map((t) => LACRE_LABELS[t]).join(', ')}.`);
  } else {
    decisoes.push('Lacre desligado: o conteúdo do laudo não foi mascarado.');
  }
  for (const extra of input.decisoes ?? []) decisoes.push(truncate(extra, 300));

  return {
    schema: LAUDO_SCHEMA,
    gerador: input.build,
    geradoEm: input.generatedAt,
    relogio: 'relógio do aparelho, em UTC',
    jazida: {
      nome,
      tamanho: input.jazida.tamanho,
      modificadoEm: iso(input.jazida.modificadoEm),
      codificacao: 'UTF-8',
      impressaoDigital: input.jazida.impressaoDigital,
    },
    formato: {
      perfil: s.profile,
      origem: s.profileSource,
      confianca: s.confidence === null ? null : round(s.confidence),
      fuso: 'UTC (horários sem fuso são lidos como UTC)',
      personalizado: custom
        ? {
            nome: truncate(custom.name, 40),
            padrao: custom.pattern,
            formatoHora: custom.timeFormat,
            mapaNiveis: { ...custom.levelMap },
            continuacao: custom.continuation,
          }
        : null,
    },
    agrupamento: { modo: s.mode, pesos: { ...s.weights } },
    limites: {
      tamanhoMaximoEventoBytes: DEFAULT_LIMITS.maxEventBytes,
      linhasMaximasPorEvento: DEFAULT_LIMITS.maxEventLines,
      caracteresMaximosNormalizados: MAX_INPUT_CHARS,
      pepitasMaximas: DEFAULT_MAX_NUGGETS,
      pepitasListadas: Math.min(DEFAULT_TOP_NUGGETS, pepitas.length),
      eventosTruncados: s.truncatedEvents,
      excessoDePepitas: s.overflow,
    },
    contadores: {
      linhas: s.lines,
      linhasEmBranco: s.blankLines,
      linhasDeCabecalho: s.headerLines,
      linhasNaoInterpretadas: s.unparsed,
      eventos: s.events,
      eventosForaDeOrdem: s.outOfOrder,
      pepitas: s.nuggetCount,
      bytes: s.bytes,
      maiorLinhaBytes: s.maxLineBytes,
    },
    periodo: { inicio: iso(s.firstTimeMs), fim: iso(s.lastTimeMs) },
    niveis: Object.fromEntries(SEVERITIES.map((level) => [level, s.severityCounts[level]])),
    lacre: {
      ativo: lacre !== null && lacre.active,
      regras: lacre ? [...lacre.types].sort() : [],
      substituicoes: Object.fromEntries(
        LACRE_TYPES.filter((t) => lacre?.types.has(t)).map((t) => [t, lacre?.replacements[t] ?? 0]),
      ),
    },
    pepitas,
    decisoes,
    limitacoes: [...LIMITATIONS],
  };
}

export type Sha256Hex = (text: string) => Promise<string>;

/** Calcula o hash do JSON canônico de todo o conteúdo, exceto o campo `integridade`. */
export async function integrityOf(data: LaudoData, sha256: Sha256Hex): Promise<string> {
  return sha256(canonicalJson(data as unknown as Json));
}

export async function sealLaudo(data: LaudoData, sha256: Sha256Hex): Promise<Laudo> {
  return {
    ...data,
    integridade: {
      algoritmo: INTEGRITY_ALGORITHM,
      canonicalizacao: CANONICALIZATION,
      valor: await integrityOf(data, sha256),
    },
  };
}

export interface Verification {
  ok: boolean;
  esperado: string;
  calculado: string;
}

export async function verifyLaudo(laudo: Laudo, sha256: Sha256Hex): Promise<Verification> {
  const { integridade, ...rest } = laudo;
  const calculado = await integrityOf(rest as LaudoData, sha256);
  // Os rótulos do selo também contam: um laudo que declara outro algoritmo ou outra
  // canonicalização não foi lacrado por este programa e não deve passar.
  const rotulosOk =
    integridade.algoritmo === INTEGRITY_ALGORITHM &&
    integridade.canonicalizacao === CANONICALIZATION;
  return {
    ok: rotulosOk && calculado === integridade.valor,
    esperado: integridade.valor,
    calculado,
  };
}

/** Confere a forma mínima de um laudo lido de fora (arquivo JSON ou HTML). */
export function isLaudo(value: unknown): value is Laudo {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const integ = v['integridade'] as Record<string, unknown> | undefined;
  return (
    v['schema'] === LAUDO_SCHEMA &&
    typeof integ === 'object' &&
    integ !== null &&
    typeof integ['valor'] === 'string' &&
    typeof v['jazida'] === 'object' &&
    v['jazida'] !== null &&
    Array.isArray(v['pepitas'])
  );
}

// ---- HTML ----

const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const STYLE = `
body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#231c14;background:#fbf7ee}
h1{font-size:1.6rem;margin:0}h2{font-size:1.15rem;margin:1.6rem 0 .4rem;border-bottom:1px solid #e3d8c2}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.25rem .5rem;border-bottom:1px solid #e3d8c2;vertical-align:top}
code,pre,.mono{font-family:ui-monospace,monospace;font-size:.85rem;overflow-wrap:anywhere}
pre{white-space:pre-wrap;background:#f4eddd;padding:.5rem;border:1px solid #e3d8c2}
.pepita{border:1px solid #e3d8c2;border-left:4px solid #6b5d49;padding:.5rem .75rem;margin:.6rem 0;background:#fff}
.sev-FATAL,.sev-ERROR{border-left-color:#b23a17}.sev-WARN{border-left-color:#8a5a22}
.aviso{background:#f4eddd;border:1px solid #8a5a22;padding:.5rem .75rem}
`
  .replace(/\n/g, '')
  .trim();

function row(label: string, value: unknown): string {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td class="mono">${escapeHtml(value)}</td></tr>`;
}

/** JSON válido sem caracteres que o escape do HTML trocaria (controles e separadores Unicode). */
function jsonForHtml(laudo: Laudo): string {
  return JSON.stringify(laudo).replace(
    /[\u007f-\u009f\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function renderLaudoHtml(laudo: Laudo): string {
  const e = (v: unknown): string => escapeHtml(v);
  const parts: string[] = [];

  parts.push(`<h1>Laudo do Garimpo</h1>`);
  parts.push(
    `<p>${e(laudo.jazida.nome)} · ${e(laudo.jazida.tamanho)} bytes · gerado em ${e(laudo.geradoEm)} (${e(laudo.relogio)})</p>`,
  );

  parts.push(`<h2>Integridade</h2><table>`);
  parts.push(
    row('Algoritmo', `${laudo.integridade.algoritmo} sobre ${laudo.integridade.canonicalizacao}`),
  );
  parts.push(row('Hash do laudo', laudo.integridade.valor));
  parts.push(`</table>`);

  parts.push(`<h2>Jazida</h2><table>`);
  parts.push(row('Nome', laudo.jazida.nome));
  parts.push(row('Tamanho (bytes)', laudo.jazida.tamanho));
  parts.push(row('Modificado em', laudo.jazida.modificadoEm ?? 'desconhecido'));
  parts.push(row('Codificação', laudo.jazida.codificacao));
  parts.push(row('Impressão digital (método)', laudo.jazida.impressaoDigital.metodo));
  parts.push(row('Tamanho do bloco', laudo.jazida.impressaoDigital.tamanhoBloco));
  parts.push(row('Blocos', laudo.jazida.impressaoDigital.blocos));
  parts.push(row('Hash raiz', laudo.jazida.impressaoDigital.raiz));
  parts.push(`</table>`);

  parts.push(`<h2>Formato e agrupamento</h2><table>`);
  parts.push(row('Perfil', laudo.formato.perfil ?? 'nenhum'));
  parts.push(row('Origem', laudo.formato.origem));
  parts.push(row('Confiança', laudo.formato.confianca ?? 'não se aplica'));
  parts.push(row('Fuso', laudo.formato.fuso));
  if (laudo.formato.personalizado) {
    parts.push(row('Perfil personalizado', laudo.formato.personalizado.nome));
    parts.push(row('Expressão regular', laudo.formato.personalizado.padrao));
    parts.push(row('Formato da hora', laudo.formato.personalizado.formatoHora));
  }
  parts.push(row('Modo de agrupamento', laudo.agrupamento.modo));
  parts.push(
    row(
      'Pesos',
      Object.entries(laudo.agrupamento.pesos)
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    ),
  );
  parts.push(`</table>`);

  parts.push(`<h2>Contadores</h2><table>`);
  for (const [key, value] of Object.entries(laudo.contadores)) parts.push(row(key, value));
  parts.push(row('Período', `${laudo.periodo.inicio ?? '—'} → ${laudo.periodo.fim ?? '—'}`));
  parts.push(
    row(
      'Níveis',
      Object.entries(laudo.niveis)
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    ),
  );
  parts.push(`</table>`);

  parts.push(`<h2>Limites aplicados</h2><table>`);
  for (const [key, value] of Object.entries(laudo.limites)) parts.push(row(key, value));
  parts.push(`</table>`);

  parts.push(`<h2>Lacre</h2><table>`);
  parts.push(row('Ativo', laudo.lacre.ativo ? 'sim' : 'não'));
  parts.push(row('Regras', laudo.lacre.regras.join(', ') || 'nenhuma'));
  parts.push(
    row(
      'Substituições',
      Object.entries(laudo.lacre.substituicoes)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || '—',
    ),
  );
  parts.push(`</table>`);

  parts.push(`<h2>Pepitas (${e(laudo.pepitas.length)})</h2>`);
  for (const p of laudo.pepitas) {
    parts.push(
      `<div class="pepita sev-${escapeHtml(p.nivel, 'atributo')}"><strong>${e(p.nivel)}</strong> · ${e(p.ocorrencias)}×${p.nova ? ' · nova' : ''} · <span class="mono">${e(p.idCurto)}</span>` +
        `<pre>${e(p.gabarito)}</pre>` +
        (p.primeiraMensagem
          ? `<div>Primeira mensagem:</div><pre>${e(p.primeiraMensagem)}</pre>`
          : '') +
        `<div class="mono">${e(p.primeira ?? '—')} → ${e(p.ultima ?? '—')}</div>` +
        (p.valoresVariaram.length > 0
          ? `<table>${p.valoresVariaram
              .map(
                (m) =>
                  `<tr><td class="mono">${e(m.marcador)}</td><td>${e(m.limitado ? 'mais de ' : '')}${e(m.distintos)} distintos</td><td class="mono">${e(m.exemplos.join(' · '))}</td></tr>`,
              )
              .join('')}</table>`
          : '') +
        `</div>`,
    );
  }

  parts.push(
    `<h2>Trilha de decisões</h2><ol>${laudo.decisoes.map((d) => `<li>${e(d)}</li>`).join('')}</ol>`,
  );
  parts.push(
    `<h2>O que este laudo não garante</h2><div class="aviso"><ul>${laudo.limitacoes.map((l) => `<li>${e(l)}</li>`).join('')}</ul></div>`,
  );
  parts.push(
    `<h2>Dados do laudo (JSON)</h2><p>Use este bloco com o verificador para conferir o hash.</p><pre id="dados-laudo">${e(jsonForHtml(laudo))}</pre>`,
  );

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CSP, 'atributo')}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Laudo do Garimpo</title><style>${STYLE}</style></head>
<body>${parts.join('\n')}</body></html>
`;
}

/** Lê de volta o laudo embutido num HTML gerado pelo Garimpo. Devolve null se não achar. */
export function extractLaudoFromHtml(html: string): unknown {
  const match = /<pre id="dados-laudo">([\s\S]*?)<\/pre>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(unescapeHtml(match[1] ?? '')) as unknown;
  } catch {
    return null;
  }
}
