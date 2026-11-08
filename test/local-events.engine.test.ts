import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { LocalEventsEngine, type LocalEventSpawner } from '../src/engines/local-events.engine.js';
import { OFF_GRID_DISTRICT, type ParisLocation } from '../src/geo/paris-districts.js';
import { distanceMeters } from '../src/geo/local-area.js';
import type { CenterProvider, LocalCenter } from '../src/geo/center-provider.js';
import { createRng } from '../src/actors/actor-identity.js';
import { buildLocalConfig } from './factories/local-config.factory.js';
import type { ResolvedPlace } from '../src/geo/reverse-geocoder.js';

const place: ResolvedPlace = { name: 'Rue Oberkampf', address: '12 Rue Oberkampf, 75011 Paris', postalCode: '75011' };
const PARIS: LocalCenter = { lat: 48.8566, lng: 2.3522, radiusMeters: 2000 };
const LYON: LocalCenter = { lat: 45.764, lng: 4.8357, radiusMeters: 1290 };

const fixed =
  (...centers: LocalCenter[]): CenterProvider =>
  async () =>
    centers;

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
    const engine = new LocalEventsEngine(spawner, geocode, fixed(PARIS), config, createRng(1), now);

    await engine.tick(true);
    assert.equal(spawned.length, 2);

    clock += 299_000;
    await engine.tick(true);
    assert.equal(spawned.length, 2, 'pas de nouvelle vague avant 5 minutes');

    clock += 2_000;
    await engine.tick(true);
    assert.equal(spawned.length, 4);
  });

  it('cree la vague pour chaque centre, dans le rayon propre a chaque centre', async () => {
    const { spawner, spawned, geocode } = setup();
    const config = buildLocalConfig({ eventsMin: 1, eventsMax: 1 });
    await new LocalEventsEngine(spawner, geocode, fixed(PARIS, LYON), config, createRng(3), now).tick(true);

    assert.equal(spawned.length, 2);
    const geocoded = geocode.mock.calls.map((c) => c.arguments[0]);
    assert.ok(distanceMeters(PARIS, geocoded[0]) <= PARIS.radiusMeters + 1);
    assert.ok(distanceMeters(LYON, geocoded[1]) <= LYON.radiusMeters + 1);
  });

  it('relit les centres a chaque vague : un utilisateur qui arrive est pris en compte', async () => {
    const { spawner, spawned, geocode } = setup();
    const provider = mock.fn<CenterProvider>(async () => [PARIS]);
    const config = buildLocalConfig({ eventsMin: 1, eventsMax: 1, intervalMs: 300_000 });
    const engine = new LocalEventsEngine(spawner, geocode, provider, config, createRng(1), now);

    await engine.tick(true);
    provider.mock.mockImplementation(async () => [PARIS, LYON]);
    clock += 301_000;
    await engine.tick(true);

    assert.equal(provider.mock.callCount(), 2);
    assert.equal(spawned.length, 3);
  });

  it('pose l event avec l adresse resolue, hors arrondissements', async () => {
    const { spawner, spawned, geocode } = setup();
    const config = buildLocalConfig({ eventsMin: 1, eventsMax: 1 });
    await new LocalEventsEngine(spawner, geocode, fixed(PARIS), config, createRng(5), now).tick(true);

    assert.equal(spawned[0].district, OFF_GRID_DISTRICT);
    assert.equal(spawned[0].address, place.address);
    assert.equal(spawned[0].name, place.name);
    assert.equal(spawned[0].postalCode, place.postalCode);
  });

  it('reessaie avec un autre point quand le reverse-geocodage echoue', async () => {
    let calls = 0;
    const { spawner, spawned, geocode } = setup({ geocode: async () => (++calls < 3 ? undefined : place) });
    const config = buildLocalConfig({ eventsMin: 1, eventsMax: 1 });
    await new LocalEventsEngine(spawner, geocode, fixed(PARIS), config, createRng(9), now).tick(true);

    assert.equal(geocode.mock.callCount(), 3);
    assert.equal(spawned.length, 1);
  });

  it('abandonne un event apres 3 echecs sans bloquer les suivants', async () => {
    const { spawner, spawned, geocode } = setup({ geocode: async () => undefined });
    const config = buildLocalConfig({ eventsMin: 2, eventsMax: 2 });
    await new LocalEventsEngine(spawner, geocode, fixed(PARIS), config, createRng(2), now).tick(true);

    assert.equal(geocode.mock.callCount(), 6);
    assert.equal(spawned.length, 0);
  });

  it('ne cree rien quand la creation est suspendue, mais fait avancer les events actifs', async () => {
    const { spawner, spawned, geocode, tickActive } = setup();
    const engine = new LocalEventsEngine(spawner, geocode, fixed(PARIS), buildLocalConfig(), createRng(1), now);

    await engine.tick(false);

    assert.equal(spawned.length, 0);
    assert.equal(tickActive.mock.callCount(), 1);
  });

  it('ne rattrape pas les vagues manquees apres une suspension', async () => {
    const { spawner, spawned, geocode } = setup();
    const config = buildLocalConfig({ eventsMin: 1, eventsMax: 1, intervalMs: 300_000 });
    const engine = new LocalEventsEngine(spawner, geocode, fixed(PARIS), config, createRng(1), now);

    await engine.tick(false);
    clock += 3_600_000;
    await engine.tick(true);

    assert.equal(spawned.length, 1, 'une seule vague au reveil, pas une rafale');
  });

  it('ne fait rien quand aucun centre n est connu, et reessaie a la vague suivante', async () => {
    const { spawner, spawned, geocode } = setup();
    const engine = new LocalEventsEngine(spawner, geocode, fixed(), buildLocalConfig(), createRng(1), now);

    await engine.tick(true);

    assert.equal(spawned.length, 0);
    assert.equal(geocode.mock.callCount(), 0);
  });
});
