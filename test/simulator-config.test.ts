import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config/simulator-config.js';

describe('loadConfig', () => {
  it('applique les valeurs par defaut', () => {
    const config = loadConfig({});
    assert.equal(config.reaction.likesMin, 12);
    assert.equal(config.reaction.likesMax, 25);
    assert.equal(config.reaction.commentsMin, 4);
    assert.equal(config.reaction.commentsMax, 8);
    assert.equal(config.reaction.scanIntervalMs, 4000);
    assert.equal(config.sleep.enabled, false);
    assert.equal(config.sleep.timeZone, 'Europe/Paris');
  });

  it('lit la fenetre de sommeil depuis l environnement', () => {
    const config = loadConfig({
      SLEEP_ENABLED: 'true',
      SLEEP_START_HOUR: '1',
      SLEEP_END_HOUR: '7',
      SLEEP_TIMEZONE: 'UTC',
      SLEEP_DRAIN_SEC: '60',
      TARGET_ACTORS: '300',
    });
    assert.deepEqual(config.sleep, { enabled: true, startHour: 1, endHour: 7, timeZone: 'UTC', drainSec: 60 });
    assert.equal(config.targetActors, 300);
  });

  it('normalise 24h en 0h', () => {
    assert.equal(loadConfig({ SLEEP_END_HOUR: '24' }).sleep.endHour, 0);
  });

  it('refuse une fourchette inversee', () => {
    assert.throws(() => loadConfig({ POST_LIKES_MIN: '30', POST_LIKES_MAX: '10' }), /POST_LIKES_MAX/);
  });

  it('refuse un fuseau inconnu', () => {
    assert.throws(() => loadConfig({ SLEEP_TIMEZONE: 'Mars/Olympus' }), /SLEEP_TIMEZONE/);
  });

  it('refuse un entier invalide', () => {
    assert.throws(() => loadConfig({ TARGET_ACTORS: 'abc' }), /TARGET_ACTORS/);
    assert.throws(() => loadConfig({ SLEEP_START_HOUR: '30' }), /SLEEP_START_HOUR/);
  });
});
