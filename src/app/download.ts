// Baixar um arquivo gerado no navegador. Usa um link temporário para um Blob; nada vai à rede.

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned === '' ? 'jazida' : cleaned).slice(0, 60);
}

export function download(fileName: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Dá tempo ao navegador de iniciar o download antes de liberar o endereço.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
