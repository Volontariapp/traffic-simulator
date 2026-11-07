import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { createRng } from '../src/actors/actor-identity.js';
import { UserReactionEngine } from '../src/engines/user-reaction.engine.js';
import { buildActors } from './factories/actor.factory.js';
import { buildReactionConfig } from './factories/reaction-config.factory.js';
import { createReactionActorsMock, createReactionApiMock, type FakePost } from './mocks/reaction-deps.mock.js';

const realPost = (id: string): FakePost => ({
  id,
  title: 'Nettoyage du canal',
  content: 'x',
  authorId: 'real-user',
});

describe('UserReactionEngine (posts)', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  function setup(initial: FakePost[] = []) {
    const { api, state } = createReactionApiMock(initial);
    const actors = createReactionActorsMock(buildActors(300));
    const engine = new UserReactionEngine(api, actors, buildReactionConfig(), createRng(3));
    return { api, state, engine };
  }

  it('memorise les posts existants au premier scan sans reagir', async () => {
    const { api, engine } = setup([realPost('old-1'), realPost('old-2')]);
    await engine.tick();
    mock.timers.tick(60_000);
    await engine.tick();
    assert.equal(engine.getMonitoredPostCount(), 0);
    assert.equal(api.likePost.mock.callCount(), 0);
  });

  it('reagit vite a un nouveau post d un vrai utilisateur', async () => {
    const { api, state, engine } = setup();
    await engine.tick(); // premier scan : liste vide
    state.posts = [realPost('new-1')];

    mock.timers.tick(4_000);
    await engine.tick(); // detection
    assert.equal(engine.getMonitoredPostCount(), 1);

    mock.timers.tick(20_000);
    await engine.tick();
    await engine.tick();

    assert.ok(api.likePost.mock.callCount() >= 4, `likes=${api.likePost.mock.callCount()}`);
    assert.ok(api.createComment.mock.callCount() >= 1);
  });

  it('termine par le total prevu puis oublie le post', async () => {
    const { api, state, engine } = setup();
    await engine.tick();
    state.posts = [realPost('new-1')];
    mock.timers.tick(4_000);
    await engine.tick();

    for (let i = 0; i < 200; i++) {
      mock.timers.tick(1_000);
      await engine.tick();
    }

    assert.equal(engine.getMonitoredPostCount(), 0);
    assert.ok(api.likePost.mock.callCount() >= 12 && api.likePost.mock.callCount() <= 25);
    assert.ok(api.createComment.mock.callCount() >= 4 && api.createComment.mock.callCount() <= 8);
  });

  it('ignore les posts des acteurs du simulateur', async () => {
    const { api, state, engine } = setup();
    await engine.tick();
    state.posts = [{ ...realPost('sim-post'), authorId: 'actor-1' }];
    mock.timers.tick(4_000);
    await engine.tick();
    mock.timers.tick(30_000);
    await engine.tick();
    assert.equal(engine.getMonitoredPostCount(), 0);
    assert.equal(api.likePost.mock.callCount(), 0);
  });

  it('ignore un post deja trop ancien a la detection', async () => {
    const { state, engine } = setup();
    await engine.tick();
    state.posts = [{ ...realPost('stale'), createdAt: new Date(1_000_000 - 3_600_000).toISOString() }];
    mock.timers.tick(4_000);
    await engine.tick();
    assert.equal(engine.getMonitoredPostCount(), 0);
  });

  it('reset oublie l etat et re-memorise sans reagir', async () => {
    const { api, state, engine } = setup();
    await engine.tick();
    state.posts = [realPost('p1')];
    mock.timers.tick(4_000);
    await engine.tick();
    assert.equal(engine.getMonitoredPostCount(), 1);

    engine.reset();
    assert.equal(engine.getMonitoredPostCount(), 0);
    mock.timers.tick(4_000);
    await engine.tick();
    mock.timers.tick(60_000);
    await engine.tick();
    assert.equal(engine.getMonitoredPostCount(), 0);
    assert.equal(api.likePost.mock.callCount(), 0);
  });
});
