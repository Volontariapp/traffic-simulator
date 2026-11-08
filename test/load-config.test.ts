import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadLoadConfig, parseMix, parseSteps } from '../src/load/load-config.js';

describe('loadLoadConfig', () => {
  it('refuse de demarrer sans cible explicite', () => {
    assert.throws(() => loadLoadConfig({}), /LOAD_BASE_URL/);
  });

  it('applique les valeurs par defaut et normalise la base', () => {
    const config = loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test/' });
    assert.equal(config.baseUrl, 'http://gw.test/api/v1');
    assert.deepEqual(config.steps, [50, 100, 200, 400, 800, 1000]);
    assert.equal(config.confirmEachStep, true);
    assert.equal(config.abortWindows, 2);
  });

  it('ne double pas le suffixe /api/v1', () => {
    const config = loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test/api/v1' });
    assert.equal(config.baseUrl, 'http://gw.test/api/v1');
  });

  it('desactive la confirmation sur LOAD_CONFIRM=false', () => {
    const config = loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_CONFIRM: 'false' });
    assert.equal(config.confirmEachStep, false);
  });

  it('construit les en-tetes Cloudflare Access depuis les variables de nativapp/.env', () => {
    const config = loadLoadConfig({
      LOAD_BASE_URL: 'http://gw.test',
      CF_ACCESS_CLIENT_ID: 'id-1',
      CF_ACCESS_CLIENT_SECRET: 'secret-1',
    });
    assert.deepEqual(config.accessHeaders, {
      'CF-Access-Client-Id': 'id-1',
      'CF-Access-Client-Secret': 'secret-1',
    });
  });

  it('ne met aucun en-tete sans jeton', () => {
    assert.deepEqual(loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test' }).accessHeaders, {});
  });

  it('refuse un jeton Cloudflare Access incomplet sans afficher la valeur', () => {
    assert.throws(
      () => loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', CF_ACCESS_CLIENT_ID: 'seul-id' }),
      (error: Error) => /ensemble/.test(error.message) && !error.message.includes('seul-id'),
    );
  });

  it('rejette une valeur numerique invalide en nommant la variable', () => {
    assert.throws(
      () => loadLoadConfig({ LOAD_BASE_URL: 'http://gw.test', LOAD_ABORT_ERROR_RATE: '2' }),
      /LOAD_ABORT_ERROR_RATE/,
    );
  });
});

describe('parseSteps', () => {
  it('lit des entiers positifs', () => {
    assert.deepEqual(parseSteps('50, 100,200'), [50, 100, 200]);
  });

  it('rejette zero, decimaux et liste vide', () => {
    assert.throws(() => parseSteps('0'));
    assert.throws(() => parseSteps('1.5'));
    assert.throws(() => parseSteps(''));
  });
});

describe('parseMix', () => {
  it('lit route:poids', () => {
    assert.deepEqual(parseMix('me:2,events-list:8'), [
      { route: 'me', weight: 2 },
      { route: 'events-list', weight: 8 },
    ]);
  });

  it('rejette une route inconnue', () => {
    assert.throws(() => parseMix('login:1'), /login/);
  });
});
