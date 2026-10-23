// Busca de texto literal em bytes (RF-25). Procura direto nos bytes UTF-8 lidos do arquivo, sem
// decodificar: a posição do acerto já é o deslocamento no arquivo. Maiúsculas e minúsculas só
// são ignoradas para letras ASCII (A-Z); acentos precisam coincidir.

const encoder = new TextEncoder();

function fold(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

export class TextScanner {
  private readonly needle: Uint8Array;
  private readonly caseSensitive: boolean;

  constructor(text: string, caseSensitive: boolean) {
    const bytes = encoder.encode(text.replace(/[\r\n]/g, ' '));
    this.caseSensitive = caseSensitive;
    this.needle = caseSensitive ? bytes : bytes.map(fold);
    if (this.needle.length === 0) throw new RangeError('Texto de busca vazio.');
  }

  /** Chama `onHit` com o deslocamento de cada acerto (sem sobreposição dentro de um acerto). */
  scan(bytes: Uint8Array, startOffset: number, onHit: (offset: number) => void): void {
    const needle = this.needle;
    const length = needle.length;
    const first = needle[0] ?? 0;
    const last = bytes.length - length;
    const sensitive = this.caseSensitive;

    for (let i = 0; i <= last; i += 1) {
      const head = bytes[i] ?? 0;
      if ((sensitive ? head : fold(head)) !== first) continue;
      let j = 1;
      for (; j < length; j += 1) {
        const value = bytes[i + j] ?? 0;
        if ((sensitive ? value : fold(value)) !== needle[j]) break;
      }
      if (j === length) onHit(startOffset + i);
    }
  }
}
