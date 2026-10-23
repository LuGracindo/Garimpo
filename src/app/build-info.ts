// Identificação do build para o laudo (AUD-01). Os valores são injetados pelo Vite (`define`).

import type { BuildInfo } from '../core/laudo.ts';

export const BUILD: BuildInfo = {
  nome: 'Garimpo',
  versao: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
};
