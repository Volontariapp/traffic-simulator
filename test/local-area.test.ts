import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distanceMeters, parseLocalCenters, randomPointInRadius } from '../src/geo/local-area.js';
import { createRng } from '../src/actors/actor-identity.js';

describe('parseLocalCenters', () => {
  it('retourne une liste vide quand la variable est absente ou vide', () => {
    assert.deepEqual(parseLocalCenters(undefined), []);
    assert.deepEqual(parseLocalCenters('   '), []);
  });

  it('lit plusieurs centres separes par des points-virgules', () => {
    assert.deepEqual(parseLocalCenters('48.8566,2.3522; 45.764 , 4.8357'), [
      { lat: 48.8566, lng: 2.3522 },
      { lat: 45.764, lng: 4.8357 },
    ]);
  });

  it('refuse un centre mal forme ou hors bornes', () => {
    assert.throws(() => parseLocalCenters('48.8566'), /LOCAL_CENTERS/);
    assert.throws(() => parseLocalCenters('abc,def'), /LOCAL_CENTERS/);
    assert.throws(() => parseLocalCenters('91,2'), /LOCAL_CENTERS/);
    assert.throws(() => parseLocalCenters('48,181'), /LOCAL_CENTERS/);
  });
});

describe('randomPointInRadius', () => {
  const center = { lat: 48.8566, lng: 2.3522 };

  it('reste toujours dans le rayon demande', () => {
    const rng = createRng(42);
    for (let i = 0; i < 2000; i++) {
      const point = randomPointInRadius(center, 2000, rng);
      assert.ok(distanceMeters(center, point) <= 2000 + 1, `hors rayon : ${distanceMeters(center, point)}`);
    }
  });

  it('couvre tout le disque et pas seulement le centre', () => {
    const rng = createRng(7);
    const distances = Array.from({ length: 2000 }, () => distanceMeters(center, randomPointInRadius(center, 2000, rng)));
    assert.ok(Math.max(...distances) > 1800);
    assert.ok(distances.filter((d) => d > 1000).length > 1000, 'distribution uniforme sur la surface attendue');
  });

  it('est deterministe pour un rng donne', () => {
    assert.deepEqual(randomPointInRadius(center, 500, createRng(1)), randomPointInRadius(center, 500, createRng(1)));
  });
});

describe('distanceMeters', () => {
  it('mesure environ 111 km par degre de latitude', () => {
    const d = distanceMeters({ lat: 48, lng: 2 }, { lat: 49, lng: 2 });
    assert.ok(Math.abs(d - 111_195) < 300);
  });
});
