import type { LocalConfig } from '../config/simulator-config.js';
import type { CenterProvider, LocalCenter } from '../geo/center-provider.js';
import { randomPointInRadius } from '../geo/local-area.js';
import { OFF_GRID_DISTRICT, type ParisLocation } from '../geo/paris-districts.js';
import type { ReverseGeocoder } from '../geo/reverse-geocoder.js';

/** Ce que le moteur attend du moteur d'events en direct (`ParisLiveEngine` en pratique). */
export interface LocalEventSpawner {
  spawnAt(location: ParisLocation): Promise<boolean>;
  tickActive(): Promise<void>;
}

/** Points tentes pour un event avant d'y renoncer (un point en pleine Seine n'a pas d'adresse). */
const MAX_GEOCODE_ATTEMPTS = 3;

/**
 * Simule de l'activite autour d'un ou plusieurs centres (la position d'un vrai utilisateur) :
 * a chaque vague, 1 a N events en direct, poses dans le rayon configure autour de chaque centre.
 */
export class LocalEventsEngine {
  private nextWaveAt = 0;

  constructor(
    private readonly spawner: LocalEventSpawner,
    private readonly geocode: ReverseGeocoder,
    private readonly centers: CenterProvider,
    private readonly config: Pick<LocalConfig, 'intervalMs' | 'eventsMin' | 'eventsMax'>,
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * `spawnEnabled` faux (vidage nocturne) : plus de nouvelle vague, les events actifs continuent
   * d'avancer. Une vague manquee pendant la suspension n'est pas rattrapee.
   */
  async tick(spawnEnabled: boolean): Promise<void> {
    const now = this.now();
    if (spawnEnabled && now >= this.nextWaveAt) {
      this.nextWaveAt = now + this.config.intervalMs;
      await this.runWave();
    }
    await this.spawner.tickActive();
  }

  private async runWave(): Promise<void> {
    const { eventsMin, eventsMax } = this.config;
    const centers = await this.centers();
    for (const center of centers) {
      const count = eventsMin + Math.floor(this.rng() * (eventsMax - eventsMin + 1));
      let created = 0;
      for (let i = 0; i < count; i++) {
        if (await this.spawnOne(center)) created++;
      }
      console.log(
        `[LocalEventsEngine] Vague autour de ${center.lat},${center.lng} : ${created}/${count} events crees (rayon ${center.radiusMeters} m).`,
      );
    }
  }

  private async spawnOne(center: LocalCenter): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_GEOCODE_ATTEMPTS; attempt++) {
      const point = randomPointInRadius(center, center.radiusMeters, this.rng);
      const place = await this.geocode(point);
      if (!place) continue;

      return this.spawner.spawnAt({
        district: OFF_GRID_DISTRICT,
        postalCode: place.postalCode,
        name: place.name,
        address: place.address,
        lat: point.lat,
        lng: point.lng,
      });
    }
    console.warn(`[LocalEventsEngine] Aucune adresse trouvee autour de ${center.lat},${center.lng} : event abandonne.`);
    return false;
  }
}
