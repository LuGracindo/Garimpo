import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LACRE_DEFAULT_TYPES,
  LACRE_TYPES,
  Lacre,
  findSensitive,
  isValidCard,
  isValidCnpj,
  isValidCpf,
  type LacreType,
} from '../../src/core/lacre.ts';

const padrao = new Set<LacreType>(LACRE_DEFAULT_TYPES);
const todos = new Set<LacreType>(LACRE_TYPES);

function cpfValido(base: string): string {
  const d = base.split('').map(Number);
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += (d[i] ?? 0) * (size + 1 - i);
    d.push(((sum * 10) % 11) % 10);
  }
  return d.join('');
}

function cnpjValido(base: string): string {
  const d = base.split('').map(Number);
  const w = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const size of [12, 13]) {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += (d[i] ?? 0) * (w[w.length - size + i] ?? 0);
    d.push(sum % 11 < 2 ? 0 : 11 - (sum % 11));
  }
  return d.join('');
}

function cartaoValido(prefix: string, tamanho: number): string {
  const d = prefix.split('').map(Number);
  while (d.length < tamanho - 1) d.push((d.length * 7 + 3) % 10);
  for (let check = 0; check < 10; check += 1) {
    const candidate = [...d, check].join('');
    if (isValidCard(candidate)) return candidate;
  }
  throw new Error('sem dígito verificador');
}

describe('Lacre: validadores (@RF-40)', () => {
  it('CPF com dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
  it('CNPJ com dígitos verificadores', () => {
    expect(isValidCnpj('11.444.777/0001-61')).toBe(true);
    expect(isValidCnpj('11444777000161')).toBe(true);
    expect(isValidCnpj('11.444.777/0001-62')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
  });
  it('cartão com Luhn e 13 a 19 dígitos', () => {
    expect(isValidCard('4111 1111 1111 1111')).toBe(true);
    expect(isValidCard('4111 1111 1111 1112')).toBe(false);
    expect(isValidCard('4111')).toBe(false);
  });
});

describe('Lacre: detecção e máscara (@RF-40, @RF-41)', () => {
  const casos: [LacreType, string][] = [
    ['email', 'contato: maria.silva+x@empresa.com.br enviado'],
    ['ipv4', 'origem 192.168.10.25 porta 80'],
    ['ipv6', 'origem 2001:db8::ff00:42:8329 ok'],
    ['ipv6', 'loopback ::1 ok'],
    ['cpf', 'cliente 529.982.247-25 aprovado'],
    ['cpf', 'cliente 52998224725 aprovado'],
    ['cnpj', 'empresa 11.444.777/0001-61 ativa'],
    ['cartao', 'cartao 4111 1111 1111 1111 recusado'],
    ['cartao', 'cartao 4111-1111-1111-1111 recusado'],
    ['jwt', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl fim'],
    ['chave-api', 'chave AKIAIOSFODNN7EXAMPLE usada'],
    ['chave-api', `chave ghp_${'a'.repeat(36)} usada`],
    ['chave-api', `chave sk_live_${'A1b2'.repeat(5)} usada`],
  ];

  for (const [tipo, texto] of casos) {
    it(`acha ${tipo}: ${texto.slice(0, 40)}`, () => {
      const hits = findSensitive(texto, padrao);
      expect(hits.map((h) => h.type)).toEqual([tipo]);
      const masked = new Lacre(padrao).mask(texto);
      expect(masked).toMatch(/<[A-Z0-9]+_1>/);
      expect(masked).not.toContain(hits[0]?.value ?? '??');
    });
  }

  it('não acha o que não é dado sensível', () => {
    const textos = [
      'versao 1.2.3 do modulo',
      'horario 10:15:30 e 2026-10-22',
      'Foo::bar chamou std::string',
      'numero 123456789 e 12345678901',
      'pedido 4111 1111 1111 1112',
      'valor 111.111.111-11',
      'arquivo a@b sem dominio',
    ];
    for (const texto of textos) expect(findSensitive(texto, todos)).toEqual([]);
  });

  it('UUID e telefone só valem quando ligados', () => {
    const texto = 'id 123e4567-e89b-12d3-a456-426614174000 tel (11) 98765-4321';
    expect(findSensitive(texto, padrao)).toEqual([]);
    const tipos = findSensitive(texto, todos).map((h) => h.type);
    expect(tipos).toEqual(['uuid', 'telefone-br']);
  });

  it('marcadores são consistentes: o mesmo valor, o mesmo marcador, numerado por aparição', () => {
    const lacre = new Lacre(padrao);
    const a = lacre.mask('a@x.com e b@x.com e a@x.com');
    expect(a).toBe('<EMAIL_1> e <EMAIL_2> e <EMAIL_1>');
    expect(lacre.mask('de novo b@x.com')).toBe('de novo <EMAIL_2>');
    expect(lacre.replacements.email).toBe(4);
    expect(lacre.totalReplacements()).toBe(4);
    expect(lacre.mapping().map((m) => [m.marker, m.original])).toEqual([
      ['<EMAIL_1>', 'a@x.com'],
      ['<EMAIL_2>', 'b@x.com'],
    ]);
  });

  it('sem tipos ligados, nada muda', () => {
    const lacre = new Lacre([]);
    expect(lacre.active).toBe(false);
    expect(lacre.mask('a@x.com')).toBe('a@x.com');
  });

  it('o e-mail vence o IP e o JWT vence o e-mail quando se sobrepõem', () => {
    const lacre = new Lacre(padrao);
    expect(lacre.mask('u@10.0.0.1.com')).toContain('<EMAIL_1>');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jb20ifQ.assinaturaX';
    expect(new Lacre(padrao).mask(jwt)).toBe('<JWT_1>');
  });

  it('recall: acha todos os CPF, CNPJ e cartões válidos gerados, em vários formatos', () => {
    let achados = 0;
    let total = 0;
    for (let i = 0; i < 300; i += 1) {
      const cpf = cpfValido(
        String(100_000_000 + i * 3_333_337)
          .slice(0, 9)
          .padStart(9, '1'),
      );
      const cnpj = cnpjValido(
        String(10_000_000_000 + i * 99_991)
          .padStart(8, '1')
          .slice(0, 8) + '0001',
      );
      const cartao = cartaoValido('4' + String(i).padStart(3, '0'), 16);
      const formatos = [
        [cpf, 'cpf'],
        [`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`, 'cpf'],
        [cnpj, 'cnpj'],
        [
          `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`,
          'cnpj',
        ],
        [cartao, 'cartao'],
        [cartao.replace(/(\d{4})(?=\d)/g, '$1 '), 'cartao'],
      ] as const;
      for (const [valor, tipo] of formatos) {
        total += 1;
        const hits = findSensitive(`ref ${valor} fim`, padrao);
        if (hits.length === 1 && hits[0]?.type === tipo) achados += 1;
      }
    }
    expect(total).toBe(1800);
    expect(achados / total).toBeGreaterThanOrEqual(0.99);
  });

  it('propriedade: nenhum valor detectado sobrevive no texto mascarado, e mascarar é idempotente', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.emailAddress(), (ruido, email) => {
        const texto = `${ruido} ${email} ${ruido}`;
        const masked = new Lacre(padrao).mask(texto);
        for (const hit of findSensitive(texto, padrao)) {
          expect(masked.includes(hit.value)).toBe(false);
        }
        expect(new Lacre(padrao).mask(masked)).toBe(masked);
      }),
      { numRuns: 100 },
    );
  });

  it('texto enorme é cortado, não explode', () => {
    const grande = `${'a@b.co '.repeat(10_000)}`;
    const masked = new Lacre(padrao).mask(grande);
    // O que passa do limite é descartado, e o que fica é mascarado.
    expect(masked.includes('@')).toBe(false);
  });
});
