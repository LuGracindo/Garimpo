// Confere o site publicado contra o arquivo public/_headers (o que a hospedagem de fato entrega).
// Uso: node scripts/check-live.ts https://seu-endereco.workers.dev
// Sai com 1 se algum cabeçalho esperado faltar ou diferir.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type HeaderBlocks = Map<string, Record<string, string>>;

/** Lê o _headers: cada bloco começa numa linha sem recuo (o caminho) e traz `Nome: valor` recuado. */
export function parseHeaders(text: string): HeaderBlocks {
  const blocks: HeaderBlocks = new Map();
  let current: Record<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      current = {};
      blocks.set(line.trim(), current);
    } else if (current) {
      const at = line.indexOf(':');
      if (at > 0) current[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    }
  }
  return blocks;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
}

export function compare(
  expected: Record<string, string>,
  actual: Headers,
  where: string,
): string[] {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(expected)) {
    const got = actual.get(name);
    if (got === null) problems.push(`${where}: falta o cabeçalho ${name}`);
    else if (normalize(got) !== normalize(value))
      problems.push(`${where}: ${name} difere\n      esperado: ${value}\n      recebido: ${got}`);
  }
  return problems;
}

export async function checkLive(base: string, headersText: string): Promise<string[]> {
  const problems: string[] = [];
  const blocks = parseHeaders(headersText);
  const root = new URL(base);
  if (root.protocol !== 'https:' && root.hostname !== 'localhost')
    problems.push('o endereço não é HTTPS');

  const home = await fetch(root, { redirect: 'manual' });
  if (home.status !== 200) problems.push(`/: status ${home.status} (esperado 200)`);
  problems.push(...compare(blocks.get('/*') ?? {}, home.headers, '/'));
  if (home.headers.get('set-cookie') !== null) problems.push('/: a resposta define cookie');
  const html = await home.text();
  if (!/<meta name="robots" content="noindex, nofollow"/.test(html))
    problems.push('/: falta a meta noindex');

  const robots = await fetch(new URL('/robots.txt', root));
  const robotsText = robots.status === 200 ? await robots.text() : '';
  if (!/Disallow:\s*\/\s*$/m.test(robotsText)) problems.push('/robots.txt: falta "Disallow: /"');

  const asset = /<(?:script|link)[^>]+(?:src|href)="(\/assets\/[^"]+)"/.exec(html)?.[1];
  if (!asset) problems.push('/: nenhum arquivo em /assets/ encontrado no HTML');
  else {
    const response = await fetch(new URL(asset, root));
    if (response.status !== 200) problems.push(`${asset}: status ${response.status}`);
    problems.push(...compare(blocks.get('/assets/*') ?? {}, response.headers, asset));
    // O bloco /assets/* soma ao /*: os cabeçalhos globais de segurança continuam valendo.
    for (const name of ['content-security-policy', 'x-content-type-options']) {
      if (response.headers.get(name) === null) problems.push(`${asset}: falta ${name}`);
    }
  }
  return problems;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('check-live.ts')) {
  const base = process.argv[2];
  if (!base) {
    console.error('Uso: node scripts/check-live.ts https://seu-endereco.workers.dev');
    process.exit(2);
  }
  const problems = await checkLive(base, readFileSync(resolve('public/_headers'), 'utf8'));
  if (problems.length > 0) {
    console.error(
      `${problems.length} problema(s) no site publicado:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('O site publicado entrega os cabeçalhos esperados.');
}
