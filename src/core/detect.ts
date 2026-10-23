// Detecção automática do formato (SDD 8.2, RF-10).
// pontuação = 0,6 × linhas que casam + 0,3 × timestamps válidos + 0,1 × níveis reconhecidos.
// Escolha automática quando o melhor passa de 0,6 e supera o segundo por mais de 0,1.

import { getProfile, isGeneralContinuation } from './profiles.ts';
import { PROFILE_IDS, type ProfileId } from './types.ts';

export const DETECTION_SAMPLE_LINES = 500;
export const MIN_SCORE = 0.6;
export const MIN_MARGIN = 0.1;

export interface Candidate {
  profile: ProfileId;
  score: number;
}

export interface Detection {
  /** Melhor candidato, ou null quando a amostra está vazia. */
  best: ProfileId | null;
  candidates: Candidate[];
  confident: boolean;
  sampledLines: number;
}

export function detectProfile(sample: readonly string[]): Detection {
  const lines = sample.slice(0, DETECTION_SAMPLE_LINES);
  const candidates: Candidate[] = [];

  // Linhas de continuação óbvias (indentadas, "at ...") não entram na conta de nenhum perfil.
  const counted = lines.filter((line) => !isGeneralContinuation(line));

  for (const id of PROFILE_IDS) {
    const profile = getProfile(id);
    let matched = 0;
    let timestamps = 0;
    let levels = 0;
    for (const line of counted) {
      const parsed = profile.parse(line);
      if (!parsed) continue;
      matched += 1;
      if (parsed.timeMs !== null) timestamps += 1;
      if (parsed.level !== null) levels += 1;
    }
    const total = counted.length;
    const score = total === 0 ? 0 : (0.6 * matched + 0.3 * timestamps + 0.1 * levels) / total;
    candidates.push({ profile: id, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const first = candidates[0];
  const second = candidates[1];
  const hasData = counted.length > 0 && first !== undefined && first.score > 0;

  return {
    best: hasData && first ? first.profile : null,
    candidates,
    confident:
      hasData &&
      first !== undefined &&
      first.score > MIN_SCORE &&
      first.score - (second?.score ?? 0) > MIN_MARGIN,
    sampledLines: lines.length,
  };
}
