import { fetchWithTokenRetry, type TokenRefresher } from '../auth/token-retry.js';
import type { LoadTarget } from './load-request.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LoadResponse {
  /** 0 : pas de reponse (reseau ou delai). */
  status: number;
  ms: number;
  timedOut: boolean;
}

export type LoadSender = (target: LoadTarget, token: string) => Promise<LoadResponse>;

export interface SenderOptions {
  baseUrl: string;
  timeoutMs: number;
  /** En-tetes ajoutes a chaque requete (jeton Cloudflare Access). */
  extraHeaders?: Readonly<Record<string, string>>;
  refresher?: TokenRefresher;
  fetchFn?: FetchLike;
  now?: () => number;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * Une requete authentifiee, sans journal par requete (a 1 000 req/s, une ligne par erreur noierait
 * tout). Le corps est lu en entier : la latence mesuree inclut le transfert et la connexion est liberee.
 * Un 401 declenche le renouvellement de session partage du pool, puis un seul rejeu.
 */
export function createSender(options: SenderOptions): LoadSender {
  const fetchFn: FetchLike = options.fetchFn ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => performance.now());

  return async (target, token) => {
    const url = `${options.baseUrl}${target.path}`;
    const hasBody = target.body !== undefined;
    const body = hasBody ? JSON.stringify(target.body) : undefined;
    const startedAt = now();
    try {
      const { response } = await fetchWithTokenRetry(
        (bearer) =>
          fetchFn(url, {
            method: target.method ?? 'GET',
            headers: {
              ...options.extraHeaders,
              Authorization: `Bearer ${bearer}`,
              'X-Load-Test': '1',
              'User-Agent': 'volontariapp-load-ramp',
              ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(hasBody ? { body } : {}),
            signal: AbortSignal.timeout(options.timeoutMs),
          }),
        token,
        options.refresher,
      );
      await response.arrayBuffer();
      return { status: response.status, ms: now() - startedAt, timedOut: false };
    } catch (error: unknown) {
      return { status: 0, ms: now() - startedAt, timedOut: isTimeout(error) };
    }
  };
}
