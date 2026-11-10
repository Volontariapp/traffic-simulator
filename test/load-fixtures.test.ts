import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadEmailForIndex, loadIdentityOptions, reservedLocalPseudos, reservedMainPseudos } from '../src/actors/actor-identity.js';
import { buildActorIdentities } from '../src/actors/actor-identity.js';
import { ActorPool } from '../src/actors/actor-pool.js';
import { LOAD_EVENT_TITLE_PREFIX, LoadFixtures } from '../src/load/fixtures/load-fixtures.js';
import { buildActors } from './factories/actor.factory.js';
import { createFixtureApiMock } from './mocks/fixture-api.mock.js';
import { createPoolApiMock } from './mocks/pool-api.mock.js';

const noSleep = async (): Promise<void> => undefined;

describe('pool load.NNNN', () => {
  it('a ses propres emails, distincts des pools principal et local', () => {
    assert.equal(loadEmailForIndex(0), 'load.0001@simulator.volontariapp.test');
    assert.equal(loadEmailForIndex(199), 'load.0200@simulator.volontariapp.test');
  });

  it('ne reprend aucun pseudo des pools principal et local', () => {
    const taken = new Set([...reservedMainPseudos(), ...reservedLocalPseudos()]);
    const pseudos = buildActorIdentities(200, () => 'VOLUNTEER', loadIdentityOptions()).map((i) => i.pseudo);
    assert.equal(pseudos.filter((p) => taken.has(p)).length, 0);
  });

  it('sans createMissing, un compte absent est ignore et jamais cree', async () => {
    const { api } = createPoolApiMock({ accountsExist: false });
    const pool = new ActorPool(api, 1, loadIdentityOptions(), false);
    await pool.initialize(3);
    assert.equal(pool.getAllActors().length, 0);
    assert.equal(api.signUp.mock.callCount(), 0);
  });
});

describe('LoadFixtures.ensureEvents', () => {
  it('cree les events manquants, attend leur noeud social, puis les reutilise', async () => {
    const { api } = createFixtureApiMock({ nodeDelayPolls: 2 });
    const fixtures = new LoadFixtures(api, buildActors(3));
    const first = await fixtures.ensureEvents({ eventCount: 3, sleep: noSleep, pollMs: 1 });
    assert.equal(first.length, 3);
    assert.equal(api.createEvent.mock.callCount(), 3);
    for (const call of api.createEvent.mock.calls) {
      assert.ok(call.arguments[1].title.startsWith(LOAD_EVENT_TITLE_PREFIX));
      assert.equal(call.arguments[1].coverFileId, undefined);
    }

    const second = await fixtures.ensureEvents({ eventCount: 3, sleep: noSleep });
    assert.deepEqual(second, first);
    assert.equal(api.createEvent.mock.callCount(), 3);
  });

  it('ignore les events du compte qui ne sont pas des fixtures', async () => {
    const { api, seed } = createFixtureApiMock();
    const actors = buildActors(2);
    seed.foreignEvent(actors[0].accessToken, 'mine', 'Un vrai event');
    const ids = await new LoadFixtures(api, actors).ensureEvents({ eventCount: 1, sleep: noSleep });
    assert.equal(ids.length, 1);
    assert.notEqual(ids[0], 'mine');
  });

  it('echoue si le noeud social n arrive pas', async () => {
    const { api } = createFixtureApiMock({ nodeDelayPolls: 1_000 });
    let t = 0;
    const fixtures = new LoadFixtures(api, buildActors(1));
    await assert.rejects(
      fixtures.ensureEvents({ eventCount: 1, sleep: noSleep, now: () => (t += 1000), nodeTimeoutMs: 5000 }),
      /Noeud social/,
    );
  });
});

describe('LoadFixtures.cleanup', () => {
  async function seeded() {
    const mock = createFixtureApiMock();
    const actors = buildActors(3);
    const fixtures = new LoadFixtures(mock.api, actors);
    const [e1, e2] = await fixtures.ensureEvents({ eventCount: 2, sleep: noSleep });
    const [a, b, c] = actors;
    mock.seed.follow(a.accessToken, b.id);
    mock.seed.follow(b.accessToken, c.id);
    mock.seed.follow(c.accessToken, 'real-user');
    mock.seed.wish(a.accessToken, e1);
    mock.seed.wish(b.accessToken, 'real-event');
    mock.seed.join(c.accessToken, e2);
    return { ...mock, actors, fixtures };
  }

  it('dry-run : compte sans rien ecrire', async () => {
    const { api, fixtures } = await seeded();
    const report = await fixtures.cleanup({ dryRun: true, purgeEvents: false });
    assert.deepEqual(report.found, { follows: 2, wishes: 1, participations: 1, events: 0 });
    assert.deepEqual(report.foreign, { follows: 1, wishes: 1, participations: 0, events: 0 });
    assert.equal(api.unfollowUser.mock.callCount() + api.unwishEvent.mock.callCount(), 0);
    assert.equal(api.unparticipateEvent.mock.callCount(), 0);
  });

  it('retire tout ce qui appartient au pool, laisse le reste, et relit a zero', async () => {
    const { api, fixtures } = await seeded();
    const report = await fixtures.cleanup({ dryRun: false, purgeEvents: false });
    assert.deepEqual(report.remaining, { follows: 0, wishes: 0, participations: 0, events: 0 });
    assert.equal(report.failures, 0);
    for (const call of api.unfollowUser.mock.calls) assert.notEqual(call.arguments[1], 'real-user');
    for (const call of api.unwishEvent.mock.calls) assert.notEqual(call.arguments[1], 'real-event');
    assert.equal(api.deleteEvent.mock.callCount(), 0);
  });

  it('se rejoue sans effet et purge les events sur demande', async () => {
    const { api, fixtures } = await seeded();
    await fixtures.cleanup({ dryRun: false, purgeEvents: false });
    const again = await fixtures.cleanup({ dryRun: false, purgeEvents: true });
    assert.deepEqual(again.found, { follows: 0, wishes: 0, participations: 0, events: 2 });
    assert.deepEqual(again.remaining, { follows: 0, wishes: 0, participations: 0, events: 0 });
    assert.equal(api.deleteEvent.mock.callCount(), 2);
  });
});
