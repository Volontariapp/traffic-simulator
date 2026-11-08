export const LOAD_ROUTES = ['events-list', 'posts-list', 'me', 'is-following'] as const;
export type LoadRouteName = (typeof LOAD_ROUTES)[number];

export interface RouteWeight {
  route: LoadRouteName;
  weight: number;
}

export interface LoadConfig {
  /** Gateway visee, suffixe /api/v1 ajoute si absent. */
  baseUrl: string;
  /** Debits cibles successifs, en requetes par seconde. */
  steps: number[];
  stepSeconds: number;
  warmupSeconds: number;
  /** Duree d'une fenetre de mesure : unite d'evaluation de l'arret automatique. */
  windowSeconds: number;
  actors: number;
  /** Requetes en vol maximum cote client : au-dela, la requete est comptee "dropped" (non envoyee). */
  maxInFlight: number;
  timeoutMs: number;
  abortErrorRate: number;
  abortP95Ms: number;
  /** Nombre de fenetres consecutives hors seuil avant l'arret. */
  abortWindows: number;
  mix: RouteWeight[];
  /**
   * Jeton de service Cloudflare Access (memes variables que nativapp/.env). Vide : aucun en-tete.
   * Les valeurs ne sont jamais journalisees ni ecrites dans le rapport.
   */
  accessHeaders: Record<string, string>;
  /** Demande une confirmation sur stdin avant chaque palier. */
  confirmEachStep: boolean;
  reportPath: string;
}

const DEFAULT_MIX = 'events-list:40,posts-list:30,me:20,is-following:10';

function readNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  rule: (value: number) => boolean,
  expectation: string,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !rule(value)) {
    throw new Error(`${key}=${raw} invalide : ${expectation}`);
  }
  return value;
}

export function parseSteps(raw: string): number[] {
  const steps = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(Number);
  if (steps.length === 0 || steps.some((s) => !Number.isInteger(s) || s <= 0)) {
    throw new Error(`LOAD_STEPS=${raw} invalide : entiers positifs separes par des virgules`);
  }
  return steps;
}

export function parseMix(raw: string): RouteWeight[] {
  const mix = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [name, weightRaw] = part.split(':');
      const route = LOAD_ROUTES.find((r) => r === name);
      const weight = Number(weightRaw);
      if (!route || !Number.isFinite(weight) || weight <= 0) {
        throw new Error(
          `LOAD_MIX entree "${part}" invalide : <route>:<poids>, routes ${LOAD_ROUTES.join(', ')}`,
        );
      }
      return { route, weight };
    });
  if (mix.length === 0) throw new Error('LOAD_MIX ne contient aucune route');
  return mix;
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

/** Les deux variables vont ensemble : une seule renseignee est une erreur de saisie, pas un choix. */
export function parseAccessHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const id = env.CF_ACCESS_CLIENT_ID?.trim();
  const secret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (!id && !secret) return {};
  if (!id || !secret) {
    throw new Error('CF_ACCESS_CLIENT_ID et CF_ACCESS_CLIENT_SECRET doivent etre renseignes ensemble');
  }
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}

export function loadLoadConfig(env: NodeJS.ProcessEnv = process.env): LoadConfig {
  const baseUrl = env.LOAD_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error('LOAD_BASE_URL est obligatoire (aucune valeur par defaut : on ne vise jamais la prod par accident)');
  }
  const positive = (v: number) => v > 0;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    steps: parseSteps(env.LOAD_STEPS ?? '50,100,200,400,800,1000'),
    stepSeconds: readNumber(env, 'LOAD_STEP_SECONDS', 60, positive, 'nombre de secondes > 0'),
    warmupSeconds: readNumber(env, 'LOAD_WARMUP_SECONDS', 10, (v) => v >= 0, 'nombre de secondes >= 0'),
    windowSeconds: readNumber(env, 'LOAD_WINDOW_SECONDS', 10, positive, 'nombre de secondes > 0'),
    actors: readNumber(env, 'LOAD_ACTORS', 200, (v) => Number.isInteger(v) && v >= 2, 'entier >= 2'),
    maxInFlight: readNumber(env, 'LOAD_MAX_IN_FLIGHT', 2000, (v) => Number.isInteger(v) && v > 0, 'entier > 0'),
    timeoutMs: readNumber(env, 'LOAD_TIMEOUT_MS', 10_000, positive, 'millisecondes > 0'),
    abortErrorRate: readNumber(env, 'LOAD_ABORT_ERROR_RATE', 0.05, (v) => v > 0 && v <= 1, 'ratio entre 0 et 1'),
    abortP95Ms: readNumber(env, 'LOAD_ABORT_P95_MS', 2000, positive, 'millisecondes > 0'),
    abortWindows: readNumber(env, 'LOAD_ABORT_WINDOWS', 2, (v) => Number.isInteger(v) && v > 0, 'entier > 0'),
    mix: parseMix(env.LOAD_MIX ?? DEFAULT_MIX),
    accessHeaders: parseAccessHeaders(env),
    confirmEachStep: (env.LOAD_CONFIRM ?? 'true').toLowerCase() !== 'false',
    reportPath: env.LOAD_REPORT_PATH?.trim() || 'load-report.json',
  };
}
