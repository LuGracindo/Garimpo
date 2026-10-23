import { describe, expect, it } from 'vitest';
import { getProfile } from '../../src/core/profiles.ts';
import { Segmenter, type EventRecord } from '../../src/core/segmenter.ts';
import type { ProfileId } from '../../src/core/types.ts';

function run(
  profile: ProfileId,
  text: string,
  limits?: { maxEventBytes: number; maxEventLines: number },
) {
  const events: EventRecord[] = [];
  const segmenter = new Segmenter(getProfile(profile), (event) => events.push(event), limits);
  const encoder = new TextEncoder();
  let offset = 0;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    const bytes = encoder.encode(line).length + 1;
    segmenter.push(line, offset, bytes);
    offset += bytes;
  }
  segmenter.finish();
  return { events, stats: segmenter.stats, bytes: offset };
}

describe('segmentador de eventos multilinha (@RF-12)', () => {
  const log = [
    'cabeçalho solto',
    '2026-10-22T14:00:00Z INFO [t] a.B - inicio',
    '2026-10-22T14:00:01Z ERROR [t] a.B - falha',
    'java.lang.IllegalStateException: x',
    '\tat a.B.run(B.java:10)',
    '\tat a.B.main(B.java:3)',
    '',
    '2026-10-22T14:00:02Z INFO [t] a.B - fim',
  ].join('\n');

  it('anexa a continuação ao evento anterior e conta o cabeçalho à parte', () => {
    const { events, stats } = run('iso-level', log);
    expect(events).toHaveLength(3);
    expect(stats.headerLines).toBe(1);
    expect(events[1]?.lines).toHaveLength(3);
    expect(events[1]?.lineCount).toBe(4);
    expect(stats.blankLines).toBe(1);
    expect(stats.unparsed).toBe(0);
    expect(stats.lines).toBe(8);
  });

  it('os deslocamentos cobrem o arquivo sem buracos nem sobreposição', () => {
    const { events, bytes } = run('iso-level', log);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]?.offset).toBe(events[i - 1]?.endOffset);
    }
    expect(events[events.length - 1]?.endOffset).toBe(bytes);
  });

  it('no jsonl, linha que não casa e não é continuação é "não interpretada"', () => {
    const text = ['{"level":"info","msg":"a"}', 'lixo no meio', '{"level":"info","msg":"b"}'].join(
      '\n',
    );
    const { events, stats } = run('jsonl', text);
    expect(events).toHaveLength(2);
    expect(stats.unparsed).toBe(1);
    expect(stats.unparsedSamples).toEqual([27]);
  });

  it('trunca eventos acima dos limites e marca', () => {
    const body = Array.from({ length: 50 }, (_, i) => `\tat a.B.m${i}(B.java:${i})`);
    const text = ['2026-10-22T14:00:00Z ERROR x', ...body].join('\n');
    const { events, stats } = run('iso-level', text, { maxEventBytes: 10_000, maxEventLines: 10 });
    expect(events[0]?.truncated).toBe(true);
    expect(events[0]?.lines).toHaveLength(9);
    expect(events[0]?.lineCount).toBe(51);
    expect(stats.truncatedEvents).toBe(1);
  });

  it('conta eventos fora de ordem no tempo (@RF-14)', () => {
    const text = [
      '2026-10-22T14:00:05Z INFO a',
      '2026-10-22T14:00:01Z INFO b',
      '2026-10-22T14:00:09Z INFO c',
    ].join('\n');
    expect(run('iso-level', text).stats.outOfOrder).toBe(1);
  });
});
