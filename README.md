# Garimpo

_Peneire o log. Encontre a pepita._ Análise de logs que não sai da sua máquina.

**[Abrir o Garimpo](https://garimpo-fbfsk7x2q9.lucasgracindo73.workers.dev/)**

O Garimpo agrupa milhares de linhas de log em poucas **pepitas**: erros com a mesma forma (mesma mensagem com valores diferentes, mesmo stack trace) viram um único item, com contagem, severidade e linha do tempo. É uma aplicação web estática que roda 100% no navegador, sem backend: o arquivo é lido localmente, em streaming, e nenhum byte é enviado para fora.

## Por que confiar que o log não sai da máquina

A garantia não depende de promessa, e sim de configuração verificável:

- **CSP com `connect-src 'none'`** (`public/_headers`): o navegador bloqueia qualquer requisição de rede feita pela aplicação, inclusive por código de terceiros.
- **Selo Lacrado**: ao abrir, a interface tenta uma requisição a um domínio `.invalid` e só mostra o selo se a CSP a bloquear.
- **Sem telemetria, cookies ou serviços de terceiros** em tempo de execução. Uma única dependência de execução (Preact).
- **Lacre**: mascara e-mail, IPv4/IPv6, CPF/CNPJ, cartão, JWT e chaves de API antes de exportar um laudo.

## Funcionalidades

- **Detecção automática do formato**, com perfis `iso-level`, `jsonl`, `http-combined` e `lvl-dash`, além de perfil personalizado por regex com grupos nomeados.
- **Eventos multilinha**: stack traces são reconhecidos e assinados (exceção + primeiros frames + causa).
- **Normalização em 11 etapas** (UUID, hex, JWT, URLs, números…) para chegar ao gabarito de cada pepita.
- **Perfil**: histograma por severidade com seleção de intervalo por arrasto ou teclado, e tabela equivalente para leitores de tela.
- **Peneira**: filtros por nível, intervalo, pepita, texto literal e regex (em Worker isolado, derrubado se travar).
- **Laudo** em HTML autocontido e JSON (`garimpo-laudo/1`) com hash SHA-256 de integridade e impressão digital do arquivo, conferíveis pelo verificador de linha de comando.
- **Atalhos de teclado** (`/`, `j`/`k`, `Enter`, `[`/`]`, `f`, `e`, `?`, `Esc`) e arquivos de até 2 GB.

## Arquitetura

```
Interface (Preact) ──protocolo tipado──▶ Worker de análise ──▶ Worker de regex
   │                                        │
   │  pede fatias sob demanda               │  lê o File em streaming e guarda
   └────────────── Blob original ◀──────────┘  só offsets e índices (ADR-03)
```

- A interface nunca recebe o arquivo inteiro: o Worker guarda offsets, e as linhas exibidas são relidas do `Blob` original por fatias.
- Todo conteúdo de log é tratado como entrada hostil: sem `innerHTML` (o ESLint falha), Trusted Types exigidos pela CSP.
- As decisões e os ajustes de cada marco estão em [`docs/adr`](docs/adr/README.md).

```
src/app        shell, selo, cliente do Worker, textos
src/ui         tokens, estilos, logotipo
src/core       níveis, perfis, detecção, segmentador, normalização, fingerprint, pepitas, laudo, Lacre
src/worker     leitor em streaming, sessão de consultas e Workers
src/shared     protocolo UI↔Worker e política Trusted Types
fixtures       gerador de logs sintéticos
scripts        benchmark, contraste, verificação do build, e2e, laudo, segredos
tests/unit     testes (Vitest e fast-check)
docs/adr       registro de decisões
public         _headers, robots.txt, favicon
```

## Rodando localmente

Requer Node 22 ou superior.

```sh
npm ci                  # versões exatas do package-lock.json (scripts de instalação desligados no .npmrc)
npm run dev             # servidor local
```

Verificações (as mesmas da CI):

```sh
npm run typecheck
npm run lint
npm run format
npm test
npm run check:contrast
npm run check:secrets
npm run build && npm run check:dist
npx playwright install chromium && npm run e2e   # e2e com CSP real e acessibilidade (axe)
```

Conferir um laudo exportado contra o arquivo original:

```sh
npm run verify:laudo -- laudo.html --jazida arquivo.log
```

## Logs de teste e benchmark

```sh
node scripts/gen-logs.ts --out /tmp/teste.log --profile iso-level --size-mb 50 --seed 1
node scripts/bench-read.ts --size-mb 200
node scripts/bench-analyze.ts --size-mb 200 --profile iso-level
```

Os logs são sintéticos e determinísticos (mesma semente, mesmo arquivo). Todos os dados pessoais são fictícios: e-mails em `example.test`, IPs nas faixas de documentação e cartão de teste público. **Nunca use logs reais de clientes ou do trabalho.**

## Publicação (Cloudflare Workers)

O site é servido como assets estáticos de um Worker (`wrangler.jsonc` aponta para `dist`). Para publicar o seu, conecte o repositório em Workers & Pages > Create application > Import a repository:

| Campo                | Valor             |
| -------------------- | ----------------- |
| Build command        | `npm run build`   |
| Variável de ambiente | `NODE_VERSION=22` |

Os headers de segurança estão em `public/_headers` e são copiados para `dist/`. Depois de cada deploy, confira que a hospedagem entrega exatamente esses headers:

```sh
node scripts/check-live.ts https://garimpo-fbfsk7x2q9.lucasgracindo73.workers.dev
```

## Estado

**Pronto (v1):** núcleo de análise (M1), Perfil, Peneira e detalhe (M2), laudo, impressão digital e Lacre (M3), testes de robustez, e2e e acessibilidade automatizada (M4).

**Próximos passos:** publicação final (M5); perfis embutidos syslog e logfmt e leitura de `.gz` (v1.1).

## Licença

[MIT](LICENSE) © 2026 Lucas Gracindo
