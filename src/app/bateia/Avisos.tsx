import type { AnalysisResult } from '../../core/analyzer.ts';
import { t } from '../strings.ts';

export function Avisos({ analysis }: { analysis: AnalysisResult }) {
  const s = analysis.summary;
  const avisos: string[] = [];
  if (s.unparsed > 0) avisos.push(t.avisoNaoInterpretadas(s.unparsed));
  if (s.outOfOrder > 0) avisos.push(t.avisoForaDeOrdem(s.outOfOrder));
  if (s.truncatedEvents > 0) avisos.push(t.avisoTruncados(s.truncatedEvents));
  if (s.overflow) avisos.push(t.avisoExcesso);
  avisos.push(t.avisoLimiteAgrupamento);
  return (
    <ul class="avisos">
      {avisos.map((aviso) => (
        <li key={aviso}>{aviso}</li>
      ))}
    </ul>
  );
}
