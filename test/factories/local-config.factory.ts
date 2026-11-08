import type { LocalConfig } from '../../src/config/simulator-config.js';

export function buildLocalConfig(overrides: Partial<LocalConfig> = {}): LocalConfig {
  return {
    centers: [{ lat: 48.8566, lng: 2.3522 }],
    actors: 40,
    radiusMeters: 2000,
    intervalMs: 300_000,
    eventsMin: 1,
    eventsMax: 2,
    eventLifespanSec: 900,
    geocoderUserAgent: 'TestAgent/1.0',
    ...overrides,
  };
}
