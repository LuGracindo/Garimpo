# Garimpo

_Peneire o log. Encontre a pepita._ Análise de logs que não sai da sua máquina.

Aplicação web estática, 100% no navegador, sem backend. Código privado; apenas a aplicação compilada é publicada, para uso pessoal.

O projeto é guiado pelo SDD: <https://claude.ai/artifact/A9HS5UVSQGfT23ss8ynQgy>. Em caso de dúvida, o SDD (principalmente a seção 19, de decisões) é a referência.

## Estado: marco M0 (fundação)

| Pronto | Ainda não |
|---|---|
| Configuração (TypeScript estrito, Vite, ESLint com regras de segurança, Prettier, CI) | Detecção de formato, fingerprint e pepitas (M1) |
| Identidade: tokens dos dois temas, logotipo, fontes locais, tela inicial | Perfil (linha do tempo), Peneira, contexto (M2) |
| Selo **Lacrado** com autoteste real da CSP | Laudo, hashes e Lacre (M3) |
| Protocolo UI↔Worker validado, leitor em streaming, cancelamento | Endurecimento, e2e e acessibilidade automatizada (M4) |
| Gerador determinístico de logs fictícios e benchmark de leitura | Publicação (M5) |

## Primeiros passos

Requer Node 22 ou superior.

```sh
sh scripts/install-deps.sh      # instala com versões exatas e gera o package-lock.json
npm run typecheck
npm run lint
npm test
npm run check:contrast
npm run dev                     # servidor local
npm run build && npm run check:dist
```

Depois da primeira instalação, faça commit do `package.json` e do `package-lock.json`. O `.npmrc` usa `save-exact=true` e `ignore-scripts=true` (SEG-10).

## Logs de teste e benchmark

```sh
node scripts/gen-logs.ts --out /tmp/teste.log --profile iso-level --size-mb 50 --seed 1
node scripts/bench-read.ts --size-mb 200
```

Os logs são sintéticos e determinísticos (mesma semente, mesmo arquivo). Todos os dados pessoais são fictícios: e-mails em `example.test`, IPs nas faixas de documentação e cartão de teste público. **Nunca use logs reais de clientes ou do trabalho.**

Perfis do gerador: `iso-level`, `jsonl`, `http-combined`.

## Publicação (Cloudflare Pages)

Conecte o repositório privado em Workers & Pages > Create application > Pages > Connect to Git.

| Campo | Valor |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Variável de ambiente | `NODE_VERSION=22` |

Os headers de segurança estão em `public/_headers` e são copiados para `dist/`. Depois do primeiro deploy, confira no navegador (aba Rede) que a resposta traz a CSP e que o selo mostra **Lacrado**.

## Regras do projeto

- Conteúdo de log é entrada hostil: nada de `innerHTML` e afins (o ESLint falha).
- A CSP usa `connect-src 'none'`: a aplicação não consegue enviar dados para fora.
- Sem telemetria, sem cookies, sem serviços de terceiros em tempo de execução.
- Máximo de 5 dependências de execução (hoje: 1, o Preact).

## Estrutura

```
src/app        shell, selo, cliente do Worker, textos
src/ui         tokens, estilos, logotipo
src/worker     leitor em streaming e Worker
src/shared     protocolo UI↔Worker
fixtures       gerador de logs sintéticos
scripts        gerador, benchmark, contraste, verificação do build
tests/unit     testes (Vitest e fast-check)
docs/adr       registro de decisões
public         _headers, robots.txt, favicon
```
