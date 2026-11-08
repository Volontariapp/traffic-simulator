export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * Lit la liste des centres : `lat,lng;lat,lng`. Vide ou absente : aucun centre (fonction desactivee).
 */
export function parseLocalCenters(raw: string | undefined): GeoPoint[] {
  if (raw === undefined || raw.trim() === '') return [];

  return raw
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
    .map((chunk) => {
      const parts = chunk.split(',').map((part) => part.trim());
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      const valid =
        parts.length === 2 &&
        parts.every((part) => part !== '') &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180;
      if (!valid) {
        throw new Error(`Variable LOCAL_CENTERS invalide : "${chunk}" (attendu "lat,lng", lat -90..90, lng -180..180)`);
      }
      return { lat, lng };
    });
}

/** Distance orthodromique en metres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Point tire uniformement dans le disque de `radiusMeters` autour de `center`
 * (racine carree sur la distance : sans elle, les points s'entasseraient pres du centre).
 */
export function randomPointInRadius(center: GeoPoint, radiusMeters: number, rng: () => number = Math.random): GeoPoint {
  const distance = radiusMeters * Math.sqrt(rng());
  const bearing = 2 * Math.PI * rng();
  const angular = distance / EARTH_RADIUS_M;
  const lat1 = toRadians(center.lat);
  const lng1 = toRadians(center.lng);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: Number(toDegrees(lat2).toFixed(6)), lng: Number(toDegrees(lng2).toFixed(6)) };
}
