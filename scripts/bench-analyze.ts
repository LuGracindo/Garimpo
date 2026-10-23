// Benchmark da análise completa (RNF-01 a RNF-03): leitura, segmentação, fingerprint e pepitas.
// Mede em Node. NÃO substitui medir no navegador: o desempenho real depende do navegador e do
// aparelho (SDD 19.2).
// Uso: node scripts/bench-analyze.ts [--file caminho] [--size-mb 200] [--profile iso-level] [--block-mb 4]
import { mkdirSync, openAsBlob, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { analyzeBlob } from '../src/worker/analyze-file.ts';
import { PROFILES, type Profile } from '../fixtures/generator.ts';
import { writeSyntheticLog } from './gen-logs.ts';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const sizeMb = Number(arg('size-mb', '200'));
const blockMb = Number(arg('block-mb', '4'));
const profileArg = arg('profile', 'iso-level');
if (!PROFILES.includes(profileArg as Profile)) {
  throw new RangeError(`Perfil desconhecido: ${profileArg}. Use um de: ${PROFILES.join(', ')}.`);
}
const profile = profileArg as Profile;

let file = arg('file');
let dir = '';
if (!file) {
  dir = join(tmpdir(), `garimpo-bench-analyze-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, 'sintetico.log');
  await writeSyntheticLog(file, profile, sizeMb, 1);
}

const blob = await openAsBlob(file);
let peakRss = process.memoryUsage().rss;
const started = performance.now();

const outcome = await analyzeBlob(blob, {
  blockSize: blockMb * 1024 * 1024,
  progressIntervalMs: 100,
  onProgress: () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  },
});

const seconds = (performance.now() - started) / 1000;
peakRss = Math.max(peakRss, process.memoryUsage().rss);
if (outcome.kind !== 'ready') throw new Error(`Análise não concluiu: ${outcome.kind}`);
const mb = blob.size / (1024 * 1024);
const summary = outcome.result.summary;

const report = {
  quando: new Date().toISOString(),
  ambiente: {
    node: process.version,
    so: `${platform()} ${release()}`,
    cpus: cpus().length,
    modeloCpu: cpus()[0]?.model ?? 'desconhecido',
    memoriaTotalMb: Math.round(totalmem() / (1024 * 1024)),
  },
  perfil: summary.profile,
  arquivoMb: Number(mb.toFixed(1)),
  blocoMb: blockMb,
  linhas: summary.lines,
  eventos: summary.events,
  pepitas: summary.nuggetCount,
  segundos: Number(seconds.toFixed(2)),
  mbPorSegundo: Number((mb / seconds).toFixed(1)),
  eventosPorSegundo: Math.round(summary.events / seconds),
  picoRssMb: Math.round(peakRss / (1024 * 1024)),
  metas: { rnf01: '200 MB em até 30 s', rnf03: 'pico abaixo de 3x o tamanho do arquivo' },
};

console.log(JSON.stringify(report, null, 2));

const outDir = join(import.meta.dirname, '..', 'benchmarks');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `analyze-${profile}.json`), JSON.stringify(report, null, 2));

if (dir) rmSync(dir, { recursive: true, force: true });
