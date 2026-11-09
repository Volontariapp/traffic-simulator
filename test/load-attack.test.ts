import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { loadLoadConfig } from '../src/load/load-config.js';
import { createSender, type FetchLike } from '../src/load/load-http.js';
import { renderMarkdown } from '../src/load/load-report.js';
import { runRamp } from '../src/load/load-runner.js';
import { buildActors } from './factories/actor.factory.js';
import { buildLoadConfig } from './factories/load-config.factory.js';
import { createSenderMock, FakeClock } from './mocks/load-deps.mock.js';

function deps(overrides: Parameters<typeof buildLoadConfig>[0]) {
  const send = createSenderMock();
  return {
    send,
    deps: {
      config: buildLoadConfig(overrides),
      actors: buildActors(5),
      send,
      log: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
      rng: () => 0.5,
    },
  };
}

describe('profil d attaque', () => {
  it('par defaut, ni montee ni debut de palier : comportement precedent', () => {
    const config = loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test' });
    assert.equal(config.rampUpSeconds, 0);
    assert.equal(config.onsetSeconds, 0);
    assert.equal(config.warmupSeconds, 10);
  });

  it('lit LOAD_RAMP_UP_SECONDS et LOAD_ONSET_SECONDS', () => {
    const config = loadLoadConfig({
      LOAD_BASE_URL: 'http://gw.test',
      LOAD_RAMP_UP_SECONDS: '3',
      LOAD_WARMUP_SECONDS: '0',
      LOAD_ONSET_SECONDS: '10',
    });
    assert.deepEqual([config.rampUpSeconds, config.warmupSeconds, config.onsetSeconds], [3, 0, 10]);
  });

  it('refuse un debut de palier non entier', () => {
    assert.throws(
      () => loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_ONSET_SECONDS: '2.5' }),
      /LOAD_ONSET_SECONDS/,
    );
  });

  it('exclut la montee des statistiques du palier, comme l echauffement', async () => {
    const { send, deps: d } = deps({ steps: [100], stepSeconds: 1, rampUpSeconds: 4 });
    const report = await runRamp(d);
    // montee : 100 x 4 / 2 = 200, puis 100 mesurees
    assert.equal(send.mock.callCount(), 300);
    assert.equal(report.steps[0].stats.count, 100);
    assert.equal(report.steps[0].rampUpSeconds, 4);
    assert.equal(report.steps[0].onset, undefined);
  });

  it('range le debut de palier par seconde de lancement, montee comprise', async () => {
    const { deps: d } = deps({ steps: [100], stepSeconds: 2, rampUpSeconds: 2, onsetSeconds: 3 });
    const report = await runRamp(d);
    const onset = report.steps[0].onset;
    assert.ok(onset);
    assert.equal(onset.seconds, 3);
    // montee de 2 s : environ 25 puis 75 requetes, puis plein debit. Une requete prevue pile a la
    // frontiere d'une seconde (tick de 5 ms) part dans la seconde suivante.
    const counts = onset.series.map((s) => s.count);
    assert.deepEqual(counts, [24, 75, 100]);
    assert.equal(onset.stats.count, counts.reduce((a, b) => a + b, 0));
  });

  it('attaque brutale : sans montee ni echauffement, la premiere seconde est mesuree et lue a part', async () => {
    const { deps: d } = deps({ steps: [50], stepSeconds: 2, warmupSeconds: 0, onsetSeconds: 1 });
    const report = await runRamp(d);
    assert.equal(report.steps[0].stats.count, 100);
    assert.equal(report.steps[0].onset?.series[0].count, 49);
    assert.match(renderMarkdown(report), /Debut de palier/);
    assert.match(renderMarkdown(report), /\| 50 \| 1 \| 49 \|/);
  });
});

describe('mode routes : non-regression des requetes', () => {
  it('envoie des GET sans corps ni Content-Type, avec les memes en-tetes et chemins', async () => {
    const fetchFn = mock.fn<FetchLike>(async () => new Response('{}', { status: 200 }));
    const config = { ...loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_WARMUP_SECONDS: '0' }), steps: [5], stepSeconds: 1, windowSeconds: 1 };
    assert.equal(
      config.mix.map((m) => `${m.route}:${m.weight}`).join(','),
      'events-list:40,posts-list:30,me:20,is-following:10',
    );
    const report = await runRamp({
      config,
      actors: buildActors(3),
      send: createSender({ baseUrl: config.baseUrl, timeoutMs: 1000, fetchFn }),
      log: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
      // tirage de route a 50 sur 100 : posts-list ; page 1 + floor(0.5 x 3) = 2
      rng: () => 0.5,
    });

    assert.equal(report.steps[0].sent, 5);
    assert.equal(fetchFn.mock.callCount(), 5);
    for (const call of fetchFn.mock.calls) {
      const [url, init] = call.arguments;
      assert.equal(url, 'http://gw.test/api/v1/posts?page=2&limit=20');
      assert.equal(init.method, 'GET');
      assert.equal('body' in init, false);
      assert.deepEqual(Object.keys(init.headers as Record<string, string>).sort(), [
        'Authorization',
        'User-Agent',
        'X-Load-Test',
      ]);
    }
  });

  it('envoie le corps JSON et la methode quand la cible les porte', async () => {
    const fetchFn = mock.fn<FetchLike>(async () => new Response('{}', { status: 200 }));
    const send = createSender({ baseUrl: 'http://gw.test/api/v1', timeoutMs: 1000, fetchFn });
    await send({ route: 'me', path: '/social/likes-summary', method: 'POST', body: { postIds: ['p1'] } }, 'tok');
    const init = fetchFn.mock.calls[0].arguments[1];
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{"postIds":["p1"]}');
    assert.equal((init.headers as Record<string, string>)['Content-Type'], 'application/json');
  });
});
