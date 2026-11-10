import { percentile } from '../latency-stats.js';

/** Messages WebSocket que ws-service renvoie a l'emetteur d'un like ou d'un commentaire. */
export const PROBE_EVENTS = ['post.liked', 'post.comment.created'] as const;
export type ProbeEvent = (typeof PROBE_EVENTS)[number];

export interface ProbeSocket {
  on(event: string, handler: (payload: unknown) => void): void;
  close(): void;
}

export type ProbeSocketFactory = (token: string) => ProbeSocket;

export interface AsyncWindow {
  /** Effets recus (message WebSocket arrive pour une ecriture attendue). */
  received: number;
  /** Ecritures dont l'effet n'est pas arrive dans `lostAfterMs`. */
  lost: number;
  lostRate: number;
  p50: number;
  p95: number;
  max: number;
}

export interface AsyncProbeOptions {
  /** Comptes sondes (les premiers du pool load) et leur jeton. */
  accounts: readonly { userId: string; token: string }[];
  factory: ProbeSocketFactory;
  /** Delai au-dela duquel un effet attendu compte comme perdu. */
  lostAfterMs?: number;
  now?: () => number;
}

interface Pending {
  key: string;
  sentAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Sonde de bout en bout des effets asynchrones : une ecriture acceptee (HTTP 2xx) doit produire
 * son message WebSocket (outbox, Redis Stream, post-processor de ws-service, envoi). Le delai
 * mesure toute la chaine, vue du client, sans acces au cluster. Seul le message adresse a
 * l'emetteur (`isEmitter: true`) compte : la diffusion aux autres comptes est ignoree.
 */
export class AsyncProbe {
  private readonly sockets: ProbeSocket[] = [];
  private readonly probed: Set<string>;
  private readonly pending = new Map<string, Pending[]>();
  private lags: number[] = [];
  private lost = 0;
  private readonly lostAfterMs: number;
  private readonly now: () => number;

  constructor(private readonly options: AsyncProbeOptions) {
    this.probed = new Set(options.accounts.map((a) => a.userId));
    this.lostAfterMs = options.lostAfterMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  get socketCount(): number {
    return this.sockets.length;
  }

  start(): void {
    for (const account of this.options.accounts) {
      const socket = this.options.factory(account.token);
      for (const event of PROBE_EVENTS) {
        socket.on(event, (payload) => this.onMessage(account.userId, event, payload));
      }
      this.sockets.push(socket);
    }
  }

  /** Vrai si les effets des ecritures de ce compte sont mesures. */
  watches(userId: string): boolean {
    return this.probed.has(userId);
  }

  /** Ecriture acceptee par la gateway : son message est attendu. */
  expect(userId: string, event: ProbeEvent, postId: string): void {
    if (!this.watches(userId)) return;
    const key = `${userId}:${event}:${postId}`;
    const list = this.pending.get(key) ?? [];
    list.push({ key, sentAt: this.now() });
    this.pending.set(key, list);
  }

  private onMessage(userId: string, event: ProbeEvent, payload: unknown): void {
    if (!isRecord(payload) || payload.isEmitter !== true || typeof payload.postId !== 'string') return;
    const key = `${userId}:${event}:${payload.postId}`;
    const list = this.pending.get(key);
    const first = list?.shift();
    if (!first) return;
    if (list && list.length === 0) this.pending.delete(key);
    this.lags.push(this.now() - first.sentAt);
  }

  /** Effets de la fenetre ecoulee ; les attentes trop anciennes passent en perdues. */
  takeWindow(): AsyncWindow {
    const now = this.now();
    for (const [key, list] of this.pending) {
      const alive = list.filter((p) => now - p.sentAt < this.lostAfterMs);
      this.lost += list.length - alive.length;
      if (alive.length === 0) this.pending.delete(key);
      else this.pending.set(key, alive);
    }
    const sorted = [...this.lags].sort((a, b) => a - b);
    const received = sorted.length;
    const lost = this.lost;
    this.lags = [];
    this.lost = 0;
    const total = received + lost;
    return {
      received,
      lost,
      lostRate: total === 0 ? 0 : lost / total,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1] ?? 0,
    };
  }

  /** Attentes encore ouvertes (a lire apres la fin de la rampe). */
  openCount(): number {
    let count = 0;
    for (const list of this.pending.values()) count += list.length;
    return count;
  }

  close(): void {
    for (const socket of this.sockets) socket.close();
    this.sockets.length = 0;
  }
}
