// Segmentador de eventos multilinha (SDD 8.3, RF-12).
// Recebe linhas já decodificadas, com o deslocamento em bytes de cada uma, e emite eventos.

import { isGeneralContinuation } from './profiles.ts';
import type { ParsedLine, Profile } from './types.ts';

export interface SegmenterLimits {
  maxEventBytes: number;
  maxEventLines: number;
}

export const DEFAULT_LIMITS: SegmenterLimits = {
  maxEventBytes: 64 * 1024,
  maxEventLines: 2000,
};

export interface EventRecord {
  /** Deslocamento em bytes da primeira linha do evento. */
  offset: number;
  /** Deslocamento logo após a última linha do evento. */
  endOffset: number;
  parsed: ParsedLine;
  /** Linhas de continuação guardadas (até os limites). */
  lines: string[];
  /** Total de linhas do evento, incluindo a primeira. */
  lineCount: number;
  truncated: boolean;
}

export interface SegmenterStats {
  lines: number;
  blankLines: number;
  /** Linhas antes do primeiro evento válido (SDD 8.3: evento sintético de cabeçalho). */
  headerLines: number;
  /** Linhas que não casam e não são continuação. */
  unparsed: number;
  unparsedSamples: number[];
  events: number;
  truncatedEvents: number;
  /** Eventos com tempo menor que o do evento anterior (SDD 8.5). */
  outOfOrder: number;
}

const MAX_UNPARSED_SAMPLES = 5;

export class Segmenter {
  readonly stats: SegmenterStats = {
    lines: 0,
    blankLines: 0,
    headerLines: 0,
    unparsed: 0,
    unparsedSamples: [],
    events: 0,
    truncatedEvents: 0,
    outOfOrder: 0,
  };

  private current: EventRecord | null = null;
  private currentBytes = 0;
  private lastTime: number | null = null;

  private readonly profile: Profile;
  private readonly onEvent: (event: EventRecord) => void;
  private readonly limits: SegmenterLimits;

  constructor(
    profile: Profile,
    onEvent: (event: EventRecord) => void,
    limits: SegmenterLimits = DEFAULT_LIMITS,
  ) {
    this.profile = profile;
    this.onEvent = onEvent;
    this.limits = limits;
  }

  /** `byteLength` inclui a quebra de linha; `offset` é o início da linha no arquivo. */
  push(text: string, offset: number, byteLength: number): void {
    const stats = this.stats;
    stats.lines += 1;
    const end = offset + byteLength;

    if (text.length === 0) {
      stats.blankLines += 1;
      if (this.current) this.current.endOffset = end;
      return;
    }

    const parsed = this.profile.parse(text);
    if (parsed) {
      this.flush();
      this.current = { offset, endOffset: end, parsed, lines: [], lineCount: 1, truncated: false };
      this.currentBytes = byteLength;
      if (parsed.timeMs !== null) {
        if (this.lastTime !== null && parsed.timeMs < this.lastTime) stats.outOfOrder += 1;
        this.lastTime = parsed.timeMs;
      }
      return;
    }

    const event = this.current;
    if (!event) {
      stats.headerLines += 1;
      return;
    }

    if (this.profile.continuesAnyLine || isGeneralContinuation(text)) {
      event.lineCount += 1;
      event.endOffset = end;
      this.currentBytes += byteLength;
      if (
        event.lineCount > this.limits.maxEventLines ||
        this.currentBytes > this.limits.maxEventBytes
      ) {
        event.truncated = true;
      } else {
        event.lines.push(text);
      }
      return;
    }

    stats.unparsed += 1;
    if (stats.unparsedSamples.length < MAX_UNPARSED_SAMPLES) stats.unparsedSamples.push(offset);
  }

  finish(): void {
    this.flush();
  }

  private flush(): void {
    const event = this.current;
    if (!event) return;
    this.current = null;
    this.stats.events += 1;
    if (event.truncated) this.stats.truncatedEvents += 1;
    this.onEvent(event);
  }
}
