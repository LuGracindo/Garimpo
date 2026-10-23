import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Opções de build pensadas para a CSP restritiva (SDD SEG-01):
// - assetsInlineLimit 0: nada de data: URI para fontes (font-src 'self' não permite data:)
// - modulePreload.polyfill false: evita código extra de polyfill
// - sem sourcemap em produção
export default defineConfig({
  plugins: [preact()],
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
