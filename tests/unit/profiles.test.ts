import { describe, expect, it } from 'vitest';
import { normalizeLevel } from '../../src/core/levels.ts';
import {
  httpCombinedProfile,
  isGeneralContinuation,
  isoLevelProfile,
  jsonlProfile,
  parseClfTime,
  parseIsoTime,
} from '../../src/core/profiles.ts';

describe('níveis e sinônimos (@RF-13)', () => {
  it('normaliza sinônimos sem diferenciar maiúsculas', () => {
    expect(normalizeLevel('CRITICAL')).toBe('FATAL');
    expect(normalizeLevel('Err')).toBe('ERROR');
    expect(normalizeLevel('warning')).toBe('WARN');
    expect(normalizeLevel('NOTICE')).toBe('INFO');
    expect(normalizeLevel('Trace')).toBe('DEBUG');
    expect(normalizeLevel('banana')).toBeNull();
  });
});

describe('tempo', () => {
  it('lê ISO 8601 com fração, vírgula, espaço e fusos; sem fuso assume UTC (@RF-15)', () => {
    const base = Date.UTC(2026, 9, 22, 14, 3, 11, 482);
    expect(parseIsoTime('2026-10-22T14:03:11.482Z')).toBe(base);
    expect(parseIsoTime('2026-10-22 14:03:11,482')).toBe(base);
    expect(parseIsoTime('2026-10-22T14:03:11.482123456Z')).toBe(base);
    expect(parseIsoTime('2026-10-22T11:03:11.482-0300')).toBe(base);
    expect(parseIsoTime('2026-10-22T17:03:11.482+03:00')).toBe(base);
    expect(parseIsoTime('ontem')).toBeNull();
    expect(parseIsoTime('2026-13-45T99:99:99Z')).toBeNull();
  });

  it('lê o tempo do Common Log Format com deslocamento', () => {
    expect(parseClfTime('22/Oct/2026:14:03:11 +0000')).toBe(Date.UTC(2026, 9, 22, 14, 3, 11));
    expect(parseClfTime('22/Oct/2026:11:03:11 -0300')).toBe(Date.UTC(2026, 9, 22, 14, 3, 11));
    expect(parseClfTime('22/Xxx/2026:11:03:11 -0300')).toBeNull();
  });
});

describe('perfil iso-level (@RF-13)', () => {
  it('extrai tempo, nível e mensagem, descartando thread e logger', () => {
    const parsed = isoLevelProfile.parse(
      '2026-10-22T14:03:11.482Z ERROR [worker-3] app.Db - falha ao conectar',
    );
    expect(parsed).toEqual({
      timeMs: Date.UTC(2026, 9, 22, 14, 3, 11, 482),
      level: 'ERROR',
      message: 'falha ao conectar',
    });
  });

  it('aceita nível entre colchetes e linha sem thread nem logger', () => {
    const parsed = isoLevelProfile.parse('2026-10-22 14:03:11 [warn] algo estranho');
    expect(parsed?.level).toBe('WARN');
    expect(parsed?.message).toBe('algo estranho');
  });

  it('não reconhece linhas sem tempo ou com nível desconhecido', () => {
    expect(isoLevelProfile.parse('\tat app.Db.run(Db.java:10)')).toBeNull();
    expect(isoLevelProfile.parse('2026-10-22T14:03:11Z BANANA mensagem')).toBeNull();
    expect(isoLevelProfile.parse('')).toBeNull();
  });
});

describe('perfil jsonl (@RF-13)', () => {
  it('lê tempo, nível e mensagem com chaves usuais', () => {
    const parsed = jsonlProfile.parse(
      '{"time":"2026-10-22T14:03:11.482Z","level":"error","msg":"falhou","request_id":"x"}',
    );
    expect(parsed?.level).toBe('ERROR');
    expect(parsed?.message).toBe('falhou');
    expect(parsed?.timeMs).toBe(Date.UTC(2026, 9, 22, 14, 3, 11, 482));
  });

  it('entende tempo numérico em segundos e milissegundos e nível numérico', () => {
    const seconds = jsonlProfile.parse('{"ts":1761141791,"level":50,"message":"a"}');
    const millis = jsonlProfile.parse('{"ts":1761141791000,"level":30,"message":"a"}');
    expect(seconds?.timeMs).toBe(1761141791000);
    expect(millis?.timeMs).toBe(1761141791000);
    expect(seconds?.level).toBe('ERROR');
    expect(millis?.level).toBe('INFO');
  });

  it('rejeita o que não é objeto JSON', () => {
    expect(jsonlProfile.parse('texto solto')).toBeNull();
    expect(jsonlProfile.parse('{quebrado')).toBeNull();
    expect(jsonlProfile.parse('[1,2,3]')).toBeNull();
    expect(jsonlProfile.parse('42')).toBeNull();
  });

  it('aceita campos ausentes sem inventar valores', () => {
    const parsed = jsonlProfile.parse('{"outro":1}');
    expect(parsed).toEqual({ timeMs: null, level: null, message: '' });
  });
});

describe('perfil http-combined (@RF-13)', () => {
  it('deriva a severidade do status: 5xx ERROR, 4xx WARN, demais INFO', () => {
    const line = (status: number) =>
      `127.0.0.1 - - [22/Oct/2026:14:03:11 +0000] "GET /x HTTP/1.1" ${status} 123`;
    expect(httpCombinedProfile.parse(line(500))?.level).toBe('ERROR');
    expect(httpCombinedProfile.parse(line(404))?.level).toBe('WARN');
    expect(httpCombinedProfile.parse(line(200))?.level).toBe('INFO');
    expect(httpCombinedProfile.parse(line(302))?.level).toBe('INFO');
  });

  it('extrai método, caminho, status e tempo', () => {
    const parsed = httpCombinedProfile.parse(
      '203.0.113.9 - bob [22/Oct/2026:14:03:11 +0000] "POST /api/x?y=1 HTTP/1.1" 502 -',
    );
    expect(parsed?.message).toBe('POST /api/x?y=1');
    expect(parsed?.tag).toBe('502');
    expect(parsed?.timeMs).toBe(Date.UTC(2026, 9, 22, 14, 3, 11));
  });

  it('não reconhece linhas de outro formato', () => {
    expect(httpCombinedProfile.parse('2026-10-22T14:03:11Z INFO ok')).toBeNull();
  });
});

describe('continuação geral (@RF-12)', () => {
  it('segue as regras da seção 8.3', () => {
    expect(isGeneralContinuation('  recuo')).toBe(true);
    expect(isGeneralContinuation('\trecuo')).toBe(true);
    expect(isGeneralContinuation('at app.X.run(X.java:1)')).toBe(true);
    expect(isGeneralContinuation('... 12 more')).toBe(true);
    expect(isGeneralContinuation('Caused by: java.io.IOException')).toBe(true);
    expect(isGeneralContinuation('texto comum')).toBe(false);
  });
});
