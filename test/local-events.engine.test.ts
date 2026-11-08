import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { LocalEventsEngine, type LocalEventSpawner } from '../src/engines/local-events.engine.js';
import { OFF_GRID_DISTRICT, type ParisLocation } from '../src/geo/paris-districts.js';
import { distanceMeters } from '../src/geo/local-area.js';
import { createRng } from '../src/actors/actor-identity.js';
import { buildLocalConfig } from './factories/local-config.factory.js';
import type { ResolvedPlace } from '../src/geo/reverse-geocoder.js';

const place: ResolvedPlace = { name: 'Rue Oberkampf', address: '12 Rue Oberkampf, 75011 Paris', postalCode: '75011' };

function setup(options: { geocode?: (p: { lat: number; lng: number }) => Promise<ResolvedPlace | undefined> } = {}) {
  const spawned: ParisLocation[] = [];
  const tickActive = mock.fn(async () => undefined);
  const spawner: LocalEventSpawner = {
    spawnAt: async (location: ParisLocation) => {
      spawned.push(location);
      return true;
    },
    tickActive,
  };
  const geocode = mock.fn(options.geocode ?? (async () => place));
  return { spawner, spawned, geocode, tickActive };
}

describe('LocalEventsEngine', () => {
  let clock = 1_000_000;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('cree une vague immediatement puis attend l intervalle', async () => {
    const { spawner, spawned, geocode } = setup();
    const config = buildLocalConfig({ eventsMin: 2, eventsMax: 2, intervalMs: 300_000 });
    const engine = new LocalEventsEngine(spawner, geocode, config, createRng(1), now);

    await engine.tick(true);
    assert.equal(spawned.length, 2);

    clock += 299_000;
    await engine.tick(true);
    assert.equal(spawned.length, 2, 'pas de nouvelle vague avant 5 minutes');

    clock += 2_000;
    await engine.tick(true);
    assert.equal(spawned.length, 4);
  });

  it('cree la vague pour chaque centre', async () => {
    const { spawner, spawned, geocode } = setup();
    const centers = [
      { lat: 48.8566, lng: 2.3522 },
      { lat: 45.764, lng: 4.8357 },
    ];
    const config = buildLocalConfig({ centers, eventsMin: 1, eventsMax: 1 });
    await new LocalEventsEngine(spawner, geocode, config, createRng(3), now).tick(true);

    assert.equal(spawned.length, 2);
    const geocoded = geocode.mock.calls.map((c) => c.arguments[0]);
    centers.forEach((center, i) => {
      assert.ok(distanceMeters(center, geocoded[i]) <= config.radiusMeters + 1);
    });
  });

  it('pose l event avec l adresse resolue, hors arrondissements', async () => {
    const { spawner, spawned, geocode } = setup();
    await new LocalEventsEngine(spawner, geocode, buildLocalConfig({ eventsMin: 1, eventsMax: 1 }), createRng(5), now).tick(true);

    assert.equal(spawned[0].district, OFF_GRID_DISTRICT);
    assert.equal(spawned[0].address, place.address);
    assert.equal(spawned[0].name, place.name);
    assert.equal(spawned[0].postalCode, place.postalCode);
  });

  it('reessaie avec un autre point quand le reverse-geocodage echoue', async () => {
    let calls = 0;
    const { spawner, spawned, geocode } = setup({ geocode: async () => (++calls < 3 ? undefined : place) });
    await new LocalEventsEngine(spawner, geocode, buildLocalConfig({ eventsMin: 1, eventsMax: 1 }), createRng(9), now).tick(true);

    assert.equal(geocode.mock.callCount(), 3);
    assert.equal(spawned.length, 1);
  });

  it('abandonne un event apres 3 echecs sans bloquer les suivants', async () => {
    const { spawner, spawned, geocode } = setup({ geocode: async () => undefined });
    await new LocalEventsEngine(spawner, geocode, buildLocalConfig({ eventsMin: 2, eventsMax: 2 }), createRng(2), now).tick(true);

    assert.equal(geocode.mock.callCount(), 6);
    assert.equal(spawned.length, 0);
  });

  it('ne cree rien quand la creation est suspendue, mais fait avancer les events actifs', async () => {
    const { spawner, spawned, geocode, tickActive } = setup();
    const engine = new LocalEventsEngine(spawner, geocode, buildLocalConfig(), createRng(1), now);

    await engine.tick(false);

    assert.equal(spawned.length, 0);
    assert.equal(tickActive.mock.callCount(), 1);
  });

  it('ne rattrape pas les vagues manquees apres une suspension', async () => {
    const { spawner, spawned, geocode } = setup();
    const config = buildLocalConfig({ eventsMin: 1, eventsMax: 1, intervalMs: 300_000 });
    const engine = new LocalEventsEngine(spawner, geocode, config, createRng(1), now);

    await engine.tick(false);
    clock += 3_600_000;
    await engine.tick(true);

    assert.equal(spawned.length, 1, 'une seule vague au reveil, pas une rafale');
  });

  it('ne fait rien sans centre configure', async () => {
    const { spawner, spawned, geocode } = setup();
    await new LocalEventsEngine(spawner, geocode, buildLocalConfig({ centers: [] }), createRng(1), now).tick(true);

    assert.equal(spawned.length, 0);
    assert.equal(geocode.mock.callCount(), 0);
  });
});
