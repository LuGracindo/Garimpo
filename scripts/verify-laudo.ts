// Verificador independente do laudo (AUD-07).
//   node scripts/verify-laudo.ts <laudo.json|laudo.html> [--jazida <arquivo-original>]
// Sem --jazida: confere só o hash de integridade do laudo.
// Com --jazida: também recalcula a impressão digital e as contagens a partir do arquivo.
// Saída 0 = tudo confere; 1 = divergência; 2 = uso incorreto ou laudo ilegível.

import { openAsBlob, readFileSync } from 'node:fs';
import { extractLaudoFromHtml, isLaudo, verifyLaudo } from '../src/core/laudo.ts';
import { sha256Hex } from '../src/worker/fingerprint.ts';
import { verifyAgainstJazida } from '../src/worker/verify-laudo.ts';

function usage(): never {
  console.error('Uso: node scripts/verify-laudo.ts <laudo.json|laudo.html> [--jazida <arquivo>]');
  process.exit(2);
}

const args = process.argv.slice(2);
const laudoPath = args[0];
if (!laudoPath) usage();
const jazidaIndex = args.indexOf('--jazida');
const jazidaPath = jazidaIndex === -1 ? undefined : args[jazidaIndex + 1];
if (jazidaIndex !== -1 && !jazidaPath) usage();

const raw = readFileSync(laudoPath, 'utf8');
let parsed: unknown;
try {
  parsed = /\.html?$/i.test(laudoPath) ? extractLaudoFromHtml(raw) : JSON.parse(raw);
} catch {
  parsed = null;
}
if (!isLaudo(parsed)) {
  console.error('Não foi possível ler um laudo do Garimpo neste arquivo.');
  process.exit(2);
}

let failed = false;
const integrity = await verifyLaudo(parsed, sha256Hex);
console.log(`${integrity.ok ? 'OK ' : 'FALHA'} Integridade do laudo`);
if (!integrity.ok) {
  failed = true;
  console.log(`     esperado   ${integrity.esperado}`);
  console.log(`     calculado  ${integrity.calculado}`);
}

if (jazidaPath) {
  const blob = await openAsBlob(jazidaPath);
  for (const item of await verifyAgainstJazida(parsed, blob)) {
    console.log(`${item.ok ? 'OK ' : 'FALHA'} ${item.nome}`);
    if (!item.ok) {
      failed = true;
      console.log(`     esperado   ${item.esperado}`);
      console.log(`     encontrado ${item.encontrado}`);
    }
  }
}

console.log(failed ? '\nO laudo NÃO confere.' : '\nO laudo confere.');
process.exit(failed ? 1 : 0);
