// Gerador determinístico de logs SINTÉTICOS (SDD 13.5).
// Mesma semente e mesmas opções produzem exatamente o mesmo texto.
// Todos os dados pessoais são fictícios e reconhecíveis como tal:
// e-mails em example.test, IPs nas faixas de documentação (RFC 5737), cartão de teste público,
// tokens com aparência de JWT mas sem validade. Nunca usar logs reais.

export type Profile = 'iso-level' | 'jsonl' | 'http-combined' | 'lvl-dash';

export const PROFILES: readonly Profile[] = ['iso-level', 'jsonl', 'http-combined', 'lvl-dash'];

export interface GenerateOptions {
  profile: Profile;
  seed: number;
  /** Para a geração ao atingir este número de bytes UTF-8 (a última linha pode ultrapassar). */
  targetBytes?: number;
  /** Para a geração ao atingir este número de eventos. */
  maxEvents?: number;
}

export function createRng(seed: number): () => number {
  // mulberry32
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

const NAMES = ['ana', 'bruno', 'carla', 'diego', 'elisa', 'fabio', 'gabi', 'hugo', 'iara', 'joao'];
const THREADS = ['worker-1', 'worker-2', 'worker-3', 'http-nio-8080-exec-4', 'scheduler-1'];
const LOGGERS = [
  'app.pedidos.PedidoService',
  'app.db.Pool',
  'app.auth.Sessao',
  'app.fila.Consumidor',
];
const IP_PREFIXES = ['192.0.2.', '198.51.100.', '203.0.113.'];
const PATHS = ['/api/pedidos', '/api/clientes', '/api/estoque', '/api/relatorios', '/login'];
const FRAMES = [
  'app.db.Pool.acquire(Pool.java:142)',
  'app.pedidos.PedidoService.salvar(PedidoService.java:88)',
  'app.web.PedidoController.criar(PedidoController.java:57)',
  'java.base/java.lang.Thread.run(Thread.java:1583)',
  'app.fila.Consumidor.processar(Consumidor.java:203)',
];

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface Event {
  level: Level;
  message: string;
  stack: string[];
  thread: string;
  logger: string;
  timeMs: number;
  status: number;
  method: string;
  path: string;
  ip: string;
  bytes: number;
  requestId: string;
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}

function hex(rng: () => number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += Math.floor(rng() * 16).toString(16);
  return out;
}

function uuid(rng: () => number): string {
  return `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-a${hex(rng, 3)}-${hex(rng, 12)}`;
}

function int(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new RangeError('lista vazia');
  return item;
}

function fakeToken(rng: () => number): string {
  return `eyJhbGciOiJub25lIn0.${hex(rng, 24)}.${hex(rng, 16)}`;
}

function makeEvent(rng: () => number, timeMs: number): Event {
  const roll = rng();
  const level: Level =
    roll < 0.12 ? 'DEBUG' : roll < 0.72 ? 'INFO' : roll < 0.86 ? 'WARN' : 'ERROR';
  const ip = `${pick(rng, IP_PREFIXES)}${int(rng, 1, 254)}`;
  const email = `${pick(rng, NAMES)}.${int(rng, 1, 400)}@example.test`;
  const path = `${pick(rng, PATHS)}/${int(rng, 1, 99999)}`;
  const id = uuid(rng);
  let message: string;
  let stack: string[] = [];
  let status = 200;

  if (level === 'ERROR') {
    const kind = int(rng, 0, 3);
    if (kind === 0) {
      message = `Falha ao conectar ao banco ${ip}:${pick(rng, [5432, 5433])} após ${int(rng, 100, 9000)} ms`;
      stack = [
        'java.sql.SQLTimeoutException: connection timed out',
        ...FRAMES.slice(0, 3).map((f) => `\tat ${f}`),
      ];
    } else if (kind === 1) {
      message = `Timeout na requisição ${id} para ${path}`;
    } else if (kind === 2) {
      message = `Pagamento recusado para ${email}, cartão 4111111111111111`;
    } else {
      message = `Erro inesperado ao processar o pedido ${int(rng, 1, 999999)}`;
      stack = [
        'java.lang.NullPointerException: valor ausente',
        ...FRAMES.slice(1, 5).map((f) => `\tat ${f}`),
      ];
    }
    status = pick(rng, [500, 502, 503, 504]);
  } else if (level === 'WARN') {
    const kind = int(rng, 0, 2);
    message =
      kind === 0
        ? `Resposta lenta de ${ip}: ${int(rng, 800, 6000)} ms`
        : kind === 1
          ? `Tentativa de login inválida para ${email}`
          : `Fila com ${int(rng, 100, 9000)} itens pendentes`;
    status = pick(rng, [400, 401, 404, 429]);
  } else if (level === 'INFO') {
    const kind = int(rng, 0, 3);
    message =
      kind === 0
        ? `Usuário ${email} autenticado com sucesso (token ${fakeToken(rng)})`
        : kind === 1
          ? `Pedido ${int(rng, 1, 999999)} criado em ${int(rng, 5, 400)} ms`
          : kind === 2
            ? `Requisição ${id} concluída`
            : `Sessão renovada para ${ip}`;
  } else {
    message = `Cache ${hex(rng, 6)} consultado em ${int(rng, 1, 30)} ms`;
  }

  return {
    level,
    message,
    stack,
    thread: pick(rng, THREADS),
    logger: pick(rng, LOGGERS),
    timeMs,
    status,
    method: pick(rng, ['GET', 'GET', 'GET', 'POST', 'PUT']),
    path,
    ip,
    bytes: int(rng, 120, 90000),
    requestId: id,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clfTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCDate(), 2)}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)} +0000`;
}

function lvlDashTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)} ${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}:${pad(d.getUTCMilliseconds(), 3)}`;
}

function formatEvent(profile: Profile, e: Event): string[] {
  if (profile === 'lvl-dash') {
    const [number, label] =
      e.level === 'ERROR'
        ? ['01', 'error']
        : e.level === 'WARN'
          ? ['02', 'warning']
          : ['10', '------------'];
    return [
      `Lvl: ${number} - ${label.padEnd(12)} - ${lvlDashTime(e.timeMs)} - T${1000 + (e.bytes % 9000)} - User ${e.logger.padEnd(24)} - ${e.message}`,
    ];
  }
  if (profile === 'iso-level') {
    const head = `${new Date(e.timeMs).toISOString()} ${e.level} [${e.thread}] ${e.logger} - ${e.message}`;
    return [head, ...e.stack];
  }
  if (profile === 'jsonl') {
    const record: Record<string, unknown> = {
      time: new Date(e.timeMs).toISOString(),
      level: e.level.toLowerCase(),
      msg: e.message,
      request_id: e.requestId,
    };
    if (e.stack.length > 0) record['stack'] = e.stack.join('\n');
    return [JSON.stringify(record)];
  }
  return [
    `${e.ip} - - [${clfTime(e.timeMs)}] "${e.method} ${e.path} HTTP/1.1" ${e.status} ${e.bytes}`,
  ];
}

/** Gera as linhas (sem o \n final de cada uma). Eventos multilinha produzem várias linhas. */
export function* generateLines(options: GenerateOptions): Generator<string> {
  if (options.targetBytes === undefined && options.maxEvents === undefined) {
    throw new RangeError('Informe targetBytes ou maxEvents.');
  }
  const rng = createRng(options.seed);
  let timeMs = Date.UTC(2026, 9, 1, 0, 0, 0);
  let bytes = 0;
  let events = 0;

  while (true) {
    if (options.maxEvents !== undefined && events >= options.maxEvents) return;
    if (options.targetBytes !== undefined && bytes >= options.targetBytes) return;

    timeMs += int(rng, 0, 1500);
    const event = makeEvent(rng, timeMs);
    for (const line of formatEvent(options.profile, event)) {
      bytes += utf8Length(line) + 1;
      yield line;
    }
    events += 1;
  }
}
