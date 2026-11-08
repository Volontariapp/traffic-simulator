import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { runRamp } from '../src/load/load-runner.js';
import { renderMarkdown } from '../src/load/load-report.js';
import { buildActors } from './factories/actor.factory.js';
import { buildLoadConfig } from './factories/load-config.factory.js';
import { createSenderMock, FakeClock, neverResolves } from './mocks/load-deps.mock.js';

function setup(overrides: Parameters<typeof buildLoadConfig>[0] = {}, respond?: Parameters<typeof createSenderMock>[0]) {
  const send = createSenderMock(respond);
  const log = mock.fn((_line: string) => undefined);
  const deps = {
    config: buildLoadConfig(overrides),
    actors: buildActors(5),
    send,
    log,
    shouldStop: () => false,
    clock: new FakeClock(),
    rng: () => 0.5,
  };
  return { send, log, deps };
}

describe('runRamp', () => {
  it('parcourt tous les paliers a debit exact', async () => {
    const { send, deps } = setup({ steps: [10, 20], stepSeconds: 2 });
    const report = await runRamp(deps);

    assert.equal(report.stopReason, 'completed');
    assert.deepEqual(
      report.steps.map((s) => [s.targetRate, s.sent]),
      [
        [10, 20],
        [20, 40],
      ],
    );
    assert.equal(send.mock.callCount(), 60);
    assert.equal(report.lastHealthyRate, 20);
    assert.equal(report.steps[0].achievedRate, 10);
  });

  it("n'inclut pas l'echauffement dans les statistiques du palier", async () => {
    const { send, deps } = setup({ steps: [10], stepSeconds: 1, warmupSeconds: 2 });
    const report = await runRamp(deps);
    assert.equal(send.mock.callCount(), 30);
    assert.equal(report.steps[0].stats.count, 10);
  });

  it('arrete la rampe sur le garde-fou et garde le dernier palier sain', async () => {
    const { deps } = setup({ steps: [10, 20, 30], stepSeconds: 5 }, (i) =>
      // palier 10 sain (50 requetes), ensuite tout en erreur
      i < 50 ? { status: 200, ms: 20, timedOut: false } : { status: 500, ms: 20, timedOut: false },
    );
    const report = await runRamp(deps);

    assert.equal(report.stopReason, 'abort-policy');
    assert.equal(report.steps.length, 2);
    assert.match(report.steps[1].abortReason ?? '', /erreurs/);
    // arret apres deux fenetres consecutives hors seuil : 2 x 20 requetes
    assert.equal(report.steps[1].sent, 40);
    assert.equal(report.lastHealthyRate, 10);
  });

  it('compte dropped sans envoyer quand le plafond de requetes en vol est atteint', async () => {
    const { send, deps } = setup(
      { steps: [10], stepSeconds: 1, maxInFlight: 1, abortWindows: 99 },
      () => neverResolves(),
    );
    const report = await runRamp(deps);

    assert.equal(send.mock.callCount(), 1);
    assert.equal(report.steps[0].dropped, 9);
    assert.equal(report.steps[0].stats.outcomes.dropped, 9);
    assert.equal(report.steps[0].achievedRate, 1);
  });

  it('respecte un refus de confirmation avant le palier', async () => {
    const { send, deps } = setup({ steps: [10, 20] });
    const confirm = mock.fn(async (rate: number) => rate === 10);
    const report = await runRamp({ ...deps, confirm });

    assert.equal(report.stopReason, 'declined');
    assert.deepEqual(
      report.steps.map((s) => s.targetRate),
      [10],
    );
    assert.equal(confirm.mock.callCount(), 2);
    assert.equal(send.mock.callCount(), 20);
  });

  it('sort proprement sur demande d arret', async () => {
    const { deps } = setup({ steps: [10, 20], stepSeconds: 4 });
    let windows = 0;
    const log = mock.fn((line: string) => {
      if (line.includes('fenetre')) windows += 1;
    });
    const report = await runRamp({ ...deps, log, shouldStop: () => windows >= 1 });

    assert.equal(report.stopReason, 'signal');
    assert.equal(report.steps.length, 1);
    assert.equal(report.steps[0].sent, 10);
  });

  it('ventile les routes selon le melange', async () => {
    const { deps } = setup({
      steps: [10],
      stepSeconds: 1,
      mix: [
        { route: 'me', weight: 1 },
        { route: 'posts-list', weight: 1 },
      ],
    });
    // le runner tire 4 fois par requete (route, acteur, pair, page) : le premier tirage choisit la route
    let draw = 0;
    let fired = 0;
    const rng = (): number => {
      const isRouteDraw = draw++ % 4 === 0;
      if (!isRouteDraw) return 0.5;
      return fired++ % 2 === 0 ? 0.1 : 0.9;
    };
    const report = await runRamp({ ...deps, rng });
    const routes = Object.keys(report.steps[0].stats.byRoute).sort();
    assert.deepEqual(routes, ['me', 'posts-list']);
  });
});

describe('renderMarkdown', () => {
  it('liste un palier par ligne et le dernier palier sain', async () => {
    const { deps } = setup({ steps: [10, 20], stepSeconds: 1 });
    const text = renderMarkdown(await runRamp(deps));
    assert.match(text, /\| 10 \| 10\.0 \|/);
    assert.match(text, /\| 20 \| 20\.0 \|/);
    assert.match(text, /Dernier palier sain : 20 req\/s/);
  });
});
