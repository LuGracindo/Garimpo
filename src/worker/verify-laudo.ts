// Verificação do laudo contra a jazida original (AUD-07): recalcula a impressão digital e as
// contagens a partir do arquivo e compara com o que o laudo registra. Sem DOM nem Worker.

import type { CustomProfileSpec } from '../core/custom-profile.ts';
import type { Laudo } from '../core/laudo.ts';
import { PROFILE_IDS, type ProfileId } from '../core/types.ts';
import { analyzeBlob } from './analyze-file.ts';
import { fingerprintBlob } from './fingerprint.ts';
import type { BlobLike } from './reader.ts';

export interface Check {
  nome: string;
  ok: boolean;
  esperado: string;
  encontrado: string;
}

function check(nome: string, esperado: unknown, encontrado: unknown): Check {
  return {
    nome,
    ok: String(esperado) === String(encontrado),
    esperado: String(esperado),
    encontrado: String(encontrado),
  };
}

function customFrom(laudo: Laudo): CustomProfileSpec | undefined {
  const c = laudo.formato.personalizado;
  if (!c) return undefined;
  return {
    name: c.nome,
    pattern: c.padrao,
    timeFormat: c.formatoHora as CustomProfileSpec['timeFormat'],
    levelMap: c.mapaNiveis as CustomProfileSpec['levelMap'],
    continuation: c.continuacao as CustomProfileSpec['continuation'],
  };
}

export async function verifyAgainstJazida(laudo: Laudo, blob: BlobLike & Blob): Promise<Check[]> {
  const checks: Check[] = [];
  const fp = laudo.jazida.impressaoDigital;
  const recomputed = await fingerprintBlob(blob, { blockSize: fp.tamanhoBloco });
  checks.push(check('Tamanho da jazida (bytes)', fp.bytes, recomputed?.bytes));
  checks.push(check('Blocos da impressão digital', fp.blocos, recomputed?.blocos));
  checks.push(check('Hash raiz da impressão digital', fp.raiz, recomputed?.raiz));

  const perfil = laudo.formato.perfil;
  const custom = customFrom(laudo);
  const usable =
    custom !== undefined ||
    (perfil !== null && (PROFILE_IDS as readonly string[]).includes(perfil));
  if (!usable) {
    checks.push(check('Perfil de formato reconhecido', 'sim', 'não'));
    return checks;
  }
  const out = await analyzeBlob(blob, {
    blockSize: 4 * 1024 * 1024,
    profile: custom ? 'custom' : (perfil as ProfileId),
    custom,
    mode: laudo.agrupamento.modo as 'conservador' | 'padrao' | 'agressivo',
  });
  if (out.kind !== 'ready') {
    checks.push(check('Análise concluída', 'sim', 'não'));
    return checks;
  }
  const s = out.result.summary;
  const c = laudo.contadores;
  checks.push(check('Linhas', c.linhas, s.lines));
  checks.push(check('Eventos', c.eventos, s.events));
  checks.push(check('Linhas não interpretadas', c.linhasNaoInterpretadas, s.unparsed));
  checks.push(check('Eventos fora de ordem', c.eventosForaDeOrdem, s.outOfOrder));
  checks.push(check('Pepitas', c.pepitas, s.nuggetCount));
  for (const [nivel, n] of Object.entries(laudo.niveis)) {
    checks.push(
      check(`Eventos ${nivel}`, n, s.severityCounts[nivel as keyof typeof s.severityCounts]),
    );
  }
  return checks;
}
