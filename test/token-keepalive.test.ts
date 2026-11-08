import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorPool } from '../src/actors/actor-pool.js';
import { getJwtExpiryMs, isExpiringWithin } from '../src/auth/token-expiry.js';
import { createPoolApiMock } from './mocks/pool-api.mock.js';

/** JWT minimal (non signe) dont seul le claim exp compte pour le renouvellement preventif. */
function fakeJwt(expSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp: expSeconds })}.signature`;
}

const MINUTE = 60_000;

describe('getJwtExpiryMs / isExpiringWithin', () => {
  it('lit le claim exp en millisecondes', () => {
    assert.equal(getJwtExpiryMs(fakeJwt(1_700_000_000)), 1_700_000_000_000);
  });

  it('renvoie undefined pour un token qui n est pas un JWT lisible', () => {
    assert.equal(getJwtExpiryMs('login-1'), undefined);
    assert.equal(getJwtExpiryMs('a.!!!.c'), undefined);
  });

  it('signale un token expirant dans la marge, ou deja expire', () => {
    const now = 1_000_000_000_000;
    assert.equal(isExpiringWithin(fakeJwt(now / 1000 + 4 * 60), 5 * MINUTE, now), true);
    assert.equal(isExpiringWithin(fakeJwt(now / 1000 - 10), 5 * MINUTE, now), true);
    assert.equal(isExpiringWithin(fakeJwt(now / 1000 + 14 * 60), 5 * MINUTE, now), false);
  });

  it('ne signale jamais un token dont l exp est illisible', () => {
    assert.equal(isExpiringWithin('login-1', 5 * MINUTE), false);
  });
});

describe('ActorPool.refreshExpiringSessions', () => {
  it('renouvelle seulement les sessions proches de l expiration', async () => {
    const mockApi = createPoolApiMock();
    const pool = new ActorPool(mockApi.api, 1);
    await pool.initialize(3);
    const [soon, later] = pool.getAllActors();
    const now = Date.now();
    soon.accessToken = fakeJwt(now / 1000 + 2 * 60);
    later.accessToken = fakeJwt(now / 1000 + 12 * 60);
    const laterToken = later.accessToken;

    const renewed = await pool.refreshExpiringSessions(5 * MINUTE, now);

    assert.equal(renewed, 1);
    assert.equal(mockApi.api.refreshSession.mock.callCount(), 1);
    assert.notEqual(soon.accessToken, fakeJwt(now / 1000 + 2 * 60));
    assert.equal(later.accessToken, laterToken);
  });

  it('ne fait aucun appel reseau quand aucune session n expire bientot', async () => {
    const mockApi = createPoolApiMock();
    const pool = new ActorPool(mockApi.api, 1);
    await pool.initialize(2);
    for (const actor of pool.getAllActors()) {
      actor.accessToken = fakeJwt(Date.now() / 1000 + 14 * 60);
    }

    assert.equal(await pool.refreshExpiringSessions(5 * MINUTE), 0);
    assert.equal(mockApi.api.refreshSession.mock.callCount(), 0);
    assert.equal(mockApi.api.login.mock.callCount(), 2);
  });

  it('compte une session comme non renouvelee quand les deux voies echouent', async () => {
    const mockApi = createPoolApiMock();
    const pool = new ActorPool(mockApi.api, 1);
    await pool.initialize(2);
    const [actor] = pool.getAllActors();
    actor.accessToken = fakeJwt(Date.now() / 1000 + 60);
    mockApi.behavior.refreshWorks = false;
    mockApi.behavior.loginWorks = false;

    assert.equal(await pool.refreshExpiringSessions(5 * MINUTE), 0);
  });
});
