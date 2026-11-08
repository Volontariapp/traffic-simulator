import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AbortPolicy } from '../src/load/abort-policy.js';
import type { LatencySummary } from '../src/load/latency-stats.js';

const THRESHOLDS = { maxErrorRate: 0.05, maxP95Ms: 2000, windowsRequired: 2 };

function summary(overrides: Partial<LatencySummary> = {}): LatencySummary {
  return { count: 100, errors: 0, errorRate: 0, shedRate: 0, p50: 50, p95: 100, p99: 150, ...overrides };
}

describe('AbortPolicy', () => {
  it('laisse passer une fenetre saine', () => {
    assert.equal(new AbortPolicy(THRESHOLDS).observe(summary()), undefined);
  });

  it("n'arrete pas sur une seule fenetre mauvaise", () => {
    const policy = new AbortPolicy(THRESHOLDS);
    assert.equal(policy.observe(summary({ errorRate: 0.5 })), undefined);
  });

  it('arrete sur deux fenetres consecutives mauvaises, avec la raison', () => {
    const policy = new AbortPolicy(THRESHOLDS);
    policy.observe(summary({ p95: 3000 }));
    const reason = policy.observe(summary({ p95: 3500 }));
    assert.match(reason ?? '', /p95 3500 ms > 2000 ms/);
    assert.match(reason ?? '', /2 fenetres consecutives/);
  });

  it('arrete sur un delestage 429 soutenu meme sans erreur ni p95 eleve', () => {
    const policy = new AbortPolicy(THRESHOLDS);
    policy.observe(summary({ shedRate: 0.6 }));
    const reason = policy.observe(summary({ shedRate: 0.7 }));
    assert.match(reason ?? '', /delestage 429 70\.0 %/);
  });

  it('une fenetre saine remet le compteur a zero', () => {
    const policy = new AbortPolicy(THRESHOLDS);
    policy.observe(summary({ errorRate: 0.5 }));
    policy.observe(summary());
    assert.equal(policy.observe(summary({ errorRate: 0.5 })), undefined);
  });

  it('une fenetre vide ne compte ni comme mauvaise ni comme saine', () => {
    const policy = new AbortPolicy(THRESHOLDS);
    policy.observe(summary({ errorRate: 0.5 }));
    assert.equal(policy.observe(summary({ count: 0 })), undefined);
    assert.ok(policy.observe(summary({ errorRate: 0.5 })));
  });

  it('reset() efface les fenetres du palier precedent', () => {
    const policy = new AbortPolicy(THRESHOLDS);
    policy.observe(summary({ errorRate: 0.5 }));
    policy.reset();
    assert.equal(policy.observe(summary({ errorRate: 0.5 })), undefined);
  });
});
