// Impressão digital da jazida (AUD-02): SHA-256 de cada bloco de 4 MiB e hash raiz sobre a
// concatenação dos hashes de bloco. Lê um bloco por vez, então nunca carrega o arquivo inteiro.

import type { BlobLike } from './reader.ts';

export const FINGERPRINT_METHOD = 'sha256-blocos-4MiB';
export const FINGERPRINT_BLOCK = 4 * 1024 * 1024;

export interface Fingerprint {
  metodo: typeof FINGERPRINT_METHOD;
  tamanhoBloco: number;
  blocos: number;
  bytes: number;
  raiz: string;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  // Copia para um ArrayBuffer próprio: a view pode ser parte de um buffer maior.
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy));
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await sha256Bytes(new TextEncoder().encode(text)));
}

export async function fingerprintBlob(
  blob: BlobLike,
  options: {
    blockSize?: number;
    isCancelled?: () => boolean;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<Fingerprint | null> {
  const blockSize = options.blockSize ?? FINGERPRINT_BLOCK;
  const total = blob.size;
  const hashes: Uint8Array[] = [];
  let offset = 0;
  while (offset < total) {
    if (options.isCancelled?.()) return null;
    const end = Math.min(offset + blockSize, total);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    hashes.push(await sha256Bytes(bytes));
    offset = end;
    options.onProgress?.(offset, total);
  }
  const joined = new Uint8Array(hashes.length * 32);
  hashes.forEach((hash, i) => joined.set(hash, i * 32));
  return {
    metodo: FINGERPRINT_METHOD,
    tamanhoBloco: blockSize,
    blocos: hashes.length,
    bytes: total,
    raiz: toHex(await sha256Bytes(joined)),
  };
}
