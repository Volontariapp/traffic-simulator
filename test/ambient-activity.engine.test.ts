import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { createRng } from '../src/actors/actor-identity.js';
import { AmbientActivityEngine, type FollowLookup } from '../src/engines/ambient-activity.engine.js';
import type { AmbientConfig } from '../src/config/simulator-config.js';
import { buildActors } from './factories/actor.factory.js';
import { buildAmbientConfig } from './factories/social-config.factory.js';
import { createReactionActorsMock, createReactionApiMock, type FakePost } from './mocks/reaction-deps.mock.js';

const simPost = (id: string, authorId = 'actor-1'): FakePost => ({
  id,
  title: 'Nettoyage du canal',
  content: 'x',
  authorId,
});

describe('AmbientActivityEngine', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  function setup(options: { posts?: FakePost[]; config?: Partial<AmbientConfig>; follows?: FollowLookup; actors?: number } = {}) {
    const { api, state } = createReactionApiMock(options.posts ?? [simPost('p1'), simPost('p2'), simPost('p3')]);
    const actors = createReactionActorsMock(buildActors(options.actors ?? 300));
    const engine = new AmbientActivityEngine(
      api,
      actors,
      buildAmbientConfig(options.config),
      options.follows,
      createRng(7),
    );
    return { api, state, engine };
  }

  async function runSeconds(engine: AmbientActivityEngine, seconds: number): Promise<void> {
    for (let i = 0; i < seconds; i++) {
      mock.timers.tick(1_000);
      await engine.tick();
    }
  }

  it('produit environ le debit demande, en likes et en commentaires', async () => {
    const { api, engine } = setup({ config: { actionsPerSec: 10, commentRatio: 0.2 } });
    await runSeconds(engine, 20);
    const likes = api.likePost.mock.callCount();
    const comments = api.createComment.mock.callCount();
    const total = likes + comments;
    assert.ok(total >= 180 && total <= 200, `total=${total}`);
    assert.ok(comments > 0 && comments < likes, `likes=${likes} comments=${comments}`);
  });

  it('ne like jamais deux fois le meme post avec le meme acteur', async () => {
    const { api, engine } = setup({ actors: 40, config: { actionsPerSec: 50, commentRatio: 0 } });
    await runSeconds(engine, 20);
    const seen = new Set<string>();
    for (const call of api.likePost.mock.calls) {
      const [token, postId] = call.arguments as unknown as [string, string];
      const key = `${token}|${postId}`;
      assert.equal(seen.has(key), false, `doublon ${key}`);
      seen.add(key);
    }
    assert.ok(seen.size > 0);
  });

  it('respecte le plafond de likes par post', async () => {
    const { api, engine } = setup({
      posts: [simPost('p1')],
      config: { actionsPerSec: 100, commentRatio: 0, maxLikesPerPost: 30 },
    });
    await runSeconds(engine, 20);
    assert.equal(api.likePost.mock.callCount(), 30);
  });

  it('respecte le plafond de commentaires par post et n en repete pas le texte', async () => {
    const { api, engine } = setup({
      posts: [simPost('p1')],
      config: { actionsPerSec: 100, commentRatio: 1, maxCommentsPerPost: 12 },
    });
    await runSeconds(engine, 20);
    const texts = api.createComment.mock.calls.map((c) => (c.arguments as unknown as [string, string, string])[2]);
    assert.equal(texts.length, 12);
    assert.equal(new Set(texts).size, 12);
  });

  it('ignore les posts de vrais utilisateurs', async () => {
    const { api, engine } = setup({ posts: [simPost('real', 'real-user')] });
    await runSeconds(engine, 10);
    assert.equal(api.likePost.mock.callCount(), 0);
    assert.equal(api.createComment.mock.callCount(), 0);
    assert.equal(engine.getTrackedPostCount(), 0);
  });

  it('favorise les posts des comptes suivis', async () => {
    const follows: FollowLookup = () => new Set(['actor-1']);
    const { api, engine } = setup({
      posts: [simPost('followed', 'actor-1'), simPost('other', 'actor-2')],
      follows,
      actors: 1500,
      config: { actionsPerSec: 100, commentRatio: 0, maxLikesPerPost: 100000 },
    });
    await runSeconds(engine, 5);
    const byPost = new Map<string, number>();
    for (const call of api.likePost.mock.calls) {
      const postId = (call.arguments as unknown as [string, string])[1];
      byPost.set(postId, (byPost.get(postId) ?? 0) + 1);
    }
    assert.ok((byPost.get('followed') ?? 0) > (byPost.get('other') ?? 0) * 2, JSON.stringify([...byPost]));
  });

  it('declenche une rafale de burstSize actions au rythme prevu, plafonnee en concurrence', async () => {
    const { api, engine } = setup({
      actors: 1500,
      config: { actionsPerSec: 0, burstSize: 1000, burstIntervalMs: 60_000, maxConcurrency: 250, commentRatio: 0, maxLikesPerPost: 100000 },
    });
    let inFlight = 0;
    let peak = 0;
    api.likePost.mock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return true;
    });

    await runSeconds(engine, 30);
    assert.equal(api.likePost.mock.callCount(), 0, 'pas de rafale avant l echeance');

    await runSeconds(engine, 31);
    assert.equal(api.likePost.mock.callCount(), 1000);
    assert.ok(peak <= 250, `peak=${peak}`);
    assert.ok(peak > 100, `peak=${peak}`);
  });

  it('ne fait rien sans debit ni rafale', async () => {
    const { api, engine } = setup({ config: { actionsPerSec: 0, burstSize: 0 } });
    await runSeconds(engine, 30);
    assert.equal(api.likePost.mock.callCount(), 0);
    assert.equal(api.createComment.mock.callCount(), 0);
  });

  it('reset oublie les posts suivis', async () => {
    const { engine } = setup();
    await runSeconds(engine, 2);
    assert.equal(engine.getTrackedPostCount(), 3);
    engine.reset();
    assert.equal(engine.getTrackedPostCount(), 0);
  });

  it('oublie les posts qui ne sont plus dans la page', async () => {
    const { state, engine } = setup({ posts: [simPost('old')] });
    await runSeconds(engine, 2);
    assert.equal(engine.getTrackedPostCount(), 1);
    state.posts = [simPost('new')];
    await runSeconds(engine, 20);
    assert.equal(engine.getTrackedPostCount(), 1);
  });

  it('survit a une erreur de lecture de la liste', async () => {
    const { api, engine } = setup();
    api.listPosts.mock.mockImplementation(async () => {
      throw new Error('gateway indisponible');
    });
    await runSeconds(engine, 3);
    assert.equal(api.likePost.mock.callCount(), 0);
  });
});
