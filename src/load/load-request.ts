import type { UserAuthCredentials } from '../clients/api-client.js';
import type { LoadRouteName, RouteWeight } from './load-config.js';
import type { LoadResponse } from './load-http.js';

export type LoadMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface LoadTarget {
  /** Nom de la route dans le rapport (mode `routes` ou `app`). */
  route: string;
  /** Chemin relatif a la base /api/v1, query comprise. */
  path: string;
  /** Absent : GET (toutes les routes du mode `routes`). */
  method?: LoadMethod;
  /** Corps JSON, envoye avec `Content-Type: application/json`. */
  body?: unknown;
  /** Vrai : le sender decode la reponse JSON et la rend dans `LoadResponse.body`. */
  harvest?: boolean;
  /** Jeton d'un autre compte que l'acteur tire (ecritures : pool `load.NNNN`). */
  token?: string;
}

/**
 * Ce que le runner demande a chaque requete : quelle route (tiree avant le controle des requetes
 * en vol, pour compter un `dropped` sous son nom), puis la requete de l'acteur tire.
 */
export interface TargetPlanner {
  /** Melange affiche dans le rapport. */
  describe(): string;
  pick(rng: () => number): string;
  build(route: string, actor: UserAuthCredentials, rng: () => number): LoadTarget;
  /** Reponse recue (corps decode si `harvest`). */
  observe?(target: LoadTarget, response: LoadResponse): void;
}

/**
 * Union des filtres de use-swipe-screen.ts et use-nearest-live-events.ts (nativapp) : le cas le
 * plus couteux pour la gateway, qui relit ces listes dans ms-social a chaque requete.
 */
const APP_EVENT_FILTERS = [
  'excludeBlockedUsers',
  'excludeParticipatedByMe',
  'excludeCreatedByMe',
  'excludeWishedByMe',
]
  .map((flag) => `${flag}=true`)
  .join('&');

/** Tirage pondere. `rng` retourne un nombre dans [0, 1). */
export function pickRoute<R extends string>(mix: readonly { route: R; weight: number }[], rng: () => number): R {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * total;
  for (const entry of mix) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.route;
  }
  return mix[mix.length - 1].route;
}

/**
 * Lectures seules : une rampe de charge ne doit pas faire grossir les bases. La page varie (1 a 3)
 * pour ne pas mesurer uniquement un cache chaud sur une requete identique.
 */
export function buildTarget(route: LoadRouteName, peerUserId: string, rng: () => number): LoadTarget {
  const page = 1 + Math.floor(rng() * 3);
  switch (route) {
    case 'events-list':
      return { route, path: `/events?page=${page}&limit=20` };
    case 'events-list-app':
      return { route, path: `/events?page=${page}&limit=20&${APP_EVENT_FILTERS}` };
    case 'posts-list':
      return { route, path: `/posts?page=${page}&limit=20` };
    case 'me':
      return { route, path: '/users/me' };
    case 'is-following':
      return { route, path: `/social/users/${peerUserId}/is-following` };
  }
}

/**
 * Mode `routes` : les 5 routes de reference, tirage pondere par `LOAD_MIX`. Ordre des tirages
 * inchange depuis la premiere version (route, acteur, pair, page) : les rampes restent comparables.
 */
export function createRoutesPlanner(
  mix: readonly RouteWeight[],
  actors: readonly UserAuthCredentials[],
): TargetPlanner {
  return {
    describe: () => mix.map((m) => `${m.route}:${m.weight}`).join(','),
    pick: (rng) => pickRoute(mix, rng),
    build: (route, _actor, rng) => {
      const peer = actors[Math.floor(rng() * actors.length)];
      const known = mix.find((m) => m.route === route);
      if (!known) throw new Error(`Route hors du melange : ${route}`);
      return buildTarget(known.route, peer.id, rng);
    },
  };
}
