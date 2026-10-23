import { describe, expect, it } from 'vitest';
import { fingerprintEvent, shortId } from '../../src/core/fingerprint.ts';
import { extractStack } from '../../src/core/stack.ts';
import type { ParsedLine } from '../../src/core/types.ts';

const evento = (message: string, tag?: string): ParsedLine => ({
  timeMs: 0,
  level: 'ERROR',
  message,
  ...(tag ? { tag } : {}),
});

describe('assinatura de stack trace (@RF-20)', () => {
  const java = [
    'java.sql.SQLTimeoutException: connection timed out',
    '\tat app.db.Pool.acquire(Pool.java:142)',
    '\tat app.pedidos.PedidoService.salvar(PedidoService.java:88)',
    '\tat app.web.PedidoController.criar(PedidoController.java:57)',
    '\tat java.base/java.lang.Thread.run(Thread.java:1583)',
    'Caused by: java.net.SocketTimeoutException: Read timed out',
    '\t... 4 more',
  ];

  it('extrai a exceção, os 3 primeiros frames e a classe da causa', () => {
    expect(extractStack(java)).toEqual({
      exception: 'java.sql.SQLTimeoutException',
      frames: [
        'app.db.Pool.acquire(Pool.java:142)',
        'app.pedidos.PedidoService.salvar(PedidoService.java:88)',
        'app.web.PedidoController.criar(PedidoController.java:57)',
      ],
      cause: 'java.net.SocketTimeoutException',
    });
  });

  it('entende JavaScript e Python', () => {
    const js = extractStack(['TypeError: x is not a function', '    at run (/srv/app.js:10:5)']);
    expect(js?.exception).toBe('TypeError');
    expect(js?.frames).toEqual(['run (/srv/app.js:10:5)']);

    const py = extractStack([
      'Traceback (most recent call last):',
      '  File "/srv/app.py", line 3, in f',
      '    raise ValueError("x")',
      'ValueError: x',
    ]);
    expect(py?.exception).toBe('ValueError');
    expect(py?.frames).toEqual(['File "/srv/app.py", line 3, in f']);
  });

  it('devolve null quando não há pilha', () => {
    expect(extractStack(['  apenas um detalhe', 'outra linha comum'])).toBeNull();
  });
});

describe('fingerprint do evento (@RF-20)', () => {
  const pilha = [
    'java.lang.NullPointerException: valor ausente',
    '\tat app.A.f(A.java:10)',
    '\tat app.B.g(B.java:20)',
  ];

  it('com pilha, mensagens diferentes caem na mesma pepita', () => {
    const a = fingerprintEvent(evento('Erro ao processar o pedido 1'), pilha, 'padrao');
    const b = fingerprintEvent(evento('Falha inesperada no pedido 2'), pilha, 'padrao');
    expect(a.key).toBe(b.key);
    expect(a.hasStack).toBe(true);
  });

  it('o número da linha faz parte da assinatura', () => {
    const outra = pilha.map((l) => l.replace('A.java:10', 'A.java:11'));
    const a = fingerprintEvent(evento('x'), pilha, 'padrao');
    const b = fingerprintEvent(evento('x'), outra, 'padrao');
    expect(a.key).not.toBe(b.key);
  });

  it('sem pilha, a chave é o gabarito da mensagem', () => {
    const a = fingerprintEvent(evento('Pedido 10 criado em 30 ms'), [], 'padrao');
    const b = fingerprintEvent(evento('Pedido 99 criado em 45 ms'), [], 'padrao');
    expect(a.key).toBe('Pedido <N> criado em <N> ms');
    expect(a.key).toBe(b.key);
    expect(a.hasStack).toBe(false);
  });

  it('a marca do perfil (status HTTP) separa grupos', () => {
    const a = fingerprintEvent(evento('GET /x', '500'), [], 'padrao');
    const b = fingerprintEvent(evento('GET /x', '502'), [], 'padrao');
    expect(a.key).not.toBe(b.key);
  });

  it('o identificador curto tem 8 caracteres hexadecimais e é estável', () => {
    expect(shortId('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(shortId('abc')).toBe(shortId('abc'));
    expect(shortId('abc')).not.toBe(shortId('abd'));
  });
});
