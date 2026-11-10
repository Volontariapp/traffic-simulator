import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { AppPlanner } from '../src/load/app/app-planner.js';
import { DEFAULT_WRITES, WritePlanner } from '../src/load/app/write-planner.js';
import { defaultAppMix, loadLoadConfig, parseAppMix, parseWrites } from '../src/load/load-config.js';
import type { LoadResponse, LoadSender } from '../src/load/load-http.js';
import { runRamp } from '../src/load/load-runner.js';
import { buildLoadConfig } from './factories/load-config.factory.js';
import { FakeClock } from './mocks/load-deps.mock.js';
import { buildActor, buildActors } from './factories/actor.factory.js';

const OK: LoadResponse = { status: 201, ms: 10, timedOut: false };
const DONE: LoadResponse = { status: 200, ms: 10, timedOut: false };

function planner(now = { t: 0 }) {
  const loadActors = buildActors(4).map((a, i) => buildActor(i, { id: `load-${i}`, accessToken: `load-token-${i}`, email: a.email }));
  const fixtureEvents = ['fx-1', 'fx-2'];
  return { loadActors, fixtureEvents, writes: new WritePlanner({ loadActors, fixtureEvents, nowMs: () => now.t }) };
}

/** rng a sequence fixe, puis 0 */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

describe('LOAD_WRITES', () => {
  it('lectures seules par defaut, option b avec default', () => {
    assert.deepEqual(parseWrites(undefined), []);
    assert.deepEqual(parseWrites('off'), []);
    assert.deepEqual(parseWrites('default'), [...DEFAULT_WRITES]);
    assert.deepEqual(DEFAULT_WRITES, ['wish-toggle', 'participate-toggle', 'follow-toggle', 'pass-feedback']);
  });

  it('refuse position et creation d event, et les noms inconnus', () => {
    assert.throws(() => parseWrites('location'), /exclue/);
    assert.throws(() => parseWrites('event-cycle'), /exclue/);
    assert.throws(() => parseWrites('me'), /n'est pas une ecriture/);
    assert.deepEqual(parseWrites('like-toggle,comment-cycle,like-toggle'), ['like-toggle', 'comment-cycle']);
    assert.deepEqual(parseWrites('default,like-toggle'), [...DEFAULT_WRITES, 'like-toggle']);
  });

  it('ajoute au melange par defaut les ecritures activees avec leur poids du profil', () => {
    const mix = defaultAppMix(DEFAULT_WRITES);
    const writes = mix.filter((m) => DEFAULT_WRITES.some((w) => w === m.route));
    assert.deepEqual(writes, [
      { route: 'wish-toggle', weight: 2 },
      { route: 'pass-feedback', weight: 1.5 },
      { route: 'follow-toggle', weight: 1 },
      { route: 'participate-toggle', weight: 0.8 },
    ]);
  });

  it('LOAD_MIX n admet une ecriture que si elle est activee', () => {
    assert.throws(() => parseAppMix('like-toggle:1', []), /non activee/);
    assert.deepEqual(parseAppMix('like-toggle:1', ['like-toggle']), [{ route: 'like-toggle', weight: 1 }]);
  });

  it('LOAD_WRITES est refuse hors du mode app', () => {
    assert.throws(() => loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_WRITES: 'default' }), /LOAD_MODE=app/);
    const config = loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_MODE: 'app', LOAD_WRITES: 'default' });
    assert.equal(config.writes.length, 4);
    assert.equal(config.poolActors, 200);
  });
});

describe('WritePlanner', () => {
  it('exige des comptes load et des events de fixture', () => {
    assert.throws(() => new WritePlanner({ loadActors: buildActors(1), fixtureEvents: ['e'] }), /insuffisant/);
    assert.throws(() => new WritePlanner({ loadActors: buildActors(2), fixtureEvents: [] }), /load:setup/);
  });

  it('bascule un souhait : POST puis DELETE, avec le jeton du compte load', () => {
    const { writes } = planner();
    const first = writes.build('wish-toggle', seq(0, 0));
    assert.deepEqual([first.method, first.path, first.token], ['POST', '/social/events/fx-1/wish', 'load-token-0']);
    writes.observe(first, OK);
    const second = writes.build('wish-toggle', seq(0, 0));
    assert.equal(second.method, 'DELETE');
    writes.observe(second, DONE);
    assert.equal(writes.build('wish-toggle', seq(0, 0)).method, 'POST');
  });

  it('se recale sur un 409 et un 404', () => {
    const { writes } = planner();
    const add = writes.build('follow-toggle', seq(0, 0.3));
    assert.equal(add.path, '/social/follow/load-1');
    writes.observe(add, { status: 409, ms: 1, timedOut: false });
    const remove = writes.build('follow-toggle', seq(0, 0.3));
    assert.equal(remove.method, 'DELETE');
    writes.observe(remove, { status: 404, ms: 1, timedOut: false });
    assert.equal(writes.build('follow-toggle', seq(0, 0.3)).method, 'POST');
  });

  it('ne suit jamais soi-meme et ne vise que des comptes load', () => {
    const { writes, loadActors } = planner();
    const ids = new Set(loadActors.map((a) => a.id));
    for (let i = 0; i < 50; i++) {
      const target = writes.build('follow-toggle', Math.random);
      if (target.route !== 'follow-toggle') continue;
      const followed = target.path.split('/').pop() ?? '';
      assert.ok(ids.has(followed));
      assert.notEqual(target.token, `load-token-${followed.replace('load-', '')}`);
    }
  });

  it('ne lance pas deux ecritures en vol sur la meme paire', () => {
    const { writes } = planner();
    const first = writes.build('wish-toggle', seq(0, 0));
    // meme paire tiree : un autre couple est choisi
    const second = writes.build('wish-toggle', seq(0, 0, 0.9, 0.9));
    assert.notEqual(`${second.token}${second.path}`, `${first.token}${first.path}`);
    assert.equal(writes.stats().pending, 2);
  });

  it('participer retire le souhait, et on ne souhaite pas un event rejoint', () => {
    const { writes } = planner();
    writes.observe(writes.build('wish-toggle', seq(0, 0)), OK);
    writes.observe(writes.build('participate-toggle', seq(0, 0)), OK);
    // l'event fx-1 est rejoint par load-0 : le souhait suivant de load-0 vise fx-2 ou un autre compte
    const next = writes.build('wish-toggle', seq(0, 0, 0, 0.9));
    assert.equal(next.path, '/social/events/fx-2/wish');
    assert.equal(next.method, 'POST');
  });

  it('envoie les passes par lot de 5 events de fixture au plus', () => {
    const { writes } = planner();
    const target = writes.build('pass-feedback', Math.random);
    assert.equal(target.path, '/ranking/events/feedback');
    const { body } = target;
    assert.ok(typeof body === 'object' && body !== null && 'items' in body && Array.isArray(body.items));
    assert.equal(body.items.length, 2);
    for (const item of body.items) assert.deepEqual(Object.keys(item).sort(), ['action', 'eventId']);
  });

  it('cycle de post : cree, garde 60 s, puis supprime ; like et commentaire visent les posts du pool', () => {
    const now = { t: 0 };
    const { writes } = planner(now);
    // sans post vivant, un like cree d'abord un post
    const create = writes.build('like-toggle', seq(0));
    assert.deepEqual([create.route, create.method, create.path], ['post-cycle', 'POST', '/posts']);
    writes.observe(create, { ...OK, body: { post: { id: 'p-1' } } });
    assert.equal(writes.stats().posts, 1);

    const like = writes.build('like-toggle', seq(0.5, 0));
    assert.deepEqual([like.method, like.path, like.token], ['POST', '/social/likes/p-1', 'load-token-2']);
    writes.observe(like, OK);

    const comment = writes.build('comment-cycle', seq(0.5, 0));
    assert.equal(comment.path, '/posts/p-1/comments');
    writes.observe(comment, { ...OK, body: { id: 'c-1' } });
    now.t = 31_000;
    const uncomment = writes.build('comment-cycle', seq(0.5));
    assert.deepEqual([uncomment.method, uncomment.path], ['DELETE', '/posts/p-1/comments/c-1']);
    writes.observe(uncomment, DONE);

    now.t = 61_000;
    const remove = writes.build('post-cycle', seq(0));
    assert.deepEqual([remove.method, remove.path, remove.token], ['DELETE', '/posts/p-1', 'load-token-0']);
    writes.observe(remove, DONE);
    assert.deepEqual(writes.stats(), { posts: 0, comments: 0, pending: 0 });
  });
});

describe('AppPlanner avec ecritures', () => {
  it('delegue les ecritures et refuse un melange qui ecrit sans pool', () => {
    const { writes } = planner();
    const actors = buildActors(2);
    assert.throws(() => new AppPlanner({ mix: [{ route: 'wish-toggle', weight: 1 }], actors }), /sans pool/);
    const app = new AppPlanner({ mix: [{ route: 'wish-toggle', weight: 1 }], actors, writes });
    const target = app.build('wish-toggle', actors[0], seq(0, 0));
    assert.equal(target.token, 'load-token-0');
    app.observe(target, OK);
    assert.equal(app.build('wish-toggle', actors[0], seq(0, 0)).method, 'DELETE');
    assert.equal(app.kindOf('wish-toggle'), 'write');
    assert.equal(app.kindOf('me'), 'read');
    assert.match(app.describe(), /lectures et ecritures/);
  });
});

describe('runRamp avec ecritures', () => {
  it('envoie chaque ecriture avec le jeton du compte load, pas celui de l acteur de lecture', async () => {
    const { writes } = planner();
    const actors = buildActors(2);
    const app = new AppPlanner({ mix: [{ route: 'follow-toggle', weight: 1 }], actors, writes });
    const send = mock.fn<LoadSender>(async () => OK);
    await runRamp({
      config: buildLoadConfig({ mode: 'app', steps: [5], stepSeconds: 1 }),
      actors,
      send,
      planner: app,
      log: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
      rng: Math.random,
    });
    assert.ok(send.mock.callCount() > 0);
    for (const call of send.mock.calls) {
      assert.match(call.arguments[1], /^load-token-/);
    }
  });
});
