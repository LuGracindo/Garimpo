import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
// Identificador do build para o laudo: commit do deploy (Cloudflare) ou "dev" localmente.
const buildId = (
  process.env['WORKERS_CI_COMMIT_SHA'] ??
  process.env['CF_PAGES_COMMIT_SHA'] ??
  process.env['GITHUB_SHA'] ??
  'dev'
).slice(0, 12);

// Opções de build pensadas para a CSP restritiva (SDD SEG-01):
// - assetsInlineLimit 0: nada de data: URI para fontes (font-src 'self' não permite data:)
// - modulePreload.polyfill false: evita código extra de polyfill
// - sem sourcemap em produção
export default defineConfig({
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    cssCodeSplit: false,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
