import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { fetchWithTokenRetry } from '../src/auth/token-retry.js';

const respond = (status: number) => new Response(status === 204 ? null : 'body', { status });

describe('fetchWithTokenRetry', () => {
  it('ne touche pas au token sur une reponse non 401', async () => {
    const doFetch = mock.fn(async () => respond(200));
    const refresher = mock.fn(async () => 'new');
    const result = await fetchWithTokenRetry(doFetch, 'old', refresher);
    assert.equal(result.response.status, 200);
    assert.equal(result.token, 'old');
    assert.equal(refresher.mock.callCount(), 0);
    assert.equal(doFetch.mock.callCount(), 1);
  });

  it('rejoue une fois avec le nouveau token apres un 401', async () => {
    const doFetch = mock.fn(async (token: string) => respond(token === 'new' ? 200 : 401));
    const refresher = mock.fn(async () => 'new');
    const result = await fetchWithTokenRetry(doFetch, 'old', refresher);
    assert.equal(result.response.status, 200);
    assert.equal(result.token, 'new');
    assert.equal(doFetch.mock.callCount(), 2);
    assert.deepEqual(doFetch.mock.calls.map((c) => c.arguments[0]), ['old', 'new']);
  });

  it('ne boucle pas : un second 401 est retourne tel quel', async () => {
    const doFetch = mock.fn(async () => respond(401));
    const refresher = mock.fn(async () => 'new');
    const result = await fetchWithTokenRetry(doFetch, 'old', refresher);
    assert.equal(result.response.status, 401);
    assert.equal(doFetch.mock.callCount(), 2);
    assert.equal(refresher.mock.callCount(), 1);
  });

  it('retourne le 401 si le renouvellement echoue', async () => {
    const doFetch = mock.fn(async () => respond(401));
    const result = await fetchWithTokenRetry(doFetch, 'old', async () => undefined);
    assert.equal(result.response.status, 401);
    assert.equal(result.token, 'old');
    assert.equal(doFetch.mock.callCount(), 1);
  });

  it('retourne le 401 sans refresher', async () => {
    const doFetch = mock.fn(async () => respond(401));
    const result = await fetchWithTokenRetry(doFetch, 'old');
    assert.equal(result.response.status, 401);
    assert.equal(doFetch.mock.callCount(), 1);
  });

  it('ne rejoue pas quand le refresher rend le meme token', async () => {
    const doFetch = mock.fn(async () => respond(401));
    await fetchWithTokenRetry(doFetch, 'same', async () => 'same');
    assert.equal(doFetch.mock.callCount(), 1);
  });
});
