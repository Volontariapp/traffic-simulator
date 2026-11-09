/**
 * Melange `app-v1` : toutes les actions d'un utilisateur de nativapp, poids sur 100. Proportions
 * HYPOTHETIQUES, deduites des parcours de l'app (accueil sur /ranking/feed, swipe sur
 * /ranking/events, resume des likes par page, detail, commentaires, profils), a recaler sur les
 * hits par route de Datadog. Les ecritures sont decrites ici mais pas encore executables : elles
 * arrivent avec le pool `load.NNNN` et le nettoyage, et sont retirees du tirage en attendant.
 */
export const APP_READ_ROUTES = [
  'ranking-feed',
  'likes-summary',
  'ranking-events',
  'events-search-app',
  'me',
  'event-detail',
  'comments-list',
  'event-participants',
  'is-following',
  'public-user',
  'my-events',
  'posts-list',
  'related-posts',
  'follows-followers',
  'leaderboard',
  'my-misc',
] as const;
export type AppReadRoute = (typeof APP_READ_ROUTES)[number];

export const APP_WRITE_ROUTES = [
  'like-toggle',
  'wish-toggle',
  'pass-feedback',
  'comment-cycle',
  'follow-toggle',
  'location',
  'participate-toggle',
  'post-cycle',
  'ranking-refresh',
  'event-cycle',
] as const;
export type AppWriteRoute = (typeof APP_WRITE_ROUTES)[number];

export interface AppProfileEntry {
  route: AppReadRoute | AppWriteRoute;
  kind: 'read' | 'write';
  weight: number;
}

export const APP_V1: readonly AppProfileEntry[] = [
  { route: 'ranking-feed', kind: 'read', weight: 15 },
  { route: 'likes-summary', kind: 'read', weight: 10 },
  { route: 'ranking-events', kind: 'read', weight: 8 },
  { route: 'events-search-app', kind: 'read', weight: 8 },
  { route: 'me', kind: 'read', weight: 8 },
  { route: 'event-detail', kind: 'read', weight: 7 },
  { route: 'comments-list', kind: 'read', weight: 6 },
  { route: 'event-participants', kind: 'read', weight: 5 },
  { route: 'is-following', kind: 'read', weight: 4 },
  { route: 'public-user', kind: 'read', weight: 3 },
  { route: 'my-events', kind: 'read', weight: 3 },
  { route: 'posts-list', kind: 'read', weight: 2 },
  { route: 'related-posts', kind: 'read', weight: 2 },
  { route: 'follows-followers', kind: 'read', weight: 2 },
  { route: 'leaderboard', kind: 'read', weight: 2 },
  { route: 'my-misc', kind: 'read', weight: 3 },
  { route: 'like-toggle', kind: 'write', weight: 4 },
  { route: 'wish-toggle', kind: 'write', weight: 2 },
  { route: 'pass-feedback', kind: 'write', weight: 1.5 },
  { route: 'comment-cycle', kind: 'write', weight: 1 },
  { route: 'follow-toggle', kind: 'write', weight: 1 },
  // Exclus par defaut (decision du 2026-11-09) : position, creation d'event
  { route: 'location', kind: 'write', weight: 0 },
  { route: 'participate-toggle', kind: 'write', weight: 0.8 },
  { route: 'post-cycle', kind: 'write', weight: 0.4 },
  { route: 'ranking-refresh', kind: 'write', weight: 0.25 },
  { route: 'event-cycle', kind: 'write', weight: 0 },
];

export function isAppReadRoute(name: string): name is AppReadRoute {
  return (APP_READ_ROUTES as readonly string[]).includes(name);
}

export function isAppWriteRoute(name: string): name is AppWriteRoute {
  return (APP_WRITE_ROUTES as readonly string[]).includes(name);
}

/** Melange executable aujourd'hui : les lectures du profil, poids d'origine (le tirage normalise). */
export function executableMix(profile: readonly AppProfileEntry[]): { route: AppReadRoute; weight: number }[] {
  const mix: { route: AppReadRoute; weight: number }[] = [];
  for (const entry of profile) {
    if (entry.kind === 'read' && entry.weight > 0 && isAppReadRoute(entry.route)) {
      mix.push({ route: entry.route, weight: entry.weight });
    }
  }
  return mix;
}
