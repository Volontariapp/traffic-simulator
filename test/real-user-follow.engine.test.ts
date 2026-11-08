import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { createRng } from '../src/actors/actor-identity.js';
import type { RealUsersConfig } from '../src/config/simulator-config.js';
import { RealUserFollowEngine } from '../src/engines/real-user-follow.engine.js';
import { buildActors } from './factories/actor.factory.js';
import { buildRealUsersConfig } from './factories/social-config.factory.js';
import { createReactionActorsMock } from './mocks/reaction-deps.mock.js';
import { createRealFollowApiMock, type FakeUser } from './mocks/real-follow-deps.mock.js';

const admin = { email: 'admin@volontariapp.test', password: 'secret' };
const realUser = (id: string): FakeUser => ({ id, email: `${id}@gmail.com` });

describe('RealUserFollowEngine', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  function setup(users: FakeUser[] = [], config: Partial<RealUsersConfig> = {}) {
    const { api, state } = createRealFollowApiMock(users);
    const actors = createReactionActorsMock(buildActors(100));
    const engine = new RealUserFollowEngine(api, actors, buildRealUsersConfig(config), admin, createRng(5));
    return { api, state, engine };
  }

  async function advance(engine: RealUserFollowEngine, seconds: number): Promise<void> {
    for (let i = 0; i < seconds; i++) {
      mock.timers.tick(1_000);
      await engine.tick();
    }
  }

  function followsOf(api: ReturnType<typeof setup>['api'], targetId: string) {
    return api.followUser.mock.calls
      .map((c) => c.arguments as unknown as [string, string])
      .filter(([, target]) => target === targetId)
      .map(([token]) => token);
  }

  it('fait suivre les comptes deja presents par 6 a 15 acteurs distincts', async () => {
    const { api, engine } = setup([realUser('alice')]);
    await engine.tick();
    await advance(engine, 11 * 60);
    const followers = followsOf(api, 'alice');
    assert.ok(followers.length >= 6 && followers.length <= 15, `followers=${followers.length}`);
    assert.equal(new Set(followers).size, followers.length);
  });

  it('etale les follows : aucun avant 5 s, tous fournis avant 11 minutes', async () => {
    const { api, engine } = setup([realUser('alice')]);
    await engine.tick();
    assert.ok(engine.getPendingFollowCount() >= 6);
    await advance(engine, 4);
    assert.equal(api.followUser.mock.callCount(), 0);
    await advance(engine, 11 * 60);
    assert.equal(engine.getPendingFollowCount(), 0);
  });

  it('ignore les acteurs du simulateur, les emails du domaine simulateur et le compte admin', async () => {
    const { api, engine } = setup([
      { id: 'actor-3', email: 'actor.3@gmail.com' },
      { id: 'bot-x', email: 'bot@simulator.volontariapp.test' },
      { id: 'admin-id', email: 'ADMIN@volontariapp.test' },
    ]);
    await engine.tick();
    await advance(engine, 11 * 60);
    assert.equal(api.followUser.mock.callCount(), 0);
    assert.equal(engine.getKnownUserCount(), 0);
  });

  it('ne planifie rien pour les comptes existants quand includeExisting est faux, puis suit les nouveaux', async () => {
    const { api, state, engine } = setup([realUser('alice')], { includeExisting: false, scanIntervalMs: 10_000 });
    await engine.tick();
    await advance(engine, 11 * 60);
    assert.equal(api.followUser.mock.callCount(), 0);

    state.users = [realUser('alice'), realUser('bob')];
    await advance(engine, 15);
    await advance(engine, 11 * 60);
    assert.equal(followsOf(api, 'alice').length, 0);
    assert.ok(followsOf(api, 'bob').length >= 6);
  });

  it('ne suit pas deux fois un compte deja traite', async () => {
    const { api, engine } = setup([realUser('alice')], { scanIntervalMs: 10_000 });
    await engine.tick();
    await advance(engine, 11 * 60);
    const first = api.followUser.mock.callCount();
    await advance(engine, 11 * 60);
    assert.equal(api.followUser.mock.callCount(), first);
  });

  it('parcourt toutes les pages de la liste', async () => {
    const users = Array.from({ length: 620 }, (_, i) => realUser(`user-${i}`));
    const { api, engine } = setup(users);
    await engine.tick();
    assert.equal(api.listUsers.mock.callCount(), 2);
    assert.equal(engine.getKnownUserCount(), 620);
  });

  it('survit a un refus de connexion admin et reessaie au scan suivant', async () => {
    const { api, state, engine } = setup([realUser('alice')], { scanIntervalMs: 10_000 });
    state.loginOk = false;
    await engine.tick();
    assert.equal(engine.getKnownUserCount(), 0);

    state.loginOk = true;
    await advance(engine, 11);
    assert.equal(engine.getKnownUserCount(), 1);
    assert.ok(api.login.mock.callCount() >= 2);
  });

  it('ne memorise pas les comptes quand la lecture d une page echoue', async () => {
    const { state, engine } = setup([realUser('alice')], { scanIntervalMs: 10_000 });
    state.listOk = false;
    await engine.tick();
    assert.equal(engine.getKnownUserCount(), 0);
    assert.equal(engine.getPendingFollowCount(), 0);
  });

  it('retente un follow en echec puis abandonne apres 3 essais', async () => {
    const { api, engine } = setup([realUser('alice')], { followersMin: 1, followersMax: 1 });
    api.followUser.mock.mockImplementation(async () => 'failed');
    await engine.tick();
    await advance(engine, 15 * 60);
    assert.equal(api.followUser.mock.callCount(), 3);
    assert.equal(engine.getPendingFollowCount(), 0);
  });

  it('traite 409 comme un succes, sans nouvelle tentative', async () => {
    const { api, engine } = setup([realUser('alice')], { followersMin: 2, followersMax: 2 });
    api.followUser.mock.mockImplementation(async () => 'exists');
    await engine.tick();
    await advance(engine, 15 * 60);
    assert.equal(api.followUser.mock.callCount(), 2);
  });
});
