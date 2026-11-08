import { distanceMeters, type GeoPoint } from './local-area.js';

export interface LocalCenter extends GeoPoint {
  radiusMeters: number;
}

export type CenterProvider = () => Promise<LocalCenter[]>;

/**
 * Une position est arrondie a une cellule d'environ 1 km : l'utilisateur peut etre jusqu'a ~707 m
 * du centre de sa cellule. Le rayon d'une cellule decouverte est reduit d'autant pour que chaque
 * event reste dans le rayon voulu de l'utilisateur, ou qu'il soit dans la cellule.
 */
export const CELL_UNCERTAINTY_METERS = 710;
const MIN_RADIUS_METERS = 500;
/** Deux centres plus proches que cela sont le meme lieu. */
const SAME_PLACE_METERS = 100;

export interface CenterProviderOptions {
  staticCenters: GeoPoint[];
  radiusMeters: number;
  maxCenters: number;
  /** Cellules decouvertes automatiquement ; une erreur est ignoree (centres fixes seuls). */
  discover?: () => Promise<GeoPoint[]>;
  rng?: () => number;
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildCenterProvider(options: CenterProviderOptions): CenterProvider {
  const { staticCenters, radiusMeters, maxCenters, discover, rng = Math.random } = options;
  const fixed: LocalCenter[] = staticCenters.map((center) => ({ ...center, radiusMeters }));
  const discoveredRadius = Math.max(MIN_RADIUS_METERS, radiusMeters - CELL_UNCERTAINTY_METERS);

  return async () => {
    let cells: GeoPoint[] = [];
    if (discover) {
      try {
        cells = await discover();
      } catch (err) {
        console.warn(
          '[LocalEventsEngine] Decouverte des positions impossible, centres fixes seuls :',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const fresh = cells.filter((cell) => fixed.every((center) => distanceMeters(center, cell) > SAME_PLACE_METERS));
    const room = Math.max(0, maxCenters - fixed.length);
    const picked = shuffled(fresh, rng)
      .slice(0, room)
      .map((cell) => ({ ...cell, radiusMeters: discoveredRadius }));

    return [...fixed, ...picked];
  };
}
