import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SocialGraphEngine } from '../src/engines/social-graph.engine.js';
import { buildActors } from './factories/actor.factory.js';
import { buildSocialConfig } from './factories/social-config.factory.js';
import { createSocialApiMock } from './mocks/social-deps.mock.js';

function setup(options: Parameters<typeof createSocialApiMock>[0] = {}, count = 60, config = buildSocialConfig()) {
  const api = createSocialApiMock(options);
  const engine = new SocialGraphEngine(api, { getAllActors: () => buildActors(count) }, config);
  const planned = engine.prepare();
  return { api, engine, planned };
}

describe('SocialGraphEngine', () => {
  it('construit un plan et expose les follows de chaque acteur', () => {
    const { engine, planned } = setup();
    assert.ok(planned > 0);
    assert.equal(engine.getPlannedEdgeCount(), planned);
    const follows = engine.followsOf('actor-0');
    assert.ok(follows.size >= 5);
    assert.equal(follows.has('actor-0'), false);
  });

  it('renvoie un ensemble vide pour un acteur inconnu', () => {
    const { engine } = setup();
    assert.equal(engine.followsOf('inconnu').size, 0);
  });

  it('ecrit tout le plan quand les sentinelles manquent', async () => {
    const { api, engine, planned } = setup({ isFollowing: false });
    const result = await engine.sync();
    assert.equal(result.skipped, false);
    assert.equal(result.created, planned);
    assert.equal(api.followUser.mock.callCount(), planned);
  });

  it('ne reecrit rien quand les trois sentinelles existent deja', async () => {
    const { api, engine } = setup({ isFollowing: true });
    const result = await engine.sync();
    assert.equal(result.skipped, true);
    assert.equal(api.followUser.mock.callCount(), 0);
    assert.ok(api.isFollowing.mock.callCount() <= 3);
  });

  it('rejoue tout le plan avec forceSync meme si les sentinelles existent', async () => {
    const { api, engine, planned } = setup({ isFollowing: true }, 60, buildSocialConfig({ forceSync: true }));
    const result = await engine.sync();
    assert.equal(result.skipped, false);
    assert.equal(api.followUser.mock.callCount(), planned);
  });

  it('compte les liens deja presents (409) sans les traiter comme des echecs', async () => {
    const { engine, planned } = setup({ existing: true });
    const result = await engine.sync();
    assert.equal(result.existing, planned);
    assert.equal(result.failed, 0);
    assert.equal(result.created, 0);
  });

  it('ne depasse jamais la concurrence demandee', async () => {
    const api = createSocialApiMock();
    let inFlight = 0;
    let peak = 0;
    api.followUser.mock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return 'created';
    });
    const engine = new SocialGraphEngine(api, { getAllActors: () => buildActors(40) }, buildSocialConfig({ concurrency: 4 }));
    engine.prepare();
    await engine.sync();
    assert.ok(peak <= 4, `peak=${peak}`);
    assert.ok(peak >= 2);
  });

  it('s arrete proprement sur stop()', async () => {
    const { api, engine } = setup();
    api.followUser.mock.mockImplementation(async () => {
      engine.stop();
      return 'created';
    });
    const result = await engine.sync();
    assert.ok(result.created <= 10);
  });

  it('retourne un resultat vide sans acteur', async () => {
    const { engine } = setup({}, 0);
    const result = await engine.sync();
    assert.equal(result.skipped, true);
  });
});
