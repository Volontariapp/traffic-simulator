import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorPool } from '../src/actors/actor-pool.js';
import { buildActorIdentities } from '../src/actors/actor-identity.js';
import { createPoolApiMock } from './mocks/pool-api.mock.js';

const COUNT = 30;
const organizerCount = Math.max(5, Math.floor(COUNT * 0.25));
const identities = buildActorIdentities(COUNT, (i) => (i < organizerCount ? 'ORGANIZER' : 'VOLUNTEER'));

function seedServer(serverPseudo: Map<string, string>, pseudoOf: (i: number) => string) {
  identities.forEach((identity, i) => serverPseudo.set(identity.email, pseudoOf(i)));
}

describe('ActorPool identites au demarrage', () => {
  it('ne fait aucune ecriture ni lecture par compte quand les sentinelles sont a jour', async () => {
    const { api, serverPseudo } = createPoolApiMock();
    seedServer(serverPseudo, (i) => identities[i].pseudo);

    await new ActorPool(api, 1).initialize(COUNT);

    assert.equal(api.updateMe.mock.callCount(), 0);
    assert.equal(api.getMyPseudo.mock.callCount(), 3);
  });

  it('renomme tous les comptes quand les sentinelles portent l ancienne identite', async () => {
    const { api, serverPseudo } = createPoolApiMock();
    seedServer(serverPseudo, (i) => `sim_user_${i}`);

    await new ActorPool(api, 1).initialize(COUNT);

    assert.equal(api.updateMe.mock.callCount(), COUNT);
    identities.forEach((identity) => assert.equal(serverPseudo.get(identity.email), identity.pseudo));
  });

  it('une seconde initialisation apres un renommage complet n ecrit plus rien', async () => {
    const { api, serverPseudo } = createPoolApiMock();
    seedServer(serverPseudo, (i) => `sim_user_${i}`);
    await new ActorPool(api, 1).initialize(COUNT);

    api.updateMe.mock.resetCalls();
    await new ActorPool(api, 1).initialize(COUNT);
    assert.equal(api.updateMe.mock.callCount(), 0);
  });

  it('ne reecrit que les comptes en ecart en cas de forcage', async () => {
    const { api, serverPseudo } = createPoolApiMock();
    seedServer(serverPseudo, (i) => identities[i].pseudo);
    serverPseudo.set(identities[12].email, 'sim_user_0013');

    await new ActorPool(api, 1).initialize(COUNT, 0, true);

    assert.equal(api.updateMe.mock.callCount(), 1);
    assert.equal(serverPseudo.get(identities[12].email), identities[12].pseudo);
  });

  it('sans forcage, un ecart hors sentinelles n est pas detecte (limite assumee)', async () => {
    const { api, serverPseudo } = createPoolApiMock();
    seedServer(serverPseudo, (i) => identities[i].pseudo);
    serverPseudo.set(identities[12].email, 'sim_user_0013');

    await new ActorPool(api, 1).initialize(COUNT);

    assert.equal(api.updateMe.mock.callCount(), 0);
  });

  it('cree les comptes absents avec leur identite finale, sans renommage', async () => {
    const { api, serverPseudo } = createPoolApiMock({ accountsExist: false });

    await new ActorPool(api, 1).initialize(COUNT);

    assert.equal(api.signUp.mock.callCount(), COUNT);
    assert.equal(api.updateMe.mock.callCount(), 0);
    identities.forEach((identity) => assert.equal(serverPseudo.get(identity.email), identity.pseudo));
  });
});
