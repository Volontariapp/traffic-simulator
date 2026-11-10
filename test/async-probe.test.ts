import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { AbortPolicy } from '../src/load/abort-policy.js';
import { WritePlanner } from '../src/load/app/write-planner.js';
import { AppPlanner } from '../src/load/app/app-planner.js';
import type { LatencySummary } from '../src/load/latency-stats.js';
import type { LoadSender } from '../src/load/load-http.js';
import { renderMarkdown } from '../src/load/load-report.js';
import { runRamp } from '../src/load/load-runner.js';
import { AsyncProbe, type AsyncWindow } from '../src/load/probe/async-probe.js';
import { buildActor, buildActors } from './factories/actor.factory.js';
import { buildLoadConfig } from './factories/load-config.factory.js';
import { FakeClock } from './mocks/load-deps.mock.js';
import { createProbeSocketMock } from './mocks/probe-socket.mock.js';

function probe(now: { t: number }) {
  const sockets = createProbeSocketMock();
  const p = new AsyncProbe({
    accounts: [{ userId: 'u1', token: 't1' }],
    factory: sockets.factory,
    lostAfterMs: 1000,
    now: () => now.t,
  });
  p.start();
  return { p, ...sockets };
}

const HEALTHY: LatencySummary = {
  count: 10, errors: 0, errorRate: 0, shedRate: 0, degraded: 0, clientErrors: 0, p50: 10, p95: 20, p99: 30,
};
const asyncWindow = (overrides: Partial<AsyncWindow>): AsyncWindow => ({
  received: 10, lost: 0, lostRate: 0, p50: 100, p95: 200, max: 300, ...overrides,
});

describe('AsyncProbe', () => {
  it('mesure le delai entre l ecriture acceptee et le message a l emetteur', () => {
    const now = { t: 0 };
    const { p, emit } = probe(now);
    p.expect('u1', 'post.liked', 'p1');
    now.t = 250;
    // diffusion aux autres et message d'un autre post : ignores
    emit('t1', 'post.liked', { postId: 'p1', isEmitter: false });
    emit('t1', 'post.liked', { postId: 'p2', isEmitter: true });
    emit('t1', 'post.liked', { postId: 'p1', isEmitter: true });
    const w = p.takeWindow();
    assert.deepEqual([w.received, w.lost, w.p95], [1, 0, 250]);
  });

  it('compte perdu un effet qui n arrive pas a temps, et ignore les comptes non sondes', () => {
    const now = { t: 0 };
    const { p } = probe(now);
    p.expect('u1', 'post.comment.created', 'p1');
    p.expect('other', 'post.liked', 'p1');
    now.t = 500;
    assert.equal(p.takeWindow().lost, 0);
    now.t = 1500;
    const w = p.takeWindow();
    assert.deepEqual([w.lost, w.lostRate], [1, 1]);
    assert.equal(p.openCount(), 0);
  });

  it('ferme ses sockets', () => {
    const { p, close } = probe({ t: 0 });
    p.close();
    assert.equal(close.mock.callCount(), 1);
  });
});

describe('AbortPolicy et effets asynchrones', () => {
  const thresholds = { maxErrorRate: 0.05, maxP95Ms: 2000, windowsRequired: 2, maxAsyncP95Ms: 30_000, maxAsyncLostRate: 0.02 };

  it('arrete sur un delai asynchrone trop long deux fenetres de suite', () => {
    const policy = new AbortPolicy(thresholds);
    assert.equal(policy.observe(HEALTHY, asyncWindow({ p95: 40_000 })), undefined);
    assert.match(policy.observe(HEALTHY, asyncWindow({ p95: 45_000 })) ?? '', /delai asynchrone/);
  });

  it('arrete sur des effets perdus', () => {
    const policy = new AbortPolicy(thresholds);
    policy.observe(HEALTHY, asyncWindow({ lostRate: 0.1 }));
    assert.match(policy.observe(HEALTHY, asyncWindow({ lostRate: 0.1 })) ?? '', /perdus/);
  });

  it('sans sonde, seuls les seuils HTTP comptent', () => {
    const policy = new AbortPolicy(thresholds);
    policy.observe(HEALTHY);
    assert.equal(policy.observe(HEALTHY), undefined);
  });
});

describe('WritePlanner et sonde', () => {
  it('annonce le message attendu apres un like ou un commentaire accepte', () => {
    const expect = mock.fn((_u: string, _e: 'post.liked' | 'post.comment.created', _p: string) => undefined);
    const loadActors = [buildActor(0, { id: 'a' }), buildActor(1, { id: 'b' })];
    const writes = new WritePlanner({ loadActors, fixtureEvents: ['fx'], probe: { expect }, nowMs: () => 0 });
    const create = writes.build('post-cycle', () => 0);
    writes.observe(create, { status: 201, ms: 1, timedOut: false, body: { id: 'p1' } });
    const like = writes.build('like-toggle', () => 0.9);
    writes.observe(like, { status: 201, ms: 1, timedOut: false });
    const comment = writes.build('comment-cycle', () => 0.9);
    writes.observe(comment, { status: 201, ms: 1, timedOut: false, body: { id: 'c1' } });
    assert.deepEqual(
      expect.mock.calls.map((c) => c.arguments),
      [
        ['b', 'post.liked', 'p1'],
        ['b', 'post.comment.created', 'p1'],
      ],
    );
  });
});

describe('runRamp avec sonde', () => {
  it('agrege les fenetres de la sonde dans le palier et le rapport', async () => {
    const windows: AsyncWindow[] = [asyncWindow({ received: 0 }), asyncWindow({ p95: 500 }), asyncWindow({ p95: 900, lost: 1 })];
    let i = 0;
    const actors = buildActors(2);
    const report = await runRamp({
      config: buildLoadConfig({ mode: 'app', steps: [5], stepSeconds: 2, windowSeconds: 1 }),
      actors,
      send: mock.fn<LoadSender>(async () => ({ status: 200, ms: 5, timedOut: false })),
      planner: new AppPlanner({ mix: [{ route: 'me', weight: 1 }], actors }),
      probe: { takeWindow: () => windows[Math.min(i++, windows.length - 1)] },
      log: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
    });
    // la premiere lecture (avant la mesure) est jetee
    assert.deepEqual(report.steps[0].async, { received: 20, lost: 1, lostRate: 1 / 21, worstWindowP95: 900, max: 300 });
    assert.match(renderMarkdown(report), /Effets asynchrones/);
  });
});
