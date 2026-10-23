import { describe, expect, it } from 'vitest';
import { MAX_INPUT_CHARS, normalizeMessage } from '../../src/core/normalize.ts';

const padrao = (text: string): string => normalizeMessage(text, 'padrao').template;

describe('normalização (@RF-20)', () => {
  it('CPF e CNPJ formatados não deixam grupos de dígitos no gabarito', () => {
    const cpf = normalizeMessage('cliente cpf 529.982.247-25 falhou', 'padrao').template;
    expect(cpf).toBe('cliente cpf <DOC> falhou');
    const cnpj = normalizeMessage('empresa 11.222.333/0001-81 bloqueada', 'padrao').template;
    expect(cnpj).toBe('empresa <DOC> bloqueada');
  });

  it('etapas 1 e 2: remove ANSI e normaliza espaços', () => {
    expect(padrao('\u001b[31mfalha\u001b[0m    grave \t aqui')).toBe('falha grave aqui');
  });

  it('etapa 3: timestamps embutidos', () => {
    expect(padrao('em 2026-10-22T14:03:11.482Z e 2026-10-22 14:03:11')).toBe('em <TS> e <TS>');
    expect(padrao('às 14:03:11 do dia 22/Oct/2026:14:03:11 +0000')).toBe('às <TS> do dia <TS>');
    expect(padrao('epoch 1761141791 e 1761141791123')).toBe('epoch <TS> e <TS>');
    expect(padrao('iniciou 2026-09-27 14:35:32:382 ok')).toBe('iniciou <TS> ok');
  });

  it('etapas 4 a 6: UUID, e-mail e IP', () => {
    expect(padrao('req 3f2a9c1e-7b4d-4e2a-9c1d-0a1b2c3d4e5f')).toBe('req <UUID>');
    expect(padrao('de ana.1@example.test para bob@example.test')).toBe('de <EMAIL> para <EMAIL>');
    expect(padrao('de 192.0.2.10:5432 e [2001:db8::1]:80 e 2001:db8:0:0:0:0:0:1')).toBe(
      'de <IP> e <IP> e <IP>',
    );
  });

  it('etapa 7: URL mantém o host e troca segmentos numéricos e hexadecimais por :id', () => {
    expect(padrao('GET https://api.exemplo.test/v1/pedidos/12345/itens/9f8e7d6c5b?x=1.')).toBe(
      'GET <URL>api.exemplo.test/v1/pedidos/:id/itens/:id.',
    );
    expect(padrao('rota /api/clientes/77/pedidos')).toBe('rota /api/clientes/:id/pedidos');
    expect(padrao('proporção 3/4 e a/b')).toBe('proporção <N>/<N> e a/b');
  });

  it('etapa 8: hexadecimais longos e JWT', () => {
    expect(padrao('hash deadbeef01 e 0x7ffd1234')).toBe('hash <HEX> e <HEX>');
    expect(padrao('commit a1b2c3d')).toBe('commit <HEX>');
    expect(padrao('token eyJhbGciOiJub25lIn0.0a1b2c3d4e5f.9f8e7d6c')).toBe('token <TOKEN>');
    expect(padrao('palavra decade e 12345678')).toBe('palavra decade e <N>');
  });

  it('etapa 9: tokens longos precisam de letra e dígito', () => {
    expect(padrao('chave Zm9vYmFyMTIzNDU2Nzg5MGFiY2Q')).toBe('chave <TOKEN>');
    expect(padrao('classe NullPointerExceptionHandler')).toBe('classe NullPointerExceptionHandler');
  });

  it('etapa 10: números e decimais, mantendo a unidade', () => {
    expect(padrao('após 5000 ms, 12,5 MB, 300ms e 7%')).toBe('após <N> ms, <N> MB, <N>ms e <N>%');
    expect(padrao('worker3 e v2 não mudam')).toBe('worker3 e v2 não mudam');
  });

  it('etapa 11 só no modo agressivo', () => {
    const texto = 'usuário "ana silva" e \'bob\'';
    expect(normalizeMessage(texto, 'padrao').template).toBe(texto);
    expect(normalizeMessage(texto, 'agressivo').template).toBe('usuário <STR> e <STR>');
  });

  it('modo conservador só vai até a etapa 6', () => {
    const texto = 'pedido 123 de ana@example.test em 192.0.2.1 hash deadbeef01';
    expect(normalizeMessage(texto, 'conservador').template).toBe(
      'pedido 123 de <EMAIL> em <IP> hash deadbeef01',
    );
  });

  it('registra o que foi substituído, para explicar o agrupamento (@RF-21)', () => {
    const { captures } = normalizeMessage('falha em 192.0.2.7 após 300 ms', 'padrao');
    expect(captures).toEqual([
      { marker: '<IP>', value: '192.0.2.7' },
      { marker: '<N>', value: '300' },
    ]);
  });

  it('é determinístico e limita a entrada (defesa contra ReDoS)', () => {
    const longo = `${'a1'.repeat(40_000)}@${'-'.repeat(5000)}`;
    const t0 = performance.now();
    const a = normalizeMessage(longo, 'agressivo');
    const b = normalizeMessage(longo, 'agressivo');
    expect(a).toEqual(b);
    expect(a.template.length).toBeLessThanOrEqual(MAX_INPUT_CHARS * 4);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('entradas patológicas conhecidas terminam rápido', () => {
    const casos = [
      'a'.repeat(5000),
      '1'.repeat(5000),
      '/'.repeat(5000),
      `/${'a/'.repeat(2000)}`,
      ':'.repeat(5000),
      `${'0123456789abcdef'.repeat(300)}!`,
      `${'a.'.repeat(2000)}@`,
      '['.repeat(2000),
      '"'.repeat(5000),
    ];
    for (const caso of casos) {
      const t0 = performance.now();
      normalizeMessage(caso, 'agressivo');
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });
});
