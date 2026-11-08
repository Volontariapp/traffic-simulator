import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, percentile, StatsWindow } from '../src/load/latency-stats.js';

describe('classify', () => {
  it('distingue succes, fallback, delestage et erreurs', () => {
    assert.equal(classify(200, false), 'ok');
    assert.equal(classify(206, false), 'degraded');
    assert.equal(classify(429, false), 'shed');
    assert.equal(classify(404, false), 'client-error');
    assert.equal(classify(503, false), 'server-error');
  });

  it('separe delai depasse et erreur reseau (status 0)', () => {
    assert.equal(classify(0, true), 'timeout');
    assert.equal(classify(0, false), 'network-error');
  });
});

describe('percentile', () => {
  it('retourne le rang le plus proche', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(sorted, 50), 50);
    assert.equal(percentile(sorted, 95), 95);
    assert.equal(percentile(sorted, 99), 99);
  });

  it('vaut zero sur une serie vide', () => {
    assert.equal(percentile([], 95), 0);
  });
});

describe('StatsWindow', () => {
  it('compte seulement 5xx, reseau, delai et dropped comme erreurs', () => {
    const window = new StatsWindow();
    window.add({ route: 'me', outcome: 'ok', ms: 10 });
    window.add({ route: 'me', outcome: 'shed', ms: 5 });
    window.add({ route: 'me', outcome: 'degraded', ms: 30 });
    window.add({ route: 'me', outcome: 'server-error', ms: 40 });
    const stats = window.snapshot();
    assert.equal(stats.count, 4);
    assert.equal(stats.errors, 1);
    assert.equal(stats.errorRate, 0.25);
    assert.equal(stats.outcomes.shed, 1);
    assert.equal(stats.outcomes.degraded, 1);
  });

  it('ventile par route', () => {
    const window = new StatsWindow();
    window.add({ route: 'me', outcome: 'ok', ms: 10 });
    window.add({ route: 'events-list', outcome: 'timeout', ms: 1000 });
    const stats = window.snapshot();
    assert.equal(stats.byRoute['me'].errors, 0);
    assert.equal(stats.byRoute['events-list'].errors, 1);
    assert.equal(stats.byRoute['events-list'].p95, 1000);
  });

  it('retourne des zeros sur une fenetre vide', () => {
    const stats = new StatsWindow().snapshot();
    assert.equal(stats.count, 0);
    assert.equal(stats.errorRate, 0);
    assert.equal(stats.p95, 0);
  });
});
