import { mock } from 'node:test';
import type { PoolApi } from '../../src/actors/actor-pool.js';
import type { TokenRefresher } from '../../src/auth/token-retry.js';

export interface PoolApiBehavior {
  /** Si faux, refreshSession echoue. */
  refreshWorks: boolean;
  /** Si faux, login echoue apres l'initialisation. */
  loginWorks: boolean;
}

export function createPoolApiMock(initial: Partial<PoolApiBehavior> = {}) {
  const behavior: PoolApiBehavior = { refreshWorks: true, loginWorks: true, ...initial };
  const captured: { refresher?: TokenRefresher } = {};
  let counter = 0;
  const nextToken = (prefix: string) => `${prefix}-${++counter}`;

  const api = {
    login: mock.fn(async (credentials: { email: string; password: string }) => {
      if (!behavior.loginWorks) return {};
      return {
        user: { id: `id-${credentials.email}`, pseudo: 'x' },
        accessToken: nextToken('login'),
        refreshToken: nextToken('rt-login'),
      };
    }),
    signUp: mock.fn(async () => ({})),
    updateMe: mock.fn(async () => true),
    refreshSession: mock.fn(async () =>
      behavior.refreshWorks
        ? { accessToken: nextToken('refreshed'), refreshToken: nextToken('rt-refreshed') }
        : {},
    ),
    setTokenRefresher: (refresher: TokenRefresher) => {
      captured.refresher = refresher;
    },
  } satisfies PoolApi;

  return { api, behavior, captured };
}
