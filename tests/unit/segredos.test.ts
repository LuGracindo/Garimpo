import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, scanText } from '../../scripts/check-secrets.ts';

// Valores montados em pedaços para este arquivo não ser achado pelo próprio verificador.
const aws = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const gh = ['ghp', '_', 'a'.repeat(36)].join('');
const chavePrivada = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');

describe('verificação de segredos (@SEG-17)', () => {
  it('acha os formatos conhecidos', () => {
    expect(scanText('a.ts', `const k = '${aws}';`)).toHaveLength(1);
    expect(scanText('a.ts', `x ${gh}`)).toHaveLength(1);
    expect(scanText('a.pem', chavePrivada)).toHaveLength(1);
    expect(scanText('a.ts', 'const password = "hunter2hunter2";')).toHaveLength(1); // segredo-falso
    expect(scanText('a.ts', 'url = "https://user:pass1234@host.exemplo/x"')).toHaveLength(1); // segredo-falso
  });

  it('não reclama de código comum nem de linha marcada como exemplo', () => {
    expect(scanText('a.ts', 'const token = lerToken(entrada);')).toEqual([]);
    expect(scanText('a.ts', 'const passwordLength = 12;')).toEqual([]);
    expect(scanText('a.ts', `const k = '${aws}'; // segredo-falso`)).toEqual([]);
  });

  it('barra arquivos que não devem ser versionados e ignora binários', () => {
    const dir = mkdtempSync(join(tmpdir(), 'garimpo-seg-'));
    try {
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'src', 'ok.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'producao.log'), '2026-10-22 ERROR algo\n');
      writeFileSync(join(dir, '.env'), 'A=1\n');
      writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3, ...Buffer.from(aws)]));
      const problems = scan(dir);
      expect(problems.some((p) => p.startsWith('producao.log'))).toBe(true);
      expect(problems.some((p) => p.startsWith('.env'))).toBe(true);
      expect(problems.some((p) => p.includes('bin.dat'))).toBe(false);
      expect(problems.some((p) => p.includes('ok.ts'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
