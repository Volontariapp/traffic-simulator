import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createSender, type FetchLike } from '../src/load/load-http.js';
import type { LoadTarget } from '../src/load/load-request.js';

const TARGET: LoadTarget = { route: 'me', path: '/users/me' };

function bearerOf(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string>).Authorization;
}

describe('createSender', () => {
  it('envoie le jeton et les en-tetes de repere, et lit le corps', async () => {
    const fetchFn = mock.fn<FetchLike>(async () => new Response('{}', { status: 200 }));
    const send = createSender({ baseUrl: 'http://gw.test/api/v1', timeoutMs: 1000, fetchFn });

    const result = await send(TARGET, 'tok');

    assert.equal(result.status, 200);
    assert.equal(result.timedOut, false);
    const [url, init] = fetchFn.mock.calls[0].arguments;
    assert.equal(url, 'http://gw.test/api/v1/users/me');
    assert.equal(bearerOf(init), 'Bearer tok');
    assert.equal((init.headers as Record<string, string>)['X-Load-Test'], '1');
  });

  it('ajoute les en-tetes supplementaires a chaque tentative, y compris apres un 401', async () => {
    let call = 0;
    const fetchFn = mock.fn<FetchLike>(async () =>
      call++ === 0 ? new Response('', { status: 401 }) : new Response('{}', { status: 200 }),
    );
    const send = createSender({
      baseUrl: 'http://gw.test',
      timeoutMs: 1000,
      fetchFn,
      extraHeaders: { 'CF-Access-Client-Id': 'id-1' },
      refresher: async () => 'fresh',
    });

    await send(TARGET, 'stale');

    for (const callRecord of fetchFn.mock.calls) {
      assert.equal((callRecord.arguments[1].headers as Record<string, string>)['CF-Access-Client-Id'], 'id-1');
    }
  });

  it('rejoue une fois avec le nouveau jeton apres un 401', async () => {
    let call = 0;
    const fetchFn = mock.fn<FetchLike>(async () =>
      call++ === 0 ? new Response('', { status: 401 }) : new Response('{}', { status: 200 }),
    );
    const refresher = mock.fn(async () => 'fresh');
    const send = createSender({ baseUrl: 'http://gw.test', timeoutMs: 1000, fetchFn, refresher });

    const result = await send(TARGET, 'stale');

    assert.equal(result.status, 200);
    assert.equal(refresher.mock.callCount(), 1);
    assert.equal(bearerOf(fetchFn.mock.calls[1].arguments[1]), 'Bearer fresh');
  });

  it('retourne status 0 et timedOut sur un delai depasse', async () => {
    const fetchFn: FetchLike = async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    };
    const send = createSender({ baseUrl: 'http://gw.test', timeoutMs: 1000, fetchFn });
    const result = await send(TARGET, 'tok');
    assert.deepEqual({ status: result.status, timedOut: result.timedOut }, { status: 0, timedOut: true });
  });

  it('retourne status 0 sans timedOut sur une erreur reseau', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    const send = createSender({ baseUrl: 'http://gw.test', timeoutMs: 1000, fetchFn });
    const result = await send(TARGET, 'tok');
    assert.deepEqual({ status: result.status, timedOut: result.timedOut }, { status: 0, timedOut: false });
  });

  it('mesure la latence avec l horloge injectee', async () => {
    let t = 100;
    const fetchFn: FetchLike = async () => {
      t += 42;
      return new Response('{}', { status: 200 });
    };
    const send = createSender({ baseUrl: 'http://gw.test', timeoutMs: 1000, fetchFn, now: () => t });
    assert.equal((await send(TARGET, 'tok')).ms, 42);
  });
});
