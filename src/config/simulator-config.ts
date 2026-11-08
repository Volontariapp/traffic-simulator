import { assertValidTimeZone, type SleepConfig } from '../schedule/sleep-window.js';
import { parseLocalCenters, type GeoPoint } from '../geo/local-area.js';

export interface ReactionConfig {
  scanIntervalMs: number;
  tickIntervalMs: number;
  likesMin: number;
  likesMax: number;
  commentsMin: number;
  commentsMax: number;
}

export interface LocalConfig {
  /** Centres (position d'un utilisateur reel). Vide : fonction desactivee. */
  centers: GeoPoint[];
  /** Nombre de comptes "gens du coin", en plus du pool principal. */
  actors: number;
  radiusMeters: number;
  /** Delai entre deux vagues d'events. */
  intervalMs: number;
  /** Events crees par vague et par centre. */
  eventsMin: number;
  eventsMax: number;
  eventLifespanSec: number;
  geocoderUserAgent: string;
  /** Plafond de centres (fixes + decouverts) par vague. */
  maxCenters: number;
  /** Compte ADMIN du simulateur : active la decouverte des positions des vrais utilisateurs. */
  adminEmail?: string;
  adminPassword?: string;
  /** Une position plus ancienne que cela n'est plus consideree comme active. */
  activeMaxAgeMinutes: number;
}

export interface SimulatorConfig {
  apiGatewayUrl: string;
  tickIntervalMs: number;
  eventLifespanSec: number;
  targetActors: number;
  eventsPerDistrict: number;
  parallelDistrictBatch: number;
  initialMassSeed: boolean;
  massEventsCount: number;
  actorBatchPauseMs: number;
  forceIdentitySync: boolean;
  /** Renouvellement preventif : token renouvele quand son expiration est dans moins de ce delai. */
  tokenRefreshAheadMs: number;
  /** Frequence de verification des expirations des sessions. */
  tokenCheckIntervalMs: number;
  reaction: ReactionConfig;
  sleep: SleepConfig;
  local: LocalConfig;
}

type Env = Record<string, string | undefined>;

function readInt(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < min) {
    throw new Error(`Variable ${key} invalide : "${raw}" (entier >= ${min} attendu)`);
  }
  return value;
}

function readHour(env: Env, key: string, fallback: number): number {
  const value = readInt(env, key, fallback, 0);
  if (value > 24) {
    throw new Error(`Variable ${key} invalide : "${value}" (0 a 24 attendu)`);
  }
  return value % 24;
}

function readBool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

function readRange(env: Env, minKey: string, maxKey: string, minFallback: number, maxFallback: number) {
  const min = readInt(env, minKey, minFallback, 0);
  const max = readInt(env, maxKey, maxFallback, 0);
  if (max < min) {
    throw new Error(`${maxKey} (${max}) doit etre >= ${minKey} (${min})`);
  }
  return { min, max };
}

export function loadConfig(env: Env = process.env): SimulatorConfig {
  const likes = readRange(env, 'POST_LIKES_MIN', 'POST_LIKES_MAX', 12, 25);
  const comments = readRange(env, 'POST_COMMENTS_MIN', 'POST_COMMENTS_MAX', 4, 8);

  const localEvents = readRange(env, 'LOCAL_EVENTS_MIN', 'LOCAL_EVENTS_MAX', 1, 2);
  if (localEvents.min < 1) {
    throw new Error(`LOCAL_EVENTS_MIN (${localEvents.min}) doit etre >= 1`);
  }

  const timeZone = env.SLEEP_TIMEZONE?.trim() || 'Europe/Paris';
  try {
    assertValidTimeZone(timeZone);
  } catch {
    throw new Error(`Variable SLEEP_TIMEZONE invalide : "${timeZone}"`);
  }

  return {
    apiGatewayUrl: env.API_GATEWAY_URL || 'http://localhost:3000',
    tickIntervalMs: readInt(env, 'TICK_INTERVAL_MS', 8000, 100),
    eventLifespanSec: readInt(env, 'EVENT_LIFESPAN_SEC', 180, 1),
    targetActors: readInt(env, 'TARGET_ACTORS', 120, 1),
    eventsPerDistrict: readInt(env, 'EVENTS_PER_DISTRICT', 3, 1),
    parallelDistrictBatch: readInt(env, 'PARALLEL_DISTRICT_BATCH', 4, 1),
    initialMassSeed: env.INITIAL_MASS_SEED === 'true',
    massEventsCount: readInt(env, 'MASS_EVENTS_COUNT', 150, 1),
    actorBatchPauseMs: readInt(env, 'ACTOR_BATCH_PAUSE_MS', 1000, 0),
    forceIdentitySync: readBool(env, 'FORCE_IDENTITY_SYNC', false),
    tokenRefreshAheadMs: readInt(env, 'TOKEN_REFRESH_AHEAD_SEC', 300, 1) * 1000,
    tokenCheckIntervalMs: readInt(env, 'TOKEN_CHECK_INTERVAL_SEC', 60, 1) * 1000,
    reaction: {
      scanIntervalMs: readInt(env, 'POST_SCAN_INTERVAL_MS', 4000, 500),
      tickIntervalMs: readInt(env, 'REACTION_TICK_MS', 1000, 100),
      likesMin: likes.min,
      likesMax: likes.max,
      commentsMin: comments.min,
      commentsMax: comments.max,
    },
    sleep: {
      enabled: readBool(env, 'SLEEP_ENABLED', false),
      startHour: readHour(env, 'SLEEP_START_HOUR', 0),
      endHour: readHour(env, 'SLEEP_END_HOUR', 8),
      timeZone,
      drainSec: readInt(env, 'SLEEP_DRAIN_SEC', 300, 0),
    },
    local: {
      centers: parseLocalCenters(env.LOCAL_CENTERS),
      actors: readInt(env, 'LOCAL_ACTORS', 40, 5),
      radiusMeters: readInt(env, 'LOCAL_RADIUS_METERS', 2000, 100),
      intervalMs: readInt(env, 'LOCAL_EVENTS_INTERVAL_SEC', 300, 10) * 1000,
      eventsMin: localEvents.min,
      eventsMax: localEvents.max,
      eventLifespanSec: readInt(env, 'LOCAL_EVENT_LIFESPAN_SEC', 900, 1),
      geocoderUserAgent: env.LOCAL_GEOCODER_USER_AGENT?.trim() || 'VolontariApp-TrafficSimulator/1.0',
      maxCenters: readInt(env, 'LOCAL_MAX_CENTERS', 10, 1),
      adminEmail: env.SIMULATOR_ADMIN_EMAIL?.trim() || undefined,
      adminPassword: env.SIMULATOR_ADMIN_PASSWORD || undefined,
      activeMaxAgeMinutes: readInt(env, 'LOCAL_ACTIVE_MAX_AGE_MIN', 30, 1),
    },
  };
}
