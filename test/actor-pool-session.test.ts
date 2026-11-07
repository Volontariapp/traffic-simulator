import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorPool } from '../src/actors/actor-pool.js';
import { createPoolApiMock } from './mocks/pool-api.mock.js';

async function setup(behavior: Parameters<typeof createPoolApiMock>[0] = {}) {
  const mockApi = createPoolApiMock();
  const pool = new ActorPool(mockApi.api, 1);
  await pool.initialize(3);
  mockApi.api.login.mock.resetCalls();
  // Les pannes ne s'appliquent qu'apres l'initialisation du pool
  Object.assign(mockApi.behavior, behavior);
  return { ...mockApi, pool, actor: pool.getAllActors()[0] };
}

describe('ActorPool.renewSession', () => {
  it('s enregistre comme refresher du client', async () => {
    const { captured } = await setup();
    assert.equal(typeof captured.refresher, 'function');
  });

  it('utilise le refresh token en priorite', async () => {
    const { pool, api, actor } = await setup();
    const stale = actor.accessToken;
    const fresh = await pool.renewSession(stale);
    assert.ok(fresh && fresh !== stale);
    assert.equal(actor.accessToken, fresh);
    assert.equal(api.refreshSession.mock.callCount(), 1);
    assert.equal(api.login.mock.callCount(), 0);
  });

  it('bascule sur le re-login quand le refresh echoue', async () => {
    const { pool, api, behavior, actor } = await setup({ refreshWorks: false });
    const stale = actor.accessToken;
    const fresh = await pool.renewSession(stale);
    assert.ok(fresh && fresh.startsWith('login-'));
    assert.equal(actor.accessToken, fresh);
    assert.equal(api.refreshSession.mock.callCount(), 1);
    assert.equal(api.login.mock.callCount(), 1);
    assert.equal(behavior.refreshWorks, false);
  });

  it('re-login direct quand l acteur n a pas de refresh token', async () => {
    const { pool, api, actor } = await setup();
    actor.refreshToken = undefined;
    const fresh = await pool.renewSession(actor.accessToken);
    assert.ok(fresh);
    assert.equal(api.refreshSession.mock.callCount(), 0);
    assert.equal(api.login.mock.callCount(), 1);
  });

  it('renvoie undefined et garde le token si les deux voies echouent', async () => {
    const { pool, api, actor } = await setup({ refreshWorks: false, loginWorks: false });
    const stale = actor.accessToken;
    assert.equal(await pool.renewSession(stale), undefined);
    assert.equal(actor.accessToken, stale);
    assert.equal(api.login.mock.callCount(), 3);
  });

  it('fait un seul renouvellement reseau pour des 401 concurrents du meme acteur', async () => {
    const { pool, api, actor } = await setup();
    const stale = actor.accessToken;
    const results = await Promise.all([
      pool.renewSession(stale),
      pool.renewSession(stale),
      pool.renewSession(stale),
    ]);
    assert.equal(new Set(results).size, 1);
    assert.equal(api.refreshSession.mock.callCount(), 1);
  });

  it('retrouve l acteur avec un ancien token deja remplace, sans appel reseau', async () => {
    const { pool, api, actor } = await setup();
    const stale = actor.accessToken;
    const fresh = await pool.renewSession(stale);
    api.refreshSession.mock.resetCalls();
    assert.equal(await pool.renewSession(stale), fresh);
    assert.equal(api.refreshSession.mock.callCount(), 0);
  });

  it('ignore un token inconnu', async () => {
    const { pool } = await setup();
    assert.equal(await pool.renewSession('inconnu'), undefined);
  });

  it('renouvelle independamment deux acteurs differents', async () => {
    const { pool, api } = await setup();
    const [a, b] = pool.getAllActors();
    await Promise.all([pool.renewSession(a.accessToken), pool.renewSession(b.accessToken)]);
    assert.equal(api.refreshSession.mock.callCount(), 2);
  });
});
