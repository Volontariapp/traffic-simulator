import type { UserAuthCredentials } from '../../clients/api-client.js';
import { PARIS_DISTRICTS } from '../../geo/paris-districts.js';
import type { LoadResponse, LoadSender } from '../load-http.js';
import { pickRoute, type LoadTarget, type TargetPlanner } from '../load-request.js';
import { isAppReadRoute, type AppReadRoute } from './app-profile.js';
import { isExecutableWrite, type ExecutableWrite, type WritePlanner } from './write-planner.js';
import { IdPool } from './id-pool.js';

/** Valeurs de nativapp (origin/main) reprises telles quelles. */
const FEED_PAGE_LIMIT = 10; // use-home-screen.ts
const EVENTS_PAGE_LIMIT = 20; // use-swipe-screen.ts
const LIVE_SEARCH_RADIUS_M = 2000; // live-events.utils.ts
const LIVE_SEARCH_LIMIT = 30;
const LIVE_START_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const COMMENTS_PAGE_SIZE = 10; // use-infinite-comments.ts
const LIKES_SUMMARY_IDS = 10; // une page de l'accueil
const EVENT_STATE_PUBLISHED = 2; // @volontariapp/contracts EventState
const EVENT_STATE_IN_PROGRESS = 3;

/** Route de liste qui fournit les identifiants d'une route de detail encore sans cible. */
const POST_SOURCE: AppReadRoute = 'ranking-feed';
const EVENT_SOURCE: AppReadRoute = 'ranking-events';

export interface AppPlannerOptions {
  mix: readonly { route: AppReadRoute | ExecutableWrite; weight: number }[];
  /** Ecritures du pool load : obligatoire des qu'une route d'ecriture est dans le melange. */
  writes?: WritePlanner;
  actors: readonly UserAuthCredentials[];
  /** Horloge des dates de recherche, en millisecondes, injectable pour les tests. */
  nowMs?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function listOf(body: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(body)) return [];
  const list = body[key];
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

function flatPage(page: number, limit: number): string {
  return `page=${page}&limit=${limit}`;
}

function nestedPage(page: number, limit: number): string {
  return `pagination[page]=${page}&pagination[limit]=${limit}`;
}

/**
 * Mode `app` (lectures) : chaque route reproduit une requete de nativapp. Les routes de detail
 * visent un post, un event ou un utilisateur vu dans une reponse precedente ; sans cible connue,
 * la requete part sur la liste qui en fournit (et compte sous le nom de cette liste).
 */
export class AppPlanner implements TargetPlanner {
  readonly posts = new IdPool();
  readonly events = new IdPool();
  readonly users = new IdPool();
  private readonly nowMs: () => number;

  constructor(private readonly options: AppPlannerOptions) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    for (const actor of options.actors) this.users.add(actor.id);
    if (!options.writes && options.mix.some((m) => isExecutableWrite(m.route))) {
      throw new Error('Ecritures dans le melange sans pool de charge');
    }
  }

  describe(): string {
    const label = this.options.writes ? 'lectures et ecritures' : 'lectures';
    return `app-v1 ${label} : ${this.options.mix.map((m) => `${m.route}:${m.weight}`).join(',')}`;
  }

  /** Type d'une route pour le rapport : `write` ou `read`. */
  kindOf(route: string): 'read' | 'write' {
    return isExecutableWrite(route) ? 'write' : 'read';
  }

  pick(rng: () => number): string {
    return pickRoute(this.options.mix, rng);
  }

  build(route: string, actor: UserAuthCredentials, rng: () => number): LoadTarget {
    if (isExecutableWrite(route) && this.options.writes) return this.options.writes.build(route, rng);
    if (!isAppReadRoute(route)) throw new Error(`Route d'app inconnue : ${route}`);
    const page = 1 + Math.floor(rng() * 3);
    switch (route) {
      case 'ranking-feed':
        return { route, path: `/ranking/feed?limit=${FEED_PAGE_LIMIT}`, harvest: true };
      case 'ranking-events':
        return { route, path: `/ranking/events?limit=${EVENTS_PAGE_LIMIT}`, harvest: true };
      case 'likes-summary': {
        const postIds = this.posts.sample(LIKES_SUMMARY_IDS, rng);
        if (postIds.length === 0) return this.build(POST_SOURCE, actor, rng);
        return { route, path: '/social/likes-summary', method: 'POST', body: { postIds } };
      }
      case 'events-search-app':
        return { route, path: this.eventsSearchPath(page, rng), harvest: true };
      case 'me':
        return { route, path: '/users/me' };
      case 'event-detail': {
        const id = this.events.pick(rng);
        return id ? { route, path: `/events/${id}` } : this.build(EVENT_SOURCE, actor, rng);
      }
      case 'comments-list': {
        const id = this.posts.pick(rng);
        return id
          ? { route, path: `/posts/${id}/comments?${flatPage(1, COMMENTS_PAGE_SIZE)}` }
          : this.build(POST_SOURCE, actor, rng);
      }
      case 'event-participants': {
        const id = this.events.pick(rng);
        return id
          ? { route, path: `/users/event/${id}/participants?${nestedPage(1, 20)}` }
          : this.build(EVENT_SOURCE, actor, rng);
      }
      case 'related-posts': {
        const id = this.events.pick(rng);
        return id
          ? { route, path: `/social/events/${id}/related-posts?${nestedPage(1, 10)}` }
          : this.build(EVENT_SOURCE, actor, rng);
      }
      case 'is-following':
        return { route, path: `/social/users/${this.userFor(rng)}/is-following` };
      case 'public-user':
        return { route, path: `/users/${this.userFor(rng)}/public` };
      case 'my-events': {
        const list = ['created', 'participated', 'wished'][Math.floor(rng() * 3)];
        return { route, path: `/events/${list}/me?${flatPage(1, EVENTS_PAGE_LIMIT)}` };
      }
      case 'posts-list':
        return { route, path: `/posts?${flatPage(page, FEED_PAGE_LIMIT)}`, harvest: true };
      case 'follows-followers': {
        const list = rng() < 0.5 ? 'follows' : 'followers';
        return { route, path: `/social/${list}?${nestedPage(1, 20)}` };
      }
      case 'leaderboard':
        return rng() < 0.5
          ? { route, path: '/users/leaderboard?scope=global&limit=20' }
          : { route, path: '/users/me/rank?scope=global' };
      case 'my-misc': {
        const pick = Math.floor(rng() * 3);
        if (pick === 0) return { route, path: `/social/posts/me?${nestedPage(1, 10)}` };
        if (pick === 1) return { route, path: '/social/likes' };
        return { route, path: '/users/me/badges/progress' };
      }
    }
  }

  observe(target: LoadTarget, response: LoadResponse): void {
    if (this.options.writes && isExecutableWrite(target.route)) {
      this.options.writes.observe(target, response);
      return;
    }
    if (response.body === undefined) return;
    for (const post of listOf(response.body, 'posts')) {
      this.posts.add(post.id);
      this.users.add(post.authorId);
      if (isRecord(post.event)) this.events.add(post.event.id);
    }
    for (const event of listOf(response.body, 'events')) {
      this.events.add(event.id);
      this.users.add(event.organizerId);
    }
  }

  private userFor(rng: () => number): string {
    // Le pool contient au moins les acteurs : jamais vide
    return this.users.pick(rng) ?? this.options.actors[0].id;
  }

  /**
   * Moitie repli du swipe (use-swipe-screen.ts), moitie carte en direct autour d'un arrondissement
   * (use-nearest-live-events.ts) : deux requetes de recherche que l'app envoie vraiment.
   */
  private eventsSearchPath(page: number, rng: () => number): string {
    const params = new URLSearchParams();
    if (rng() < 0.5) {
      params.set('page', String(page));
      params.set('limit', String(EVENTS_PAGE_LIMIT));
      params.set('excludeCreatedByMe', 'true');
      params.set('excludeWishedByMe', 'true');
      params.set('excludeParticipatedByMe', 'true');
      params.set('statuses', String(EVENT_STATE_PUBLISHED));
      params.set('startDateFrom', new Date(this.nowMs()).toISOString());
    } else {
      const now = this.nowMs();
      const district = PARIS_DISTRICTS[Math.floor(rng() * PARIS_DISTRICTS.length)];
      params.set('area[center][latitude]', String(district.lat));
      params.set('area[center][longitude]', String(district.lng));
      params.set('area[radiusMeters]', String(LIVE_SEARCH_RADIUS_M));
      params.set('statuses', `${EVENT_STATE_PUBLISHED},${EVENT_STATE_IN_PROGRESS}`);
      params.set('startDateFrom', new Date(now - LIVE_START_LOOKBACK_MS).toISOString());
      params.set('startDateTo', new Date(now).toISOString());
      params.set('endAtFrom', new Date(now).toISOString());
      params.set('onlyAvailable', 'false');
      params.set('excludeBlockedUsers', 'true');
      params.set('excludeParticipatedByMe', 'true');
      params.set('excludeCreatedByMe', 'true');
      params.set('page', '1');
      params.set('limit', String(LIVE_SEARCH_LIMIT));
    }
    return `/events?${params.toString()}`;
  }
}

const PRIME_ROUTES: readonly AppReadRoute[] = ['ranking-feed', 'ranking-events', 'posts-list', 'events-search-app'];

/**
 * Avant le premier palier, hors mesure : quelques listes lues par les premiers acteurs remplissent
 * les pools d'identifiants, pour que les routes de detail aient une cible des la premiere seconde.
 * Retourne le nombre de requetes envoyees.
 */
export async function primeAppPlanner(
  planner: AppPlanner,
  send: LoadSender,
  actors: readonly UserAuthCredentials[],
  rng: () => number = Math.random,
  actorCount = 5,
): Promise<number> {
  let sent = 0;
  for (const actor of actors.slice(0, actorCount)) {
    for (const route of PRIME_ROUTES) {
      const target = planner.build(route, actor, rng);
      const response = await send(target, actor.accessToken);
      planner.observe(target, response);
      sent += 1;
    }
  }
  return sent;
}
