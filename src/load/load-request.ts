import type { LoadRouteName, RouteWeight } from './load-config.js';

export interface LoadTarget {
  route: LoadRouteName;
  /** Chemin relatif a la base /api/v1, query comprise. */
  path: string;
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
export function pickRoute(mix: readonly RouteWeight[], rng: () => number): LoadRouteName {
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
