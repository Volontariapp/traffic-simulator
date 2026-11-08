import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createActiveLocationsSource } from '../src/clients/active-locations.source.js';

const credentials = { email: 'sim-admin@simulator.test', password: 'secret', maxAgeMinutes: 30 };

function buildApi(overrides: { loginToken?: string | undefined; cells?: Array<{ lat: number; lng: number }> | undefined } = {}) {
  const loginToken = 'loginToken' in overrides ? overrides.loginToken : 'admin-token';
  return {
    login: mock.fn(async () => (loginToken ? { accessToken: loginToken } : {})),
    getActiveUserLocations: mock.fn(async () => overrides.cells),
  };
}

describe('createActiveLocationsSource', () => {
  it('se connecte en admin puis lit les cellules actives', async () => {
    const api = buildApi({ cells: [{ lat: 48.85, lng: 2.35 }] });

    const cells = await createActiveLocationsSource(api, credentials)();

    assert.deepEqual(cells, [{ lat: 48.85, lng: 2.35 }]);
    assert.deepEqual(api.login.mock.calls[0].arguments.slice(0, 2), [
      { email: credentials.email, password: credentials.password },
      true,
    ]);
    assert.deepEqual(api.getActiveUserLocations.mock.calls[0].arguments, ['admin-token', 30, true]);
  });

  it('leve une erreur claire quand la connexion admin echoue', async () => {
    const api = buildApi({ loginToken: undefined });

    await assert.rejects(createActiveLocationsSource(api, credentials)(), /connexion admin/);
    assert.equal(api.getActiveUserLocations.mock.callCount(), 0);
  });

  it('leve une erreur quand la route est refusee ou indisponible', async () => {
    const api = buildApi({ cells: undefined });

    await assert.rejects(createActiveLocationsSource(api, credentials)(), /positions actives/);
  });

  it('se reconnecte a chaque lecture, sans garder de jeton', async () => {
    const api = buildApi({ cells: [] });
    const source = createActiveLocationsSource(api, credentials);

    await source();
    await source();

    assert.equal(api.login.mock.callCount(), 2);
  });
});
