import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorPool } from '../src/actors/actor-pool.js';
import { localEmailForIndex } from '../src/actors/actor-identity.js';
import { createPoolApiMock } from './mocks/pool-api.mock.js';

describe('ActorPool pairs', () => {
  async function pools() {
    const main = new ActorPool(createPoolApiMock().api, 1);
    const local = new ActorPool(createPoolApiMock().api, 1, { emailFor: localEmailForIndex, localBios: true });
    await main.initialize(6);
    await local.initialize(6);
    return { main, local };
  }

  it('ne reconnait pas un acteur local sans declaration du pair', async () => {
    const { main, local } = await pools();
    const localId = local.getAllActors()[0].id;
    assert.equal(main.isSimulatedUser(localId), false);
  });

  it('reconnait les acteurs du pair comme simules', async () => {
    const { main, local } = await pools();
    main.addPeer(local);
    const localId = local.getAllActors()[0].id;

    assert.equal(main.isSimulatedUser(localId), true);
    assert.equal(main.isSimulatedUser(main.getAllActors()[0].id), true);
    assert.equal(main.isSimulatedUser('real-user'), false);
    assert.equal(main.getSimulatedUserIds().size, 12);
  });

  it('utilise des emails distincts pour les deux pools', async () => {
    const { main, local } = await pools();
    const emails = new Set([...main.getAllActors(), ...local.getAllActors()].map((a) => a.email));
    assert.equal(emails.size, 12);
  });
});
