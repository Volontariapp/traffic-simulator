import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createNominatimGeocoder, placeFromNominatim } from '../src/geo/reverse-geocoder.js';

const parisResponse = {
  address: { house_number: '12', road: 'Rue Oberkampf', suburb: 'Quartier Sainte-Marguerite', postcode: '75011', city: 'Paris' },
};

describe('placeFromNominatim', () => {
  it('compose une adresse complete avec numero, code postal et ville', () => {
    assert.deepEqual(placeFromNominatim(parisResponse), {
      name: 'Quartier Sainte-Marguerite',
      address: '12 Rue Oberkampf, 75011 Paris',
      postalCode: '75011',
    });
  });

  it('tolere l absence de numero et retombe sur la rue comme nom', () => {
    const place = placeFromNominatim({ address: { road: 'Rue Oberkampf', postcode: '75011', city: 'Paris' } });
    assert.deepEqual(place, { name: 'Rue Oberkampf', address: 'Rue Oberkampf, 75011 Paris', postalCode: '75011' });
  });

  it('accepte une commune a la place de la ville', () => {
    assert.equal(placeFromNominatim({ address: { road: 'Rue X', town: 'Montreuil' } })?.address, 'Rue X, Montreuil');
  });

  it('refuse une reponse sans rue ou sans commune', () => {
    assert.equal(placeFromNominatim({ error: 'Unable to geocode' }), undefined);
    assert.equal(placeFromNominatim({ address: { city: 'Paris' } }), undefined);
    assert.equal(placeFromNominatim({ address: { road: 'Rue X' } }), undefined);
  });
});

describe('createNominatimGeocoder', () => {
  const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

  it('envoie le User-Agent et les coordonnees', async () => {
    const fetchFn = mock.fn(async () => jsonResponse(parisResponse));
    const geocode = createNominatimGeocoder({ userAgent: 'TestAgent/1.0', fetchFn: fetchFn as unknown as typeof fetch, minGapMs: 0 });

    const place = await geocode({ lat: 48.86, lng: 2.37 });

    assert.equal(place?.postalCode, '75011');
    const [url, init] = fetchFn.mock.calls[0].arguments as unknown as [URL, RequestInit];
    assert.equal(url.searchParams.get('lat'), '48.86');
    assert.equal(url.searchParams.get('lon'), '2.37');
    assert.deepEqual(init.headers, { 'User-Agent': 'TestAgent/1.0' });
  });

  it('respecte l intervalle minimal entre deux requetes', async () => {
    let clock = 10_000;
    const sleep = mock.fn(async (ms: number) => {
      clock += ms;
    });
    const fetchFn = mock.fn(async () => jsonResponse(parisResponse));
    const geocode = createNominatimGeocoder({
      userAgent: 'TestAgent/1.0',
      fetchFn: fetchFn as unknown as typeof fetch,
      minGapMs: 1000,
      sleep,
      now: () => clock,
    });

    await geocode({ lat: 1, lng: 1 });
    clock += 300;
    await geocode({ lat: 2, lng: 2 });

    assert.equal(sleep.mock.callCount(), 1);
    assert.equal(sleep.mock.calls[0].arguments[0], 700);
  });

  it('retourne undefined sur erreur HTTP ou reseau, sans lever', async () => {
    const failing = createNominatimGeocoder({
      userAgent: 'a',
      minGapMs: 0,
      fetchFn: (async () => jsonResponse({}, false)) as unknown as typeof fetch,
    });
    assert.equal(await failing({ lat: 1, lng: 1 }), undefined);

    const throwing = createNominatimGeocoder({
      userAgent: 'a',
      minGapMs: 0,
      fetchFn: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    assert.equal(await throwing({ lat: 1, lng: 1 }), undefined);
  });
});
