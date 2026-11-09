import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dueCount, plannedCount, runAtRate } from '../src/load/rate-scheduler.js';
import { FakeClock } from './mocks/load-deps.mock.js';

describe('dueCount', () => {
  it('cumule le debit theorique moins ce qui est parti', () => {
    assert.equal(dueCount(1000, 100, 0), 100);
    assert.equal(dueCount(500, 100, 20), 30);
  });

  it('rattrape un tick tardif sans jamais etre negatif', () => {
    assert.equal(dueCount(2000, 100, 100), 100);
    assert.equal(dueCount(100, 100, 50), 0);
  });
});

describe('runAtRate', () => {
  it('emet exactement debit x duree, independamment du temps de reponse', async () => {
    let fired = 0;
    const result = await runAtRate({
      ratePerSec: 250,
      durationMs: 4000,
      fire: () => {
        fired += 1;
      },
      shouldStop: () => false,
      clock: new FakeClock(),
    });
    assert.equal(result.sent, 1000);
    assert.equal(fired, 1000);
  });

  it('tient un debit non entier par seconde sur la duree', async () => {
    const result = await runAtRate({
      ratePerSec: 7,
      durationMs: 3000,
      fire: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
    });
    assert.equal(result.sent, 21);
  });

  it("s'arrete des que shouldStop passe a vrai", async () => {
    let fired = 0;
    const result = await runAtRate({
      ratePerSec: 1000,
      durationMs: 60_000,
      fire: () => {
        fired += 1;
      },
      shouldStop: () => fired >= 50,
      clock: new FakeClock(),
    });
    assert.ok(result.sent >= 50 && result.sent < 1000);
  });
});

describe('montee lineaire', () => {
  it('cumule l aire du triangle pendant la montee puis le debit plein', () => {
    assert.equal(plannedCount(2000, 100, 4000), 50);
    assert.equal(plannedCount(4000, 100, 4000), 200);
    assert.equal(plannedCount(5000, 100, 4000), 300);
  });

  it('sans montee, plannedCount est le cumul a debit constant', () => {
    assert.equal(plannedCount(1500, 100), 150);
    assert.equal(dueCount(1000, 100, 0, 0), dueCount(1000, 100, 0));
  });

  it('emet la moitie du debit x duree sur une montee complete', async () => {
    const result = await runAtRate({
      ratePerSec: 100,
      durationMs: 4000,
      rampUpMs: 4000,
      fire: () => undefined,
      shouldStop: () => false,
      clock: new FakeClock(),
    });
    assert.equal(result.sent, 200);
  });
});
