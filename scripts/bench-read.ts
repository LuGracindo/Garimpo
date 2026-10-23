// Benchmark de leitura (RNF-01 a RNF-03, linha de base do marco M0).
// Mede só leitura em blocos e contagem de linhas, em Node. NÃO substitui medir no navegador:
// o desempenho real depende do navegador e do aparelho (SDD 19.2).
// Uso: node scripts/bench-read.ts [--file caminho] [--size-mb 200] [--block-mb 4]
import { openAsBlob } from 'node:fs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform, release } from 'node:os';
import { join } from 'node:path';
import { scanLines } from '../src/worker/reader.ts';
import { writeSyntheticLog } from './gen-logs.ts';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const sizeMb = Number(arg('size-mb', '200'));
const blockMb = Number(arg('block-mb', '4'));
let file = arg('file');
let generated = false;
let dir = '';

if (!file) {
  dir = join(tmpdir(), `garimpo-bench-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  file = join(dir, 'sintetico.log');
  await writeSyntheticLog(file, 'iso-level', sizeMb, 1);
  generated = true;
}

const blob = await openAsBlob(file);
let peakRss = process.memoryUsage().rss;
const started = performance.now();

const result = await scanLines(blob, {
  blockSize: blockMb * 1024 * 1024,
  progressIntervalMs: 50,
  onProgress: () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  },
});

const seconds = (performance.now() - started) / 1000;
peakRss = Math.max(peakRss, process.memoryUsage().rss);
const mb = blob.size / (1024 * 1024);

const report = {
  quando: new Date().toISOString(),
  ambiente: {
    node: process.version,
    so: `${platform()} ${release()}`,
    cpus: cpus().length,
    modeloCpu: cpus()[0]?.model ?? 'desconhecido',
    memoriaTotalMb: Math.round(totalmem() / (1024 * 1024)),
  },
  arquivoMb: Number(mb.toFixed(1)),
  blocoMb: blockMb,
  linhas: result.lines,
  maiorLinhaBytes: result.maxLineBytes,
  segundos: Number(seconds.toFixed(2)),
  mbPorSegundo: Number((mb / seconds).toFixed(1)),
  picoRssMb: Math.round(peakRss / (1024 * 1024)),
  metas: { rnf01: '200 MB em até 30 s', rnf03: 'pico abaixo de 3x o tamanho do arquivo' },
};

console.log(JSON.stringify(report, null, 2));

const outDir = join(import.meta.dirname, '..', 'benchmarks');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'last.json'), JSON.stringify(report, null, 2));

if (generated) rmSync(dir, { recursive: true, force: true });
