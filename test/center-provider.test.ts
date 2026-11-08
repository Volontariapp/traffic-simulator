import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_UNCERTAINTY_METERS, buildCenterProvider } from '../src/geo/center-provider.js';
import { createRng } from '../src/actors/actor-identity.js';

const PARIS = { lat: 48.8566, lng: 2.3522 };
const LYON = { lat: 45.764, lng: 4.8357 };

describe('buildCenterProvider', () => {
  it('rend les centres fixes avec le rayon complet', async () => {
    const provider = buildCenterProvider({ staticCenters: [PARIS], radiusMeters: 2000, maxCenters: 10 });
    assert.deepEqual(await provider(), [{ ...PARIS, radiusMeters: 2000 }]);
  });

  it('reduit le rayon des cellules decouvertes de l incertitude d arrondi a 1 km', async () => {
    const provider = buildCenterProvider({
      staticCenters: [],
      radiusMeters: 2000,
      maxCenters: 10,
      discover: async () => [LYON],
    });
    assert.deepEqual(await provider(), [{ ...LYON, radiusMeters: 2000 - CELL_UNCERTAINTY_METERS }]);
  });

  it('ne descend jamais sous un rayon minimal', async () => {
    const provider = buildCenterProvider({
      staticCenters: [],
      radiusMeters: 800,
      maxCenters: 10,
      discover: async () => [LYON],
    });
    assert.equal((await provider())[0].radiusMeters, 500);
  });

  it('fusionne un centre decouvert quasi identique a un centre fixe', async () => {
    const provider = buildCenterProvider({
      staticCenters: [PARIS],
      radiusMeters: 2000,
      maxCenters: 10,
      discover: async () => [{ lat: PARIS.lat + 0.0003, lng: PARIS.lng }, LYON],
    });
    const centers = await provider();
    assert.equal(centers.length, 2);
    assert.deepEqual(centers[0], { ...PARIS, radiusMeters: 2000 });
  });

  it('plafonne le nombre de centres en tirant au hasard parmi les cellules', async () => {
    const cells = Array.from({ length: 30 }, (_, i) => ({ lat: 40 + i * 0.1, lng: 2 }));
    const provider = buildCenterProvider({
      staticCenters: [PARIS],
      radiusMeters: 2000,
      maxCenters: 5,
      discover: async () => cells,
      rng: createRng(4),
    });
    const centers = await provider();
    assert.equal(centers.length, 5);
    assert.deepEqual(centers[0], { ...PARIS, radiusMeters: 2000 }, 'les centres fixes sont toujours gardes');
  });

  it('retombe sur les centres fixes quand la decouverte echoue', async () => {
    const provider = buildCenterProvider({
      staticCenters: [PARIS],
      radiusMeters: 2000,
      maxCenters: 10,
      discover: async () => {
        throw new Error('gateway down');
      },
    });
    assert.deepEqual(await provider(), [{ ...PARIS, radiusMeters: 2000 }]);
  });
});
