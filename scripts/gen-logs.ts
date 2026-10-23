// Uso: node scripts/gen-logs.ts --profile iso-level --size-mb 50 --seed 1 --out /tmp/teste.log
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { PROFILES, generateLines, type Profile } from '../fixtures/generator.ts';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

export async function writeSyntheticLog(
  path: string,
  profile: Profile,
  sizeMb: number,
  seed: number,
): Promise<{ bytes: number; lines: number }> {
  const stream = createWriteStream(path);
  let buffer = '';
  let lines = 0;
  let bytes = 0;

  for (const line of generateLines({ profile, seed, targetBytes: sizeMb * 1024 * 1024 })) {
    buffer += `${line}\n`;
    lines += 1;
    if (buffer.length >= 1 << 20) {
      bytes += Buffer.byteLength(buffer);
      if (!stream.write(buffer)) await once(stream, 'drain');
      buffer = '';
    }
  }
  if (buffer.length > 0) {
    bytes += Buffer.byteLength(buffer);
    stream.write(buffer);
  }
  stream.end();
  await once(stream, 'finish');
  return { bytes, lines };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');

if (isMain) {
  const out = arg('out');
  const profile = (arg('profile', 'iso-level') ?? 'iso-level') as Profile;
  const sizeMb = Number(arg('size-mb', '10'));
  const seed = Number(arg('seed', '1'));

  if (!out || !PROFILES.includes(profile) || !Number.isFinite(sizeMb) || sizeMb <= 0) {
    console.error(
      'Uso: node scripts/gen-logs.ts --out <arquivo> [--profile iso-level|jsonl|http-combined] [--size-mb 10] [--seed 1]',
    );
    process.exit(1);
  }

  const result = await writeSyntheticLog(out, profile, sizeMb, seed);
  console.log(JSON.stringify({ out, profile, seed, ...result }));
}
