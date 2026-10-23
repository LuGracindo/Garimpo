import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { checkLive, parseHeaders } from '../../scripts/check-live.ts';

const HEADERS = `/*
  Content-Security-Policy: default-src 'none'
  X-Content-Type-Options: nosniff
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

const HTML =
  '<!doctype html><meta name="robots" content="noindex, nofollow"><script src="/assets/app.js"></script>';

async function comServidor(
  ajuste: (path: string, h: Record<string, string>) => Record<string, string>,
): Promise<string[]> {
  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    const base = {
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
    };
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    const h = ajuste(path, { ...base, 'cache-control': cache });
    const body =
      path === '/robots.txt' ? 'User-agent: *\nDisallow: /\n' : path === '/' ? HTML : 'x';
    res.writeHead(200, h);
    res.end(body);
  });
  await new Promise<void>((ok) => server.listen(0, ok));
  const { port } = server.address() as { port: number };
  try {
    return await checkLive(`http://localhost:${port}/`, HEADERS);
  } finally {
    server.close();
  }
}

describe('conferência do site publicado (@M5)', () => {
  it('lê os blocos do _headers', () => {
    const blocks = parseHeaders(HEADERS);
    expect(blocks.get('/*')?.['x-content-type-options']).toBe('nosniff');
    expect(blocks.get('/assets/*')?.['cache-control']).toContain('immutable');
  });

  it('aceita um site correto', async () => {
    expect(await comServidor((_p, h) => h)).toEqual([]);
  });

  it('acusa cabeçalho ausente, diferente e cookie', async () => {
    const semCsp = await comServidor((p, h) => {
      if (p === '/') delete h['content-security-policy'];
      return h;
    });
    expect(semCsp.some((p) => p.includes('content-security-policy'))).toBe(true);
    const cacheErrado = await comServidor((p, h) =>
      p.startsWith('/assets/') ? { ...h, 'cache-control': 'no-cache' } : h,
    );
    expect(cacheErrado.some((p) => p.includes('cache-control difere'))).toBe(true);
    const cookie = await comServidor((p, h) => (p === '/' ? { ...h, 'set-cookie': 'a=1' } : h));
    expect(cookie.some((p) => p.includes('cookie'))).toBe(true);
  });
});
