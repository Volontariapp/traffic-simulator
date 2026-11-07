import { mock } from 'node:test';
import type { PoolApi } from '../../src/actors/actor-pool.js';
import type { TokenRefresher } from '../../src/auth/token-retry.js';

export interface PoolApiBehavior {
  /** Si faux, refreshSession echoue. */
  refreshWorks: boolean;
  /** Si faux, login echoue apres l'initialisation. */
  loginWorks: boolean;
  /** Si faux, les comptes n'existent pas tant qu'ils n'ont pas ete crees par signUp. */
  accountsExist: boolean;
}

export function createPoolApiMock(initial: Partial<PoolApiBehavior> = {}) {
  const behavior: PoolApiBehavior = {
    refreshWorks: true,
    loginWorks: true,
    accountsExist: true,
    ...initial,
  };
  const captured: { refresher?: TokenRefresher } = {};
  /** Etat serveur simule : email -> pseudo courant. */
  const serverPseudo = new Map<string, string>();
  const registered = new Set<string>();
  const tokenEmail = new Map<string, string>();
  let counter = 0;
  const nextToken = (prefix: string) => `${prefix}-${++counter}`;

  const issue = (email: string, prefix: string) => {
    const accessToken = nextToken(prefix);
    tokenEmail.set(accessToken, email);
    return { accessToken, refreshToken: nextToken(`rt-${prefix}`) };
  };

  const api = {
    login: mock.fn(async (credentials: { email: string; password: string }) => {
      if (!behavior.loginWorks) return {};
      if (!behavior.accountsExist && !registered.has(credentials.email)) return {};
      return { user: { id: `id-${credentials.email}` }, ...issue(credentials.email, 'login') };
    }),
    signUp: mock.fn(async (data: { email: string; pseudo: string; password: string; bio?: string }) => {
      registered.add(data.email);
      serverPseudo.set(data.email, data.pseudo);
      return { user: { id: `id-${data.email}` }, ...issue(data.email, 'signup') };
    }),
    updateMe: mock.fn(async (token: string, patch: { pseudo?: string; bio?: string }) => {
      const email = tokenEmail.get(token);
      if (email && patch.pseudo) serverPseudo.set(email, patch.pseudo);
      return true;
    }),
    getMyPseudo: mock.fn(async (token: string) => {
      const email = tokenEmail.get(token);
      return email ? serverPseudo.get(email) : undefined;
    }),
    refreshSession: mock.fn(async () =>
      behavior.refreshWorks
        ? { accessToken: nextToken('refreshed'), refreshToken: nextToken('rt-refreshed') }
        : {},
    ),
    setTokenRefresher: (refresher: TokenRefresher) => {
      captured.refresher = refresher;
    },
  } satisfies PoolApi;

  return { api, behavior, captured, serverPseudo, registered };
}
