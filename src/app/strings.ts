// Textos da interface (SDD 2.3, voz do produto: direta, concreta e calma).
// Mantidos em um só arquivo para facilitar a tradução futura (RF-45).

export const t = {
  produto: 'Garimpo',
  assinatura: 'Peneire o log. Encontre a pepita.',
  seloTestando: 'Testando…',
  seloLacrado: 'Lacrado',
  seloSemLacre: 'Sem lacre',
  seloLacradoAjuda: 'O navegador bloqueou uma tentativa de rede de teste. Nada sai desta aba.',
  seloSemLacreAjuda:
    'A política de segurança não bloqueou a requisição de teste. Isso é esperado em desenvolvimento local; em produção, não deveria acontecer.',
  inicioTitulo: 'Solte um log aqui.',
  inicioSubtitulo: 'Ele não sai desta aba.',
  abrirArquivo: 'Abrir arquivo',
  cancelar: 'Cancelar',
  novaJazida: 'Nova jazida',
  processando: 'Peneirando…',
  cancelado: 'Cancelado. Nada foi guardado.',
  erroInterno: 'Algo falhou aqui dentro. Nada foi enviado a lugar nenhum.',
  pepitasTitulo: 'Pepitas',
  pepitasLimite: (mostradas: number, total: number) =>
    `Mostrando as ${mostradas} de maior prioridade, de ${total} no total.`,
  explicar: 'Ver gabarito e valores',
  gabarito: 'Gabarito',
  primeiraMensagem: 'Primeira mensagem',
  nova: 'nova',
  valoresVariaram: 'Valores que variaram',
  distintos: (n: number, limitado: boolean) => `${limitado ? 'mais de ' : ''}${n} distintos`,
  formatoEscolhido: (perfil: string, fonte: string, confianca: number | null) =>
    fonte === 'auto' && confianca !== null
      ? `Formato ${perfil}, detectado com confiança de ${Math.round(confianca * 100)}%.`
      : `Formato ${perfil}, escolhido por você.`,
  formatoIncerto: 'Não tenho certeza do formato deste arquivo. Qual destes é o certo?',
  formatoNenhum: 'Nenhum dos formatos conhecidos casou com este arquivo.',
  escolher: 'Usar este formato',
  avisoNaoInterpretadas: (n: number) => `${n} linhas não foram interpretadas.`,
  avisoForaDeOrdem: (n: number) => `${n} eventos aparecem fora de ordem no tempo.`,
  avisoTruncados: (n: number) => `${n} eventos passaram do limite de tamanho e foram truncados.`,
  avisoExcesso: 'Muitas pepitas distintas: as menos frequentes foram reunidas em uma só.',
  avisoLimiteAgrupamento:
    'Mensagens totalmente livres agrupam mal com regras fixas. Confira o gabarito antes de confiar na contagem.',
} as const;
