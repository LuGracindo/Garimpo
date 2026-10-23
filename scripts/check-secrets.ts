// Procura segredos e arquivos que não devem ir para o repositório (SDD SEG-17).
// Olha só os arquivos versionados (git ls-files); sem git, percorre a pasta.
// Uso: node scripts/check-secrets.ts            (sai com 1 se achar algo)
// Linha com o marcador `segredo-falso` é ignorada (use só em exemplos de teste).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_NAMES = [
  /\.log$/i,
  /\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)$/,
];

const PATTERNS: { nome: string; regex: RegExp }[] = [
  {
    nome: 'chave privada',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  { nome: 'chave AWS', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    nome: 'token do GitHub',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  },
  { nome: 'token do Slack', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { nome: 'chave do Stripe', regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { nome: 'chave do Google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nome: 'token do Cloudflare/npm', regex: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { nome: 'JWT', regex: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}\b/ },
  {
    nome: 'senha em atribuição',
    regex:
      /\b(?:password|passwd|senha|secret|api[_-]?key|token)\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  },
  {
    nome: 'URL com usuário e senha',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@[^\s/]+/i,
  },
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = base === '' ? name : `${base}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

export function trackedFiles(root: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return out.split('\0').filter((f) => f !== '');
  } catch {
    return walk(root);
  }
}

export function scanText(path: string, text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.includes('segredo-falso') || line.length > 5000) continue;
    for (const { nome, regex } of PATTERNS) {
      if (regex.test(line)) problems.push(`${path}:${i + 1}: possível ${nome}`);
    }
  }
  return problems;
}

export function scan(root: string): string[] {
  const problems: string[] = [];
  for (const file of trackedFiles(root)) {
    if (FORBIDDEN_NAMES.some((re) => re.test(file))) {
      problems.push(`${file}: tipo de arquivo que não deve ser versionado`);
      continue;
    }
    const full = join(root, file);
    if (!existsSync(full) || !statSync(full).isFile() || statSync(full).size > 2_000_000) continue;
    const buffer = readFileSync(full);
    if (buffer.subarray(0, 8000).includes(0)) continue;
    problems.push(...scanText(file, buffer.toString('utf8')));
  }
  return problems;
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')
) {
  const problems = scan(process.argv[2] ?? '.');
  if (problems.length > 0) {
    console.error(
      `${problems.length} possível(is) segredo(s):\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('Nenhum segredo encontrado.');
}
