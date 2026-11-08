import { assertValidTimeZone, type SleepConfig } from '../schedule/sleep-window.js';

export interface ReactionConfig {
  scanIntervalMs: number;
  tickIntervalMs: number;
  likesMin: number;
  likesMax: number;
  commentsMin: number;
  commentsMax: number;
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
  };
}
