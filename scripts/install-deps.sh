#!/usr/bin/env sh
# Instala as dependências com versões exatas (.npmrc tem save-exact=true) e gera o package-lock.json.
# Rode uma vez e faça commit do package.json e do package-lock.json.
# Política (SDD 5.6): no máximo 5 dependências de execução; hoje é 1 (preact).
set -eu

npm install preact

npm install --save-dev \
  typescript vite @preact/preset-vite \
  vitest fast-check \
  eslint typescript-eslint prettier \
  @types/node \
  @fontsource-variable/fraunces @fontsource/hanken-grotesk @fontsource/jetbrains-mono

echo "Pronto. Rode: npm run typecheck && npm run lint && npm test && npm run build"
