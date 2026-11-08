import type { GeoPoint } from './local-area.js';

export interface ResolvedPlace {
  /** Nom court du lieu (rue ou quartier), repris dans le titre de l'event. */
  name: string;
  /** Adresse complete, geocodee a nouveau en avant par ms-event : elle doit retomber pres du point. */
  address: string;
  postalCode: string;
}

export type ReverseGeocoder = (point: GeoPoint) => Promise<ResolvedPlace | undefined>;

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  error?: string;
}

export interface NominatimOptions {
  userAgent: string;
  /** La politique d'usage de Nominatim limite a une requete par seconde. */
  minGapMs?: number;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Transforme une reponse Nominatim en lieu exploitable ; undefined s'il n'y a pas de rue identifiable. */
export function placeFromNominatim(response: NominatimResponse): ResolvedPlace | undefined {
  const a = response.address;
  if (!a) return undefined;

  const street = a.road ?? a.pedestrian ?? a.footway;
  const city = a.city ?? a.town ?? a.village ?? a.municipality;
  if (!street || !city) return undefined;

  const line = a.house_number ? `${a.house_number} ${street}` : street;
  const postalCode = a.postcode ?? '';
  const address = `${line}, ${postalCode ? `${postalCode} ` : ''}${city}`;
  const name = a.neighbourhood ?? a.quarter ?? a.suburb ?? street;

  return { name, address, postalCode };
}

/**
 * Reverse-geocodage via OpenStreetMap Nominatim. Les events sont geocodes en avant a partir de leur
 * adresse texte (post-processor-event) : donner une vraie adresse proche du point choisi garantit que
 * l'event atterrit au bon endroit, sans course avec ce traitement asynchrone.
 */
export function createNominatimGeocoder(options: NominatimOptions): ReverseGeocoder {
  const {
    userAgent,
    minGapMs = 1100,
    baseUrl = 'https://nominatim.openstreetmap.org',
    fetchFn = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;

  let lastCallAt = 0;

  return async (point) => {
    const wait = lastCallAt + minGapMs - now();
    if (wait > 0) await sleep(wait);
    lastCallAt = now();

    const url = new URL('/reverse', baseUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(point.lat));
    url.searchParams.set('lon', String(point.lng));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'fr');

    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': userAgent } });
      if (!res.ok) return undefined;
      return placeFromNominatim((await res.json()) as NominatimResponse);
    } catch {
      return undefined;
    }
  };
}
