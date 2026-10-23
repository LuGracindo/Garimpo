// Testes ponta a ponta no Chromium (M4). Serve o `dist/` com os mesmos cabeçalhos do _headers
// (CSP estrita inclusive), abre a aplicação como a pessoa usaria e confere: fluxo da bateia,
// laudo baixado e verificado, Lacre sem vazamento, nenhuma violação de CSP e acessibilidade (axe).
//
// Pré-requisitos (uma vez): npm install --save-dev playwright axe-core
//                           npx playwright install chromium
// Uso: npm run build && npm run e2e
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { generateLines } from '../fixtures/generator.ts';

const DIST = resolve('dist');
const PORT = 4179;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Cabeçalhos do bloco `/*` do _headers (o mesmo arquivo que a hospedagem usa). */
function readHeaders(): Record<string, string> {
  const text = readFileSync(resolve('public/_headers'), 'utf8');
  const headers: Record<string, string> = {};
  let inGlobal = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inGlobal = line.trim() === '/*';
    else if (inGlobal && line.trim() !== '') {
      const at = line.indexOf(':');
      if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return headers;
}

function serve(): Promise<Server> {
  const headers = readHeaders();
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const file = join(DIST, path === '/' ? 'index.html' : decodeURIComponent(path));
    if (!file.startsWith(DIST) || !existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      ...headers,
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    response.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(PORT, () => done(server)));
}

// JWT de mentira, montado em pedaços para a varredura de segredos não reclamar.
const JWT_FALSO = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
].join('.');

/** Log sintético com dados sensíveis plantados (tudo falso). */
function writeSample(dir: string): string {
  const lines = [...generateLines({ profile: 'iso-level', seed: 11, maxEvents: 600 })];
  for (let i = 0; i < 40; i += 1) {
    const t = `2026-10-22T11:${String(i % 60).padStart(2, '0')}:00Z`;
    lines.push(
      `${t} ERROR [main] pay.Svc - falha ao cobrar user${i % 5}@empresa.com cpf 529.982.247-25 ip 10.0.0.${i % 9}`,
    );
    lines.push(`${t} INFO [main] auth.Svc - token ${JWT_FALSO} emitido`);
  }
  const path = join(dir, 'amostra.log');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

const problems: string[] = [];
const step = async (name: string, fn: () => Promise<string | void>): Promise<void> => {
  try {
    const out = await fn();
    console.log(`OK    ${name}${out ? ` — ${out}` : ''}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.log(`FALHA ${name} — ${message}`);
    problems.push(name);
  }
};

const require = createRequire(import.meta.url);

async function accessibility(page: Page, where: string): Promise<string> {
  const axe = require('axe-core') as { source: string };
  // `evaluate` não passa pela CSP da página: nada de bypassCSP, a CSP continua valendo.
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const run = (
      window as unknown as { axe: { run: (c: Document) => Promise<{ violations: unknown[] }> } }
    ).axe.run;
    const result = await run(document);
    return result.violations as {
      id: string;
      impact: string | null;
      help: string;
      nodes: { target: unknown[] }[];
    }[];
  });
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of violations) {
    const alvo = v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join(' | ');
    console.log(
      `      axe[${where}] ${v.impact ?? '?'} ${v.id}: ${v.help} (${v.nodes.length}) ${alvo}`,
    );
  }
  if (serious.length > 0) throw new Error(`${serious.length} violação(ões) séria(s) em ${where}`);
  return `${violations.length} aviso(s) menores`;
}

const work = mkdtempSync(join(tmpdir(), 'garimpo-e2e-'));
const server = await serve();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const cspViolations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      );
    });
  });
  page.on('pageerror', (e) => problems.push(`erro na página: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/lacre-teste/.test(m.text())) cspViolations.push(m.text());
  });
  const sample = writeSample(work);
  await page.goto(`http://localhost:${PORT}/`);

  await step('tela inicial acessível', () => accessibility(page, 'inicio'));

  await step('abre um arquivo e mostra a bateia', async () => {
    await page.setInputFiles('input[type=file]', sample);
    await page.waitForSelector('.bateia', { timeout: 30_000 });
    return (await page.locator('.bateia-topo .cartao-titulo').innerText()).trim();
  });
  await step('bateia acessível', () => accessibility(page, 'bateia'));

  await step('atalhos: j escolhe uma pepita', async () => {
    await page.locator('body').click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('j');
    await page.waitForSelector('.pepita-botao[aria-pressed="true"]', { timeout: 5000 });
  });

  await step('aba Ocorrências lista linhas do arquivo', async () => {
    await page.getByRole('tab', { name: /Ocorr/ }).click();
    await page.waitForSelector('.oc-texto');
    return (await page.locator('.oc-texto').first().innerText()).slice(0, 60);
  });
  await step('ocorrências acessíveis', () => accessibility(page, 'ocorrencias'));

  await step('abre o laudo', async () => {
    await page.getByRole('button', { name: /Exportar laudo/ }).click();
    await page.waitForSelector('.laudo-dados', { timeout: 20_000 });
  });
  await step('laudo acessível', () => accessibility(page, 'laudo'));

  const baixar = async (nome: string, destino: string): Promise<string> => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: nome }).click(),
    ]);
    const file = join(work, destino);
    await download.saveAs(file);
    return file;
  };
  const verificador = resolve('scripts/verify-laudo.ts');
  const verificar = (args: string[]): number => {
    try {
      execFileSync('node', [verificador, ...args], { stdio: 'pipe' });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? -1;
    }
  };

  let htmlSemLacre = '';
  await step('laudo sem Lacre baixado e verificado com a jazida', async () => {
    htmlSemLacre = await baixar('Baixar laudo (HTML)', 'sem-lacre.html');
    if (verificar([htmlSemLacre, '--jazida', sample]) !== 0)
      throw new Error('o verificador reprovou');
  });

  let htmlLacrado = '';
  let jsonLacrado = '';
  let mapa = '';
  await step('liga o Lacre e baixa HTML, JSON e mapa', async () => {
    await page.getByLabel('Mascarar dados sensíveis (tela e laudo)').check();
    await page.waitForTimeout(800);
    htmlLacrado = await baixar('Baixar laudo (HTML)', 'lacrado.html');
    jsonLacrado = await baixar('Baixar laudo (JSON)', 'lacrado.json');
    mapa = await baixar('Baixar mapa de marcadores', 'mapa.json');
  });
  await step('o laudo lacrado não contém dado sensível; o mapa contém', async () => {
    for (const file of [htmlLacrado, jsonLacrado]) {
      const text = readFileSync(file, 'utf8');
      for (const ruim of ['@empresa.com', '529.982.247-25', '247', 'eyJhbGciOi', '10.0.0.1']) {
        if (text.includes(ruim)) throw new Error(`${file} contém ${ruim}`);
      }
    }
    if (!readFileSync(mapa, 'utf8').includes('@empresa.com'))
      throw new Error('mapa sem os valores originais');
  });
  await step('verificador: aceita os lacrados, rejeita adulterado e jazida errada', async () => {
    if (verificar([htmlLacrado, '--jazida', sample]) !== 0)
      throw new Error('HTML lacrado reprovado');
    if (verificar([jsonLacrado, '--jazida', sample]) !== 0)
      throw new Error('JSON lacrado reprovado');
    const adulterado = join(work, 'adulterado.json');
    writeFileSync(
      adulterado,
      readFileSync(jsonLacrado, 'utf8').replace(/"linhas": ?\d+/, '"linhas": 1'),
    );
    if (verificar([adulterado]) !== 1) throw new Error('aceitou laudo adulterado');
    const outra = join(work, 'outra.log');
    writeFileSync(outra, 'outro arquivo\n');
    if (verificar([jsonLacrado, '--jazida', outra]) !== 1) throw new Error('aceitou outra jazida');
  });

  await step('Esc volta à bateia e o Lacre mascara a tela', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.bateia-corpo');
    await page.waitForSelector('.oc-texto');
    const texto = (await page.locator('.oc-texto').allInnerTexts()).join('\n');
    if (/@empresa\.com|529\.982/.test(texto)) throw new Error('dado sensível na lista');
  });

  await step('nenhuma violação de CSP nem erro de console', async () => {
    const csp = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    const esperadas = csp.filter((c) => !/lacre-teste/.test(c));
    if (esperadas.length > 0) throw new Error(`CSP: ${esperadas.join('; ')}`);
    if (cspViolations.length > 0) throw new Error(`console: ${cspViolations.join('; ')}`);
  });
} finally {
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problema(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nTudo certo.');
