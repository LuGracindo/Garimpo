# Garimpo

_Peneire o log. Encontre a pepita._ Análise de logs que não sai da sua máquina.

Aplicação web estática, 100% no navegador, sem backend. Código privado; apenas a aplicação compilada é publicada, para uso pessoal.


## Estado: marco M3 completo (laudo, hashes e Lacre)

| Pronto                                                                                                                                                                                         | Ainda não                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| M0: configuração, identidade, selo **Lacrado**, protocolo UI↔Worker, leitor em streaming, gerador de logs sintéticos                                                                           | Endurecimento, e2e e acessibilidade automatizada (M4) |
| M1: detecção automática do formato (RF-10) e escolha manual (RF-11)                                                                                                                            | Publicação final (M5)                                 |
| M1: perfis `iso-level`, `jsonl`, `http-combined` e `lvl-dash` (formato `Lvl: 10 - ... - data hora:ms - T123 - contexto - mensagem`)                                                            | Perfis embutidos syslog e logfmt, `.gz` (v1.1)        |
| M1: eventos multilinha (RF-12), campos (RF-13), linhas sem tempo (RF-14), fuso UTC padrão (RF-15)                                                                                              |                                                       |
| M1: normalização em 11 etapas, assinatura de stack trace, pepitas e prioridade (RF-20 a RF-22)                                                                                                 | Perfis embutidos syslog e logfmt, `.gz` (v1.1)        |
| M1: lista de pepitas com gabarito e valores que variaram na tela                                                                                                                               |                                                       |
| M2: Perfil (barras por severidade, seleção de intervalo por arrasto e teclado, tabela equivalente)                                                                                             |                                                       |
| M2: Peneira (níveis, intervalo, pepita e texto literal), contagem por pepita sob o filtro                                                                                                      |                                                       |
| M2: detalhe com abas Resumo, Ocorrências e Sedimento, lista virtualizada e contexto sob demanda                                                                                                |                                                       |
| M2: busca por regex em Worker isolado, derrubado se ficar 2 s sem sinal de vida                                                                                                                |                                                       |
| M2: atalhos de teclado (`/`, `j`/`k`, `Enter`, `[`/`]`, `f`, `?`, `Esc`), com opção de desligar                                                                                                |                                                       |
| M2: estados de arquivo binário, acima de 2 GB e sem memória                                                                                                                                    |                                                       |
| Perfil personalizado: o formato é descrito por regex com grupos nomeados, com pré-visualização e perfis salvos no navegador                                                                    |                                                       |
| M3: Laudo em HTML autocontido (sem scripts, CSP própria) e JSON `garimpo-laudo/1`, com hash SHA-256 de integridade                                                                             |                                                       |
| M3: impressão digital da jazida (SHA-256 por blocos de 4 MiB) e id do build no laudo                                                                                                           |                                                       |
| M3: Lacre: e-mail, IPv4/IPv6, CPF/CNPJ (com dígitos verificadores), cartão (Luhn), JWT e chaves de API; UUID e telefone opcionais. Marcadores `<EMAIL_1>`; mapa só em memória, baixado à parte |                                                       |
| M4: testes de robustez (texto aleatório, Lacre, escape, selo adulterado, regexes embutidas contra entradas hostis)                                                                             |                                                       |
| M4: e2e no Chromium com CSP real e acessibilidade (axe): `npm run build && npm run e2e`                                                                                                        |                                                       |
| M3: tela do Laudo (`e`), Lacre também nas linhas exibidas, verificador `npm run verify:laudo -- laudo.html --jazida arquivo.log`                                                               |                                                       |

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
node scripts/bench-analyze.ts --size-mb 200 --profile iso-level
```

Os logs são sintéticos e determinísticos (mesma semente, mesmo arquivo). Todos os dados pessoais são fictícios: e-mails em `example.test`, IPs nas faixas de documentação e cartão de teste público. **Nunca use logs reais de clientes ou do trabalho.**

Perfis do gerador: `iso-level`, `jsonl`, `http-combined`, `lvl-dash`.

## Publicação (Cloudflare Pages)

Conecte o repositório privado em Workers & Pages > Create application > Pages > Connect to Git.

| Campo                  | Valor             |
| ---------------------- | ----------------- |
| Build command          | `npm run build`   |
| Build output directory | `dist`            |
| Variável de ambiente   | `NODE_VERSION=22` |

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
src/core       níveis, perfis, detecção, segmentador, normalização, fingerprint, pepitas
src/worker     leitor em streaming, orquestração da análise e Worker
src/shared     protocolo UI↔Worker
fixtures       gerador de logs sintéticos
scripts        gerador, benchmark, contraste, verificação do build
tests/unit     testes (Vitest e fast-check)
docs/adr       registro de decisões
public         _headers, robots.txt, favicon
```
