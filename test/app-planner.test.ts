import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { APP_READ_ROUTES, APP_V1, executableMix } from '../src/load/app/app-profile.js';
import { AppPlanner, primeAppPlanner } from '../src/load/app/app-planner.js';
import { IdPool } from '../src/load/app/id-pool.js';
import { loadLoadConfig, parseAppMix, parseMode } from '../src/load/load-config.js';
import { createSender, type FetchLike, type LoadSender } from '../src/load/load-http.js';
import { runRamp } from '../src/load/load-runner.js';
import { renderMarkdown } from '../src/load/load-report.js';
import { buildActors } from './factories/actor.factory.js';
import { buildEvent, buildListResponse, buildPost } from './factories/app-response.factory.js';
import { buildLoadConfig } from './factories/load-config.factory.js';
import { FakeClock } from './mocks/load-deps.mock.js';

const NOW = Date.UTC(2026, 10, 9, 20, 0, 0);

function planner(mix = executableMix(APP_V1)): AppPlanner {
  return new AppPlanner({ mix, actors: buildActors(3), nowMs: () => NOW });
}

function harvested(): AppPlanner {
  const p = planner();
  p.observe({ route: 'ranking-feed', path: '/ranking/feed' }, buildListResponse({ posts: [buildPost(1), buildPost(2)] }));
  p.observe({ route: 'ranking-events', path: '/ranking/events' }, buildListResponse({ events: [buildEvent(1)] }));
  return p;
}

const ACTOR = buildActors(1)[0];

describe('profil app-v1', () => {
  it('ne rend executables que les lectures, poids d origine', () => {
    const mix = executableMix(APP_V1);
    assert.deepEqual(
      mix.map((m) => m.route).sort(),
      [...APP_READ_ROUTES].sort(),
    );
    assert.equal(
      mix.reduce((sum, m) => sum + m.weight, 0),
      88,
    );
  });

  it('LOAD_MODE vaut routes par defaut et refuse une valeur inconnue', () => {
    assert.equal(parseMode(undefined), 'routes');
    assert.equal(parseMode('app'), 'app');
    assert.throws(() => parseMode('all'), /LOAD_MODE/);
  });

  it('LOAD_MIX du mode app refuse les ecritures et les routes inconnues', () => {
    assert.deepEqual(parseAppMix('me:1,ranking-feed:3'), [
      { route: 'me', weight: 1 },
      { route: 'ranking-feed', weight: 3 },
    ]);
    assert.throws(() => parseAppMix('like-toggle:4'), /ecriture/);
    assert.throws(() => parseAppMix('events-list:4'), /invalide en mode app/);
  });

  it('en mode routes, LOAD_MIX garde sa lecture d origine et le melange app reste celui du profil', () => {
    const config = loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_MIX: 'me:1' });
    assert.equal(config.mode, 'routes');
    assert.deepEqual(config.mix, [{ route: 'me', weight: 1 }]);
    assert.equal(config.appMix.length, APP_READ_ROUTES.length);
    assert.throws(() => loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_MIX: '' }), /aucune route/);
  });

  it('en mode app, LOAD_MIX choisit les routes d app', () => {
    const config = loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_MODE: 'app', LOAD_MIX: 'me:1' });
    assert.deepEqual(config.appMix, [{ route: 'me', weight: 1 }]);
  });
});

describe('AppPlanner', () => {
  it('lit les listes principales de nativapp et demande leur corps', () => {
    const p = planner();
    assert.deepEqual(p.build('ranking-feed', ACTOR, () => 0), {
      route: 'ranking-feed',
      path: '/ranking/feed?limit=10',
      harvest: true,
    });
    assert.deepEqual(p.build('ranking-events', ACTOR, () => 0), {
      route: 'ranking-events',
      path: '/ranking/events?limit=20',
      harvest: true,
    });
    assert.equal(p.build('me', ACTOR, () => 0).path, '/users/me');
  });

  it('replie une route de detail sur sa liste tant qu aucun identifiant n est connu', () => {
    const p = planner();
    assert.equal(p.build('event-detail', ACTOR, () => 0).route, 'ranking-events');
    assert.equal(p.build('related-posts', ACTOR, () => 0).route, 'ranking-events');
    assert.equal(p.build('comments-list', ACTOR, () => 0).route, 'ranking-feed');
    assert.equal(p.build('likes-summary', ACTOR, () => 0).route, 'ranking-feed');
  });

  it('vise un post, un event ou un auteur vu dans une reponse', () => {
    const p = harvested();
    assert.equal(p.build('event-detail', ACTOR, () => 0).path, '/events/event-1');
    assert.equal(
      p.build('event-participants', ACTOR, () => 0).path,
      '/users/event/event-1/participants?pagination[page]=1&pagination[limit]=20',
    );
    assert.equal(p.build('comments-list', ACTOR, () => 0).path, '/posts/post-1/comments?page=1&limit=10');
    // pool d'utilisateurs : 3 acteurs, puis author-1, author-2, organizer-1
    assert.equal(p.users.size, 6);
    assert.equal(p.build('public-user', ACTOR, () => 0.99).path, '/users/organizer-1/public');
  });

  it('envoie le resume des likes en POST avec des identifiants distincts', () => {
    const p = harvested();
    const target = p.build('likes-summary', ACTOR, Math.random);
    assert.equal(target.method, 'POST');
    assert.equal(target.path, '/social/likes-summary');
    const { body } = target;
    assert.ok(typeof body === 'object' && body !== null && 'postIds' in body && Array.isArray(body.postIds));
    assert.deepEqual([...body.postIds].sort(), ['post-1', 'post-2']);
  });

  it('recherche d events : repli du swipe ou carte en direct, avec les filtres de l app', () => {
    const p = planner();
    const swipe = new URL(p.build('events-search-app', ACTOR, () => 0.1).path, 'http://gw.test');
    assert.equal(swipe.searchParams.get('statuses'), '2');
    assert.equal(swipe.searchParams.get('excludeWishedByMe'), 'true');
    assert.equal(swipe.searchParams.get('startDateFrom'), new Date(NOW).toISOString());

    const live = new URL(p.build('events-search-app', ACTOR, () => 0.9).path, 'http://gw.test');
    assert.equal(live.searchParams.get('statuses'), '2,3');
    assert.equal(live.searchParams.get('area[radiusMeters]'), '2000');
    assert.ok(live.searchParams.get('area[center][latitude]'));
    assert.equal(live.searchParams.get('endAtFrom'), new Date(NOW).toISOString());
    assert.equal(live.searchParams.get('limit'), '30');
    assert.equal(live.searchParams.get('excludeWishedByMe'), null);
  });

  it('construit une requete GET ou POST valide pour chaque route de lecture', () => {
    const p = harvested();
    for (const route of APP_READ_ROUTES) {
      for (const value of [0, 0.5, 0.99]) {
        const target = p.build(route, ACTOR, () => value);
        assert.ok(target.path.startsWith('/'), route);
        assert.ok(target.method === undefined || target.method === 'POST', route);
      }
    }
  });

  it('refuse une route inconnue', () => {
    assert.throws(() => planner().build('like-toggle', ACTOR, () => 0), /inconnue/);
  });

  it('prepare les pools avant la mesure', async () => {
    const p = planner();
    const send = mock.fn<LoadSender>(async (target) =>
      target.route === 'ranking-events' || target.route === 'events-search-app'
        ? buildListResponse({ events: [buildEvent(7)] })
        : buildListResponse({ posts: [buildPost(7)] }),
    );
    const sent = await primeAppPlanner(p, send, buildActors(2), () => 0);
    assert.equal(sent, 8);
    assert.deepEqual([p.posts.size, p.events.size], [1, 1]);
  });
});

describe('IdPool', () => {
  it('ignore doublons et valeurs vides, et borne la memoire', () => {
    const pool = new IdPool(2);
    pool.add('a');
    pool.add('a');
    pool.add('');
    pool.add(undefined);
    pool.add('b');
    pool.add('c');
    assert.equal(pool.size, 2);
    assert.deepEqual(pool.sample(5, Math.random).sort(), ['b', 'c']);
  });
});

describe('sender en mode app', () => {
  it('decode le corps d une cible harvest seulement', async () => {
    const fetchFn: FetchLike = async () => new Response('{"posts":[{"id":"p"}]}', { status: 200 });
    const send = createSender({ baseUrl: 'http://gw.test', timeoutMs: 1000, fetchFn });
    assert.deepEqual((await send({ route: 'r', path: '/x', harvest: true }, 't')).body, { posts: [{ id: 'p' }] });
    assert.equal((await send({ route: 'r', path: '/x' }, 't')).body, undefined);
  });

  it('ignore un corps illisible sans compter d erreur', async () => {
    const fetchFn: FetchLike = async () => new Response('pas du json', { status: 200 });
    const send = createSender({ baseUrl: 'http://gw.test', timeoutMs: 1000, fetchFn });
    const res = await send({ route: 'r', path: '/x', harvest: true }, 't');
    assert.deepEqual([res.status, res.body], [200, undefined]);
  });
});

describe('runRamp en mode app', () => {
  it('compte chaque requete sous le nom de la route vraiment envoyee', async () => {
    const actors = buildActors(3);
    const p = new AppPlanner({ mix: [{ route: 'event-detail', weight: 1 }], actors, nowMs: () => NOW });
    const send = mock.fn<LoadSender>(async (target) =>
      target.harvest ? buildListResponse({ events: [buildEvent(1)] }) : { status: 200, ms: 20, timedOut: false },
    );
    const report = await runRamp({
      config: buildLoadConfig({ mode: 'app', steps: [10], stepSeconds: 1 }),
      actors,
      send,
      planner: p,
      log: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
      rng: () => 0,
    });
    const byRoute = report.steps[0].stats.byRoute;
    // la premiere requete part sans cible : liste ranking-events, puis le detail de l'event vu
    assert.equal(byRoute['ranking-events'].count, 1);
    assert.equal(byRoute['event-detail'].count, 9);
    assert.equal(report.mode, 'app');
    assert.match(report.mix, /^app-v1 lectures : event-detail:1$/);
  });
});

describe('AppPlanner : localite par acteur', () => {
  it('ouvre de preference un element de la derniere liste lue par le meme acteur', () => {
    const actors = buildActors(2);
    const p = new AppPlanner({ mix: executableMix(APP_V1), actors, nowMs: () => NOW });
    const [a, b] = actors;
    const listA = p.build('ranking-events', a, () => 0);
    p.observe(listA, buildListResponse({ events: [buildEvent(1)] }));
    const listB = p.build('ranking-events', b, () => 0);
    p.observe(listB, buildListResponse({ events: [buildEvent(2), buildEvent(3)] }));
    // tirages : page, puis localite (sous 0,7 : liste de l'acteur), puis l'element
    assert.equal(p.build('event-detail', a, seq(0, 0.1, 0)).path, '/events/event-1');
    assert.equal(p.build('event-detail', a, seq(0, 0.9, 0.99)).path, '/events/event-3');
  });

  it('le resume des likes porte sur les posts vus par l acteur', () => {
    const actors = buildActors(2);
    const p = new AppPlanner({ mix: executableMix(APP_V1), actors, nowMs: () => NOW });
    p.observe(p.build('ranking-feed', actors[0], () => 0), buildListResponse({ posts: [buildPost(1)] }));
    p.observe(p.build('ranking-feed', actors[1], () => 0), buildListResponse({ posts: [buildPost(2)] }));
    const target = p.build('likes-summary', actors[0], Math.random);
    assert.deepEqual(target.body, { postIds: ['post-1'] });
  });
});

function seq(...values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

describe('rapport du mode app', () => {
  it('ventile par route et par type', async () => {
    const actors = buildActors(3);
    const p = new AppPlanner({ mix: [{ route: 'me', weight: 1 }, { route: 'ranking-feed', weight: 1 }], actors, nowMs: () => NOW });
    const send = mock.fn<LoadSender>(async (target) =>
      target.route === 'ranking-feed' ? { status: 206, ms: 5, timedOut: false } : { status: 200, ms: 5, timedOut: false },
    );
    let draw = 0;
    const report = await runRamp({
      config: buildLoadConfig({ mode: 'app', steps: [10], stepSeconds: 1 }),
      actors,
      send,
      planner: p,
      log: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
      rng: () => (draw++ % 2 === 0 ? 0.1 : 0.9),
    });
    const stats = report.steps[0].stats;
    assert.equal(stats.byKind?.read.count, 10);
    assert.ok(stats.byRoute['ranking-feed'].degraded > 0);
    const text = renderMarkdown(report);
    assert.match(text, /Palier 10 req\/s, par route/);
    assert.match(text, /\| read \| 10 \|/);
  });
});
