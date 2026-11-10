import {
  APP_V1,
  executableMix,
  isAppReadRoute,
  isAppWriteRoute,
  type AppReadRoute,
} from './app/app-profile.js';
import { DEFAULT_WRITES, isExecutableWrite, type ExecutableWrite } from './app/write-planner.js';

/**
 * `routes` : les 5 routes de reference, inchangees (comparables d'une rampe a l'autre).
 * `app` : toutes les lectures de nativapp, melange `app-v1` (src/load/app/app-profile.ts).
 */
export const LOAD_MODES = ['routes', 'app'] as const;
export type LoadMode = (typeof LOAD_MODES)[number];

/**
 * `events-list-app` reprend les filtres que nativapp envoie (exclusions personnelles et
 * utilisateurs bloques) : chacun coute des appels pagines a ms-social avant la recherche.
 */
export const LOAD_ROUTES = [
  'events-list',
  'events-list-app',
  'posts-list',
  'me',
  'is-following',
] as const;
export type LoadRouteName = (typeof LOAD_ROUTES)[number];

export interface RouteWeight {
  route: LoadRouteName;
  weight: number;
}

export interface AppRouteWeight {
  route: AppReadRoute | ExecutableWrite;
  weight: number;
}

export interface LoadConfig {
  mode: LoadMode;
  /** Gateway visee, suffixe /api/v1 ajoute si absent. */
  baseUrl: string;
  /** Debits cibles successifs, en requetes par seconde. */
  steps: number[];
  stepSeconds: number;
  /**
   * Montee lineaire de 0 au debit du palier, avant l'echauffement (0 : debit plein des la premiere
   * seconde, attaque brutale). Hors statistiques du palier, comme l'echauffement.
   */
  rampUpSeconds: number;
  warmupSeconds: number;
  /**
   * Debut de palier lu a part : les requetes lancees dans les N premieres secondes du palier
   * (montee et echauffement compris) ont leurs propres statistiques et une serie par seconde.
   * 0 : desactive. Sert a mesurer un demarrage a froid au lieu de le jeter.
   */
  onsetSeconds: number;
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
  /** Mode `routes` : melange de `LOAD_MIX` (ou le melange de reference). */
  mix: RouteWeight[];
  /** Mode `app` : lectures de `app-v1`, ou `LOAD_MIX` avec des noms de routes d'app. */
  appMix: AppRouteWeight[];
  /** Ecritures activees en mode app (`LOAD_WRITES`), toutes depuis le pool `load.NNNN`. */
  writes: ExecutableWrite[];
  /** Comptes du pool `load.NNNN` ouverts quand des ecritures sont activees. */
  poolActors: number;
  /** Sockets de la sonde asynchrone (premiers comptes load), si like ou commentaire sont actives. 0 : sans sonde. */
  probeSockets: number;
  /** Delai au-dela duquel un effet attendu est compte perdu. */
  probeLostAfterMs: number;
  abortAsyncP95Ms: number;
  abortAsyncLostRate: number;
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

export function parseMode(raw: string | undefined): LoadMode {
  const value = (raw ?? 'routes').trim();
  const mode = LOAD_MODES.find((m) => m === value);
  if (!mode) throw new Error(`LOAD_MODE=${raw} invalide : ${LOAD_MODES.join(' ou ')}`);
  return mode;
}

/**
 * `LOAD_WRITES` : absent ou `off`, lectures seules ; `default`, les ecritures invisibles des vrais
 * utilisateurs (souhait, participation, follow, passe) ; sinon une liste de routes d'ecriture.
 * Position et creation d'event sont refusees (exclues par decision).
 */
export function parseWrites(raw: string | undefined): ExecutableWrite[] {
  const value = (raw ?? 'off').trim();
  if (value === '' || value === 'off') return [];
  if (value === 'default') return [...DEFAULT_WRITES];
  const writes = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .flatMap((part) => (part === 'default' ? [...DEFAULT_WRITES] : [part]));
  for (const name of writes) {
    if (!isExecutableWrite(name)) {
      throw new Error(
        isAppWriteRoute(name)
          ? `LOAD_WRITES : "${name}" est exclue de la rampe (position, creation d'event)`
          : `LOAD_WRITES : "${name}" n'est pas une ecriture de l'app`,
      );
    }
  }
  return [...new Set(writes.filter(isExecutableWrite))];
}

/** Melange par defaut du mode app : lectures d'app-v1 et ecritures activees, poids du profil. */
export function defaultAppMix(writes: readonly ExecutableWrite[]): AppRouteWeight[] {
  const enabled = new Set<string>(writes);
  const writeMix = APP_V1.filter((entry) => enabled.has(entry.route) && entry.weight > 0).flatMap((entry) =>
    isExecutableWrite(entry.route) ? [{ route: entry.route, weight: entry.weight }] : [],
  );
  return [...executableMix(APP_V1), ...writeMix];
}

/** `LOAD_MIX` du mode `app` : une ecriture n'y est admise que si `LOAD_WRITES` l'active. */
export function parseAppMix(raw: string, writes: readonly ExecutableWrite[] = []): AppRouteWeight[] {
  const enabled = new Set<string>(writes);
  const mix = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [name, weightRaw] = part.split(':');
      const weight = Number(weightRaw);
      const isWrite = isExecutableWrite(name);
      if (isAppWriteRoute(name) && !(isWrite && enabled.has(name))) {
        throw new Error(`LOAD_MIX : "${name}" est une ecriture non activee (LOAD_WRITES)`);
      }
      if (!(isAppReadRoute(name) || isWrite) || !Number.isFinite(weight) || weight <= 0) {
        throw new Error(`LOAD_MIX entree "${part}" invalide en mode app : <route d'app>:<poids>`);
      }
      return { route: name, weight };
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
  const mode = parseMode(env.LOAD_MODE);
  const rawMix = env.LOAD_MIX;
  const writes = mode === 'app' ? parseWrites(env.LOAD_WRITES) : [];
  if (mode !== 'app' && env.LOAD_WRITES !== undefined && parseWrites(env.LOAD_WRITES).length > 0) {
    throw new Error('LOAD_WRITES ne vaut que pour LOAD_MODE=app');
  }
  return {
    mode,
    baseUrl: normalizeBaseUrl(baseUrl),
    steps: parseSteps(env.LOAD_STEPS ?? '50,100,200,400,800,1000'),
    stepSeconds: readNumber(env, 'LOAD_STEP_SECONDS', 60, positive, 'nombre de secondes > 0'),
    rampUpSeconds: readNumber(env, 'LOAD_RAMP_UP_SECONDS', 0, (v) => v >= 0, 'nombre de secondes >= 0'),
    warmupSeconds: readNumber(env, 'LOAD_WARMUP_SECONDS', 10, (v) => v >= 0, 'nombre de secondes >= 0'),
    onsetSeconds: readNumber(env, 'LOAD_ONSET_SECONDS', 0, (v) => Number.isInteger(v) && v >= 0, 'entier >= 0'),
    windowSeconds: readNumber(env, 'LOAD_WINDOW_SECONDS', 10, positive, 'nombre de secondes > 0'),
    actors: readNumber(env, 'LOAD_ACTORS', 200, (v) => Number.isInteger(v) && v >= 2, 'entier >= 2'),
    maxInFlight: readNumber(env, 'LOAD_MAX_IN_FLIGHT', 2000, (v) => Number.isInteger(v) && v > 0, 'entier > 0'),
    timeoutMs: readNumber(env, 'LOAD_TIMEOUT_MS', 10_000, positive, 'millisecondes > 0'),
    abortErrorRate: readNumber(env, 'LOAD_ABORT_ERROR_RATE', 0.05, (v) => v > 0 && v <= 1, 'ratio entre 0 et 1'),
    abortP95Ms: readNumber(env, 'LOAD_ABORT_P95_MS', 2000, positive, 'millisecondes > 0'),
    abortWindows: readNumber(env, 'LOAD_ABORT_WINDOWS', 2, (v) => Number.isInteger(v) && v > 0, 'entier > 0'),
    // Mode routes : lecture de LOAD_MIX strictement identique a la premiere version
    mix: parseMix(mode === 'routes' ? (rawMix ?? DEFAULT_MIX) : DEFAULT_MIX),
    appMix: mode === 'app' && rawMix !== undefined ? parseAppMix(rawMix, writes) : defaultAppMix(writes),
    writes,
    poolActors: readNumber(env, 'LOAD_POOL_ACTORS', 200, (v) => Number.isInteger(v) && v >= 2, 'entier >= 2'),
    probeSockets: readNumber(env, 'LOAD_PROBE_SOCKETS', 20, (v) => Number.isInteger(v) && v >= 0, 'entier >= 0'),
    probeLostAfterMs: readNumber(env, 'LOAD_PROBE_LOST_AFTER_MS', 60_000, positive, 'millisecondes > 0'),
    abortAsyncP95Ms: readNumber(env, 'LOAD_ABORT_ASYNC_P95_MS', 30_000, positive, 'millisecondes > 0'),
    abortAsyncLostRate: readNumber(env, 'LOAD_ABORT_ASYNC_LOST_RATE', 0.02, (v) => v > 0 && v <= 1, 'ratio entre 0 et 1'),
    accessHeaders: parseAccessHeaders(env),
    confirmEachStep: (env.LOAD_CONFIRM ?? 'true').toLowerCase() !== 'false',
    reportPath: env.LOAD_REPORT_PATH?.trim() || 'load-report.json',
  };
}
