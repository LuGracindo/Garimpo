// Verifica se o build é compatível com a CSP restritiva (SDD SEG-01, SEG-11):
// sem script ou estilo inline, sem atributo style, sem data: em fontes, sem URLs externas,
// e com o arquivo _headers presente e com connect-src 'none'.
// Uso: node scripts/check-dist.ts [pasta]   (padrão: dist)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function checkDist(dist: string): string[] {
  const problems: string[] = [];
  const indexPath = join(dist, 'index.html');

  if (!existsSync(indexPath)) return [`${indexPath} não existe (rode npm run build)`];
  const html = readFileSync(indexPath, 'utf8');

  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\bsrc\s*=/.test(match[1] ?? '')) problems.push('index.html: script inline encontrado');
  }
  if (/<style\b/i.test(html)) problems.push('index.html: bloco <style> inline encontrado');
  if (/\sstyle\s*=/i.test(html)) problems.push('index.html: atributo style encontrado');
  if (/\son[a-z]+\s*=/i.test(html)) problems.push('index.html: manipulador de evento inline');
  for (const match of html.matchAll(/(?:src|href)\s*=\s*"(https?:)?\/\/[^"]*"/gi)) {
    problems.push(`index.html: URL externa (${match[0]})`);
  }

  const files = listFiles(dist);
  for (const file of files.filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(file, 'utf8');
    if (/url\(\s*["']?data:/i.test(css)) problems.push(`${file}: data: URI em CSS (font-src não permite)`);
    for (const match of css.matchAll(/url\(\s*["']?(https?:)?\/\/[^)]*\)/gi)) {
      problems.push(`${file}: URL externa em CSS (${match[0]})`);
    }
  }

  if (!files.some((f) => f.endsWith('.woff2'))) {
    problems.push('nenhuma fonte .woff2 no build (fontes locais esperadas)');
  }

  const headersPath = join(dist, '_headers');
  if (!existsSync(headersPath)) {
    problems.push('_headers ausente no build (headers de segurança não seriam aplicados)');
  } else {
    const headers = readFileSync(headersPath, 'utf8');
    for (const required of ["connect-src 'none'", "default-src 'none'", 'nosniff', 'Referrer-Policy: no-referrer']) {
      if (!headers.includes(required)) problems.push(`_headers: faltando ${required}`);
    }
  }

  return problems;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');

if (isMain) {
  const dist = process.argv[2] ?? 'dist';
  const problems = checkDist(dist);
  if (problems.length > 0) {
    for (const p of problems) console.error(`FALHA ${p}`);
    process.exit(1);
  }
  console.log(`ok: ${dist} compatível com a CSP`);
}
