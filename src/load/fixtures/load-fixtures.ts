import type { ApiClient, UserAuthCredentials } from '../../clients/api-client.js';
import { PARIS_DISTRICTS } from '../../geo/paris-districts.js';

export type FixtureApi = Pick<
  ApiClient,
  | 'createEvent'
  | 'deleteEvent'
  | 'listMySocialEventIds'
  | 'getEventTitle'
  | 'eventNodeExists'
  | 'listMyFollowIds'
  | 'unfollowUser'
  | 'unwishEvent'
  | 'unparticipateEvent'
  | 'listMyPostIds'
  | 'deletePost'
>;

/** Prefixe des events de fixture : c'est lui qui les distingue de tout autre event du compte. */
export const LOAD_EVENT_TITLE_PREFIX = '[charge] ';

export interface FixtureOptions {
  /** Events de fixture a garantir (crees une fois, reutilises d'un essai a l'autre). */
  eventCount: number;
  /** Attente maximale du noeud social d'un event cree (cree en asynchrone). */
  nodeTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface CleanupOptions {
  dryRun: boolean;
  /** Supprime aussi les events de fixture (sinon ils sont gardes pour le prochain essai). */
  purgeEvents: boolean;
  concurrency?: number;
}

export interface CleanupCounts {
  /** Posts des comptes load (texte seul, crees par post-cycle) : toujours supprimes. */
  posts: number;
  follows: number;
  wishes: number;
  participations: number;
  events: number;
}

export interface CleanupReport {
  dryRun: boolean;
  /** Objets du pool trouves (et retires, hors dry-run). */
  found: CleanupCounts;
  /** Relecture apres nettoyage : tout doit etre a 0 (hors dry-run). */
  remaining: CleanupCounts;
  /** Relations vers des objets hors du pool : jamais touchees, seulement signalees. */
  foreign: CleanupCounts;
  failures: number;
}

const ZERO: CleanupCounts = { posts: 0, follows: 0, wishes: 0, participations: 0, events: 0 };
const DAY_MS = 24 * 60 * 60 * 1000;

function add(a: CleanupCounts, b: Partial<CleanupCounts>): CleanupCounts {
  return {
    posts: a.posts + (b.posts ?? 0),
    follows: a.follows + (b.follows ?? 0),
    wishes: a.wishes + (b.wishes ?? 0),
    participations: a.participations + (b.participations ?? 0),
    events: a.events + (b.events ?? 0),
  };
}

async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

/**
 * Objets que la rampe ecrit en production, tous rattaches au pool `load.NNNN` :
 * - des events de fixture en DRAFT (etat par defaut a la creation), invisibles des vrais
 *   utilisateurs (le ranking ne propose que les events publies), sur lesquels wish et participate
 *   fonctionnent (ms-social ne verifie que l'existence du noeud) ;
 * - les follows, souhaits et participations des comptes load, qui ne visent que des objets du pool.
 * Le nettoyage se rejoue sans effet de bord et ne touche jamais un objet hors du pool.
 */
export class LoadFixtures {
  constructor(
    private readonly api: FixtureApi,
    private readonly actors: readonly UserAuthCredentials[],
  ) {}

  /** Organisateur des events de fixture : le premier compte du pool. */
  private get organizer(): UserAuthCredentials {
    const first = this.actors[0];
    if (!first) throw new Error('Pool de charge vide');
    return first;
  }

  /** Events de fixture existants (lecture seule). */
  async findEvents(): Promise<string[]> {
    const token = this.organizer.accessToken;
    const created = await this.api.listMySocialEventIds(token, 'created');
    if (!created) throw new Error('Lecture des events du pool impossible');
    const titles = await Promise.all(created.map((id) => this.api.getEventTitle(token, id)));
    return created.filter((_, i) => titles[i]?.startsWith(LOAD_EVENT_TITLE_PREFIX) === true);
  }

  /** Garantit `eventCount` events de fixture prets (noeud social cree). Retourne leurs identifiants. */
  async ensureEvents(options: FixtureOptions): Promise<string[]> {
    const log = options.log ?? (() => undefined);
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const ids = await this.findEvents();
    const created: string[] = [];
    for (let index = ids.length; index < options.eventCount; index++) {
      const venue = PARIS_DISTRICTS[index % PARIS_DISTRICTS.length];
      const startAt = now() + 60 * DAY_MS;
      const id = await this.api.createEvent(this.organizer.accessToken, {
        title: `${LOAD_EVENT_TITLE_PREFIX}fixture ${index + 1}`,
        description: 'Event de test de charge, jamais publie. Ne pas modifier.',
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(startAt + 2 * 60 * 60 * 1000).toISOString(),
        localisationName: venue.address,
        type: 'EVENT_TYPE_SOCIAL',
        maxParticipants: 1000,
      });
      if (!id) throw new Error(`Creation de l'event de fixture ${index + 1} refusee`);
      created.push(id);
      log(`[load:setup] event de fixture cree : ${id}`);
    }

    const deadline = now() + (options.nodeTimeoutMs ?? 60_000);
    for (const id of created) {
      while (!(await this.api.eventNodeExists(this.organizer.accessToken, id))) {
        if (now() >= deadline) throw new Error(`Noeud social de l'event ${id} absent apres l'attente`);
        await sleep(options.pollMs ?? 1000);
      }
    }
    const all = [...ids, ...created];
    // Garde-fou : un event cree mais introuvable relancerait une creation a chaque essai
    const visible = new Set(await this.findEvents());
    const missing = all.filter((id) => !visible.has(id));
    if (missing.length > 0) throw new Error(`Events de fixture crees mais introuvables : ${missing.join(', ')}`);
    return all;
  }

  /**
   * Retire les follows, souhaits et participations du pool (et les events de fixture avec
   * `purgeEvents`), puis relit tout pour verifier qu'il ne reste rien.
   */
  async cleanup(options: CleanupOptions): Promise<CleanupReport> {
    const fixtureIds = new Set(await this.findEvents());
    const poolIds = new Set(this.actors.map((actor) => actor.id));
    const concurrency = options.concurrency ?? 10;
    let found: CleanupCounts = { ...ZERO };
    let foreign: CleanupCounts = { ...ZERO };
    let failures = 0;

    const removeAll = async (ids: string[], remove: (id: string) => Promise<boolean>): Promise<void> => {
      if (options.dryRun) return;
      for (const id of ids) {
        if (!(await remove(id))) failures += 1;
      }
    };

    await inBatches(this.actors, concurrency, async (actor) => {
      const token = actor.accessToken;
      const follows = (await this.api.listMyFollowIds(token)) ?? [];
      const wished = (await this.api.listMySocialEventIds(token, 'wished')) ?? [];
      const joined = (await this.api.listMySocialEventIds(token, 'participated')) ?? [];

      const ownFollows = follows.filter((id) => poolIds.has(id));
      const ownWishes = wished.filter((id) => fixtureIds.has(id));
      const ownJoins = joined.filter((id) => fixtureIds.has(id));
      const posts = (await this.api.listMyPostIds(token)) ?? [];
      found = add(found, {
        posts: posts.length,
        follows: ownFollows.length,
        wishes: ownWishes.length,
        participations: ownJoins.length,
      });
      foreign = add(foreign, {
        follows: follows.length - ownFollows.length,
        wishes: wished.length - ownWishes.length,
        participations: joined.length - ownJoins.length,
      });

      await removeAll(ownFollows, (id) => this.api.unfollowUser(token, id));
      await removeAll(ownWishes, (id) => this.api.unwishEvent(token, id));
      await removeAll(ownJoins, (id) => this.api.unparticipateEvent(token, id));
      // Un post supprime emporte ses likes et commentaires
      await removeAll(posts, (id) => this.api.deletePost(token, id));
    });

    if (options.purgeEvents) {
      found = add(found, { events: fixtureIds.size });
      await removeAll([...fixtureIds], (id) => this.api.deleteEvent(this.organizer.accessToken, id));
    }

    const remaining = options.dryRun ? found : await this.count(fixtureIds, poolIds, options);
    return { dryRun: options.dryRun, found, remaining, foreign, failures };
  }

  private async count(
    fixtureIds: ReadonlySet<string>,
    poolIds: ReadonlySet<string>,
    options: CleanupOptions,
  ): Promise<CleanupCounts> {
    let remaining: CleanupCounts = { ...ZERO };
    await inBatches(this.actors, options.concurrency ?? 10, async (actor) => {
      const token = actor.accessToken;
      const follows = (await this.api.listMyFollowIds(token)) ?? [];
      const wished = (await this.api.listMySocialEventIds(token, 'wished')) ?? [];
      const joined = (await this.api.listMySocialEventIds(token, 'participated')) ?? [];
      const posts = (await this.api.listMyPostIds(token)) ?? [];
      remaining = add(remaining, {
        posts: posts.length,
        follows: follows.filter((id) => poolIds.has(id)).length,
        wishes: wished.filter((id) => fixtureIds.has(id)).length,
        participations: joined.filter((id) => fixtureIds.has(id)).length,
      });
    });
    if (options.purgeEvents) {
      remaining = add(remaining, { events: (await this.findEvents()).length });
    }
    return remaining;
  }
}
