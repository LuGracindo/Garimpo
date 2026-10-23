# Registro de decisões arquiteturais (ADRs)

Fonte: SDD, seção 16.1, e seção 19 (decisões de 22 de outubro de 2026). Cada decisão que mudar deve virar um arquivo `NNNN-titulo.md` neste diretório.

| ID | Decisão | Status |
|---|---|---|
| ADR-01 | CSP com `connect-src 'none'` como garantia de sigilo | Aceito |
| ADR-02 | Sem backend na v1 | Aceito |
| ADR-03 | Guardar offsets e reler sob demanda, em vez de manter as linhas na memória | Aceito |
| ADR-04 | Preact e gráficos próprios | Aceito |
| ADR-05 | Impressão digital da jazida por blocos com Web Crypto | Proposto |
| ADR-06 | A chave da pepita é o gabarito exato, não um hash | Aceito |
| ADR-07 | Código privado; só a aplicação compilada é publicada | Decidido |
| ADR-08 | Um Worker na v1 | Aceito |
| ADR-09 | Agrupamento por regras, não por IA | Aceito |
| ADR-10 | Sem telemetria no cliente | Aceito |

## Ajustes surgidos na implementação do M0

1. **Trusted Types**: com `require-trusted-types-for 'script'`, `new Worker(url)` exige um `TrustedScriptURL`. O cliente cria a política `garimpo-worker` (só aceita URLs da mesma origem) e a CSP em `public/_headers` inclui `trusted-types garimpo-worker`. O SDD (SEG-01) deve receber essa diretiva.
2. **Cor do ouro no tema claro**: `#A86F00` dava 3,65:1 sobre o fundo (abaixo de 4,5:1 para texto). Trocada por `#8F5C00` (4,87:1). O contraste agora é verificado por `npm run check:contrast` e por teste.
3. **Estilo dinâmico**: a barra de progresso usa `element.style` via objeto do Preact (CSSOM), que a CSP `style-src 'self'` permite. Atributos `style` em HTML estático não são permitidos; `npm run check:dist` verifica isso.
