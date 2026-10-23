// Verifica o contraste dos tokens de identidade. Falha (exit 1) se algum par exigido não passar.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from './lib/contrast.ts';

const css = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'tokens.css'), 'utf8');
const results = evaluate(css);

let failures = 0;
for (const r of results) {
  const status = r.ok ? 'ok   ' : 'FALHA';
  if (!r.ok) failures += 1;
  console.log(
    `${status} [${r.tema}] ${r.fg} sobre ${r.bg}: ${r.ratio.toFixed(2)}:1 (mín. ${r.min}) ${r.uso}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} par(es) abaixo do mínimo.`);
  process.exit(1);
}
console.log('\nTodos os pares exigidos passam.');
