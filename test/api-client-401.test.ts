import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ApiClient } from '../src/clients/api-client.js';

function authOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('ApiClient sur 401', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('renouvelle la session et rejoue la requete avec le nouveau token', async () => {
    const seen: Array<string | undefined> = [];
    mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(authOf(init));
      return authOf(init) === 'Bearer new' ? new Response('{}', { status: 200 }) : new Response('expired', { status: 401 });
    });

    const client = new ApiClient('http://gw');
    const refresher = mock.fn(async () => 'new');
    client.setTokenRefresher(refresher);

    assert.equal(await client.likePost('old', 'post-1'), true);
    assert.deepEqual(seen, ['Bearer old', 'Bearer new']);
    assert.equal(refresher.mock.callCount(), 1);
  });

  it('echoue proprement quand le renouvellement est impossible', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('expired', { status: 401 }));
    const client = new ApiClient('http://gw');
    client.setTokenRefresher(async () => undefined);
    assert.equal(await client.createComment('old', 'p', 'salut', true), false);
  });

  it('ne declenche pas de renouvellement pour une requete sans token (login)', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('bad credentials', { status: 401 }));
    const client = new ApiClient('http://gw');
    const refresher = mock.fn(async () => 'new');
    client.setTokenRefresher(refresher);
    assert.deepEqual(await client.login({ email: 'a@b.c', password: 'x' }, true), {});
    assert.equal(refresher.mock.callCount(), 0);
  });

  it('refreshSession envoie le refresh token en header Authorization ET dans le body', async () => {
    let captured: RequestInit | undefined;
    mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ auth: { accessToken: 'a2', refreshToken: 'r2' } }), { status: 200 });
    });
    const client = new ApiClient('http://gw');
    const refresher = mock.fn(async () => 'never');
    client.setTokenRefresher(refresher);

    await client.refreshSession('r1');

    assert.equal(authOf(captured), 'Bearer r1');
    assert.deepEqual(JSON.parse(String(captured?.body)), { refreshToken: 'r1' });
    assert.equal(refresher.mock.callCount(), 0);
  });

  it('refreshSession echoue proprement sur un 401 sans relancer de renouvellement', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('invalid', { status: 401 }));
    const client = new ApiClient('http://gw');
    const refresher = mock.fn(async () => 'never');
    client.setTokenRefresher(refresher);
    assert.deepEqual(await client.refreshSession('bad'), {});
    assert.equal(refresher.mock.callCount(), 0);
  });

  it('refreshSession lit la nouvelle paire de tokens', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(JSON.stringify({ auth: { accessToken: 'a2', refreshToken: 'r2' } }), { status: 200 }),
    );
    const client = new ApiClient('http://gw');
    assert.deepEqual(await client.refreshSession('r1'), { accessToken: 'a2', refreshToken: 'r2' });
  });
});
