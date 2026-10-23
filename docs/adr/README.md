# Registro de decisões arquiteturais (ADRs)

Fonte: SDD, seção 16.1, e seção 19 (decisões de 22 de outubro de 2026). Cada decisão que mudar deve virar um arquivo `NNNN-titulo.md` neste diretório.

| ID     | Decisão                                                                    | Status   |
| ------ | -------------------------------------------------------------------------- | -------- |
| ADR-01 | CSP com `connect-src 'none'` como garantia de sigilo                       | Aceito   |
| ADR-02 | Sem backend na v1                                                          | Aceito   |
| ADR-03 | Guardar offsets e reler sob demanda, em vez de manter as linhas na memória | Aceito   |
| ADR-04 | Preact e gráficos próprios                                                 | Aceito   |
| ADR-05 | Impressão digital da jazida por blocos com Web Crypto                      | Proposto |
| ADR-06 | A chave da pepita é o gabarito exato, não um hash                          | Aceito   |
| ADR-07 | Código privado; só a aplicação compilada é publicada                       | Decidido |
| ADR-08 | Um Worker na v1                                                            | Aceito   |
| ADR-09 | Agrupamento por regras, não por IA                                         | Aceito   |
| ADR-10 | Sem telemetria no cliente                                                  | Aceito   |

## Ajustes surgidos na implementação do M0

1. **Trusted Types**: com `require-trusted-types-for 'script'`, `new Worker(url)` exige um `TrustedScriptURL`. O cliente cria a política `garimpo-worker` (só aceita URLs da mesma origem) e a CSP em `public/_headers` inclui `trusted-types garimpo-worker`. O SDD (SEG-01) deve receber essa diretiva.
2. **Cor do ouro no tema claro**: `#A86F00` dava 3,65:1 sobre o fundo (abaixo de 4,5:1 para texto). Trocada por `#8F5C00` (4,87:1). O contraste agora é verificado por `npm run check:contrast` e por teste.
3. **Estilo dinâmico**: a barra de progresso usa `element.style` via objeto do Preact (CSSOM), que a CSP `style-src 'self'` permite. Atributos `style` em HTML estático não são permitidos; `npm run check:dist` verifica isso.

## Ajustes surgidos na implementação do M1

1. **Chave da pepita com pilha** (SDD 7.1 x 7.3): quando há stack trace reconhecido, a chave é a assinatura (exceção + 3 primeiros frames + causa) e ignora a mensagem; a mensagem normalizada do primeiro evento fica em `headTemplate`. Sem pilha, a chave é o gabarito da mensagem.
2. **JWT antes do hexadecimal**: na etapa 8 o JWT (`eyJ...`) é reconhecido antes das sequências hex, senão o hex consumiria partes do token. Mesmo marcador `<TOKEN>`.
3. **Hexadecimais**: além de 8 ou mais dígitos com ao menos uma letra a-f, sequências de 6 e 7 que misturam letras a-f e dígitos também viram `<HEX>` (hashes curtos). Sequências de 6 a 7 só com letras a-f **não** são normalizadas, para não afetar palavras como "decade"; isso deixa algumas pepitas a mais em logs que tenham ids curtos só com letras.
4. **Tokens longos** (etapa 9) precisam de ao menos uma letra e um dígito, para não tratar nomes longos de classe como token.
5. **Limite de entrada**: o fingerprint usa no máximo 4.096 caracteres da mensagem, o que limita o custo de qualquer regex (defesa contra ReDoS).
6. **URL**: mantém o host, troca segmentos numéricos e hexadecimais por `:id` e descarta a query string. Caminhos soltos (`/api/x/123`) recebem o mesmo tratamento.
7. **Perfil iso-level**: qualquer linha que não inicia evento é continuação do evento anterior (convenção do log4j e do logback). Nos demais perfis valem só as regras gerais da seção 8.3.
8. **Detecção**: linhas de continuação óbvias (indentadas, `at`, `...`, `Caused by:`) não entram no denominador da pontuação de nenhum perfil.
9. **Severidade dominante** = a mais grave entre as ocorrências da pepita.
10. **Excesso de pepitas**: acima de 100.000 pepitas distintas, as novas são reunidas em uma pepita de excesso e o resumo avisa.
11. **Sem parâmetros de propriedade no construtor** (`constructor(private x)`): o Node 22 em modo de remoção de tipos não os aceita, e os scripts rodam `.ts` direto no Node.

## Ajustes surgidos na implementação do M2 (parte 1)

1. **Sessão no Worker**: depois da análise, o Worker guarda o índice de eventos (offsets, tempos, pepita e ranking) numa `Session` e responde `query`, `histogram`, `occurrences` e `context`. O arquivo nunca é copiado para a interface: as linhas mostradas vêm do `Blob` original, por fatias, sob demanda (ADR-03).
2. **Cancelamento por tipo**: só vale o pedido mais recente de cada tipo de consulta; os anteriores respondem `cancelled` e a interface os ignora. Uma busca de outro texto abandona a varredura em andamento; consultas iguais simultâneas dividem o mesmo trabalho.
3. **Eixo do Perfil**: tempo quando o log tem horário; caso contrário, a ordem dos eventos. Os baldes têm tamanho "redondo" (até 240) e a geometria não muda ao filtrar, para o gráfico não "pular". O histograma ignora o intervalo escolhido (o intervalo é desenhado sobre ele).
4. **Intervalo semiaberto**: `from` inclusivo e `to` exclusivo, em milissegundos (ou índice do evento, no eixo de ordem).
5. **Busca de texto** literal em bytes, com dobra de maiúsculas só para ASCII; acha também linhas de continuação (stack trace). Regex segura fica para a parte 2.
6. **Contagem por pepita** ignora a pepita escolhida, para mostrar o que cada uma teria sob o filtro.
7. **Sedimento** = todas as linhas que passam no filtro, na ordem do arquivo, sem restringir à pepita; **Ocorrências** = as da pepita escolhida.
8. **Estilo dinâmico** na lista virtual (altura e deslocamento) também usa `element.style` via objeto, permitido pela CSP.
9. **Verificação**: a interface foi exercitada num Chromium real com a CSP de produção (arquivos de 0,6 MB e 40 MB): sem violações além da sonda do selo; com 40 MB, 26 linhas no DOM durante a rolagem.

## Ajustes surgidos na implementação do M2 (parte 2)

1. **Regex isolada**: a busca por regex roda num Worker próprio (`regex-worker.ts`), criado pelo Worker de análise com a mesma política Trusted Types. O Worker devolve os deslocamentos das linhas que casam e dá um sinal de vida a cada 256 linhas; se ficar 2 s sem sinal (regex catastrófica), é derrubado (`terminate`) e a consulta responde `GAR-RGX-002`. Varreduras longas mas ativas não estouram o prazo, porque cada sinal o renova.
2. **Validação antes do Worker**: padrão vazio, acima de 500 caracteres ou com erro de sintaxe nem sai da interface (`GAR-RGX-001` só como reserva). Um aviso heurístico aparece para quantificadores aninhados como `(a+)+`; a proteção real é o prazo.
3. **Escopo da regex**: cada linha é testada separadamente (linhas acima de 100.000 caracteres são testadas só até esse tamanho), sem as flags `g` e `y`. Um acerto em qualquer linha marca o evento inteiro, como na busca literal.
4. **Atalhos** seguem o SDD 9.4. Valem só fora de campos de texto e, para `Enter`, fora de botões e listas. A preferência de desligar fica em `localStorage` (opcional, com tratamento de falha). O `e` (exportar laudo) entra no M3.
5. **Estados**: binário = ao menos um byte nulo nos primeiros 64 KB (logs em UTF-16 caem aqui e a mensagem orienta a converter); limite = 2 GB; memória = `RangeError`. Cada um tem texto, ação e foco inicial no título.
6. **Trusted Types compartilhado**: a criação da política saiu para `src/shared/trusted.ts`, usada pela página e pelo Worker de análise (uma política por contexto, em cache).
