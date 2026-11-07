import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSleepPhase, secondsOfDay } from '../src/schedule/sleep-window.js';
import { buildSleepConfig } from './factories/sleep-config.factory.js';

// Novembre : Paris est en UTC+1
const parisTime = (hh: number, mm = 0, ss = 0) =>
  new Date(Date.UTC(2026, 10, 7, hh - 1, mm, ss));

describe('getSleepPhase', () => {
  it('est awake en pleine journee', () => {
    assert.equal(getSleepPhase(parisTime(12), buildSleepConfig()), 'awake');
  });

  it('est asleep a minuit pile et en pleine nuit', () => {
    assert.equal(getSleepPhase(parisTime(0), buildSleepConfig()), 'asleep');
    assert.equal(getSleepPhase(parisTime(3, 30), buildSleepConfig()), 'asleep');
    assert.equal(getSleepPhase(parisTime(7, 59, 59), buildSleepConfig()), 'asleep');
  });

  it('se reveille a 8h00 pile', () => {
    assert.equal(getSleepPhase(parisTime(8), buildSleepConfig()), 'awake');
  });

  it('passe en draining dans la marge avant minuit', () => {
    assert.equal(getSleepPhase(parisTime(23, 56), buildSleepConfig({ drainSec: 300 })), 'draining');
    assert.equal(getSleepPhase(parisTime(23, 54), buildSleepConfig({ drainSec: 300 })), 'awake');
  });

  it('ne passe jamais en draining si drainSec vaut 0', () => {
    assert.equal(getSleepPhase(parisTime(23, 59, 59), buildSleepConfig({ drainSec: 0 })), 'awake');
  });

  it('est toujours awake quand la fonctionnalite est desactivee', () => {
    assert.equal(getSleepPhase(parisTime(3), buildSleepConfig({ enabled: false })), 'awake');
  });

  it('gere une fenetre sans passage de minuit', () => {
    const config = buildSleepConfig({ startHour: 13, endHour: 15, drainSec: 0 });
    assert.equal(getSleepPhase(parisTime(14), config), 'asleep');
    assert.equal(getSleepPhase(parisTime(16), config), 'awake');
  });

  it('gere une fenetre a cheval sur minuit autre que 0h-8h', () => {
    const config = buildSleepConfig({ startHour: 22, endHour: 6, drainSec: 0 });
    assert.equal(getSleepPhase(parisTime(23), config), 'asleep');
    assert.equal(getSleepPhase(parisTime(5), config), 'asleep');
    assert.equal(getSleepPhase(parisTime(6), config), 'awake');
  });

  it('une fenetre vide (debut = fin) ne dort jamais', () => {
    const config = buildSleepConfig({ startHour: 5, endHour: 5, drainSec: 0 });
    assert.equal(getSleepPhase(parisTime(5), config), 'awake');
  });

  it('respecte le fuseau : 23h30 UTC en novembre est 0h30 a Paris', () => {
    const instant = new Date(Date.UTC(2026, 10, 7, 23, 30));
    assert.equal(secondsOfDay(instant, 'Europe/Paris'), 30 * 60 + 0 * 3600);
    assert.equal(getSleepPhase(instant, buildSleepConfig()), 'asleep');
    assert.equal(getSleepPhase(instant, buildSleepConfig({ timeZone: 'UTC' })), 'awake');
    const lateUtc = new Date(Date.UTC(2026, 10, 7, 23, 57));
    assert.equal(getSleepPhase(lateUtc, buildSleepConfig({ timeZone: 'UTC' })), 'draining');
  });
});
