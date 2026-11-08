import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOAD_ROUTES, parseMix } from '../src/load/load-config.js';
import { buildTarget } from '../src/load/load-request.js';

const PEER = 'peer-1';

describe('buildTarget', () => {
  it('garde les requetes de reference inchangees', () => {
    assert.equal(buildTarget('events-list', PEER, () => 0).path, '/events?page=1&limit=20');
    assert.equal(buildTarget('posts-list', PEER, () => 0).path, '/posts?page=1&limit=20');
    assert.equal(buildTarget('me', PEER, () => 0).path, '/users/me');
    assert.equal(
      buildTarget('is-following', PEER, () => 0).path,
      '/social/users/peer-1/is-following',
    );
  });

  it('envoie les filtres de nativapp sur events-list-app', () => {
    const { path } = buildTarget('events-list-app', PEER, () => 0);
    const url = new URL(path, 'http://gw.test');
    assert.equal(url.pathname, '/events');
    assert.equal(url.searchParams.get('page'), '1');
    assert.equal(url.searchParams.get('limit'), '20');
    for (const flag of [
      'excludeBlockedUsers',
      'excludeParticipatedByMe',
      'excludeCreatedByMe',
      'excludeWishedByMe',
    ]) {
      assert.equal(url.searchParams.get(flag), 'true', flag);
    }
  });

  it('fait varier la page de 1 a 3 sur events-list-app', () => {
    const pages = [0, 0.5, 0.99].map((value) =>
      new URL(buildTarget('events-list-app', PEER, () => value).path, 'http://gw.test').searchParams.get('page'),
    );
    assert.deepEqual(pages, ['1', '2', '3']);
  });
});

describe('parseMix avec events-list-app', () => {
  it('accepte la route dans LOAD_MIX', () => {
    assert.deepEqual(parseMix('events-list-app:40,me:60'), [
      { route: 'events-list-app', weight: 40 },
      { route: 'me', weight: 60 },
    ]);
  });

  it('declare la route dans LOAD_ROUTES', () => {
    assert.ok((LOAD_ROUTES as readonly string[]).includes('events-list-app'));
  });
});
