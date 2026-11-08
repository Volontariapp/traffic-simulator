import type { ActorPool } from '../actors/actor-pool.js';
import type { ApiClient, UserAuthCredentials } from '../clients/api-client.js';
import type { SocialConfig } from '../config/simulator-config.js';
import { buildFollowPlan, type FollowEdge } from '../social/follow-plan.js';

export type SocialApi = Pick<ApiClient, 'followUser' | 'isFollowing'>;
export type SocialActors = Pick<ActorPool, 'getAllActors'>;

export interface SocialSyncResult {
  /** Plan juge deja applique (liens sentinelles presents) : aucun appel d'ecriture. */
  skipped: boolean;
  created: number;
  existing: number;
  failed: number;
}

const PROGRESS_LOG_EVERY = 2000;
const PAUSE_POLL_MS = 5_000;

/**
 * Graphe de follow entre les acteurs du pool principal. Le plan est deterministe (voir
 * `buildFollowPlan`) : un redeploiement retrouve les memes liens, et `sync` ne reecrit rien
 * quand trois liens sentinelles (premier, milieu, dernier) existent deja.
 */
export class SocialGraphEngine {
  private plan: FollowEdge[] = [];
  private follows = new Map<string, Set<string>>();
  private actorsById = new Map<string, UserAuthCredentials>();
  private stopped = false;

  constructor(
    private readonly api: SocialApi,
    private readonly pool: SocialActors,
    private readonly config: SocialConfig,
  ) {}

  /** Construit le plan en memoire. A appeler apres l'initialisation du pool. */
  prepare(): number {
    const actors = this.pool.getAllActors();
    this.actorsById = new Map(actors.map((a) => [a.id, a]));
    this.plan = buildFollowPlan({
      participants: actors.map((a) => ({ id: a.id, key: a.email })),
      follows: { min: this.config.followsMin, max: this.config.followsMax },
      reciprocity: this.config.reciprocity,
    });
    this.follows = new Map();
    for (const edge of this.plan) {
      const set = this.follows.get(edge.followerId) ?? new Set<string>();
      set.add(edge.followedId);
      this.follows.set(edge.followerId, set);
    }
    return this.plan.length;
  }

  /** Comptes que suit un acteur selon le plan (sert a orienter ses likes et commentaires). */
  followsOf(actorId: string): ReadonlySet<string> {
    return this.follows.get(actorId) ?? EMPTY_SET;
  }

  getPlannedEdgeCount(): number {
    return this.plan.length;
  }

  stop(): void {
    this.stopped = true;
  }

  /**
   * Applique le plan par lots. `canRun` suspend l'ecriture (fenetre de sommeil) : elle reprend ensuite.
   * Un 409 (lien deja present) compte comme `existing`, pas comme une erreur.
   */
  async sync(canRun: () => boolean = () => true): Promise<SocialSyncResult> {
    const result: SocialSyncResult = { skipped: false, created: 0, existing: 0, failed: 0 };
    if (this.plan.length === 0) return { ...result, skipped: true };

    if (!this.config.forceSync && (await this.sentinelsPresent())) {
      return { ...result, skipped: true };
    }

    const { concurrency, pauseMs } = this.config;
    let nextLog = PROGRESS_LOG_EVERY;

    for (let i = 0; i < this.plan.length && !this.stopped; i += concurrency) {
      while (!canRun() && !this.stopped) await sleep(PAUSE_POLL_MS);
      if (this.stopped) break;

      const batch = this.plan.slice(i, i + concurrency);
      const outcomes = await Promise.all(batch.map((edge) => this.applyEdge(edge)));
      let wrote = false;
      for (const outcome of outcomes) {
        result[outcome]++;
        if (outcome !== 'existing') wrote = true;
      }

      const done = i + batch.length;
      if (done >= nextLog) {
        nextLog += PROGRESS_LOG_EVERY;
        console.log(
          `[SocialGraph] ${done}/${this.plan.length} liens traites (${result.created} crees, ${result.existing} existants, ${result.failed} echecs).`,
        );
      }
      if (wrote && pauseMs > 0 && done < this.plan.length) await sleep(pauseMs);
    }
    return result;
  }

  private async applyEdge(edge: FollowEdge): Promise<'created' | 'existing' | 'failed'> {
    const follower = this.actorsById.get(edge.followerId);
    if (!follower) return 'failed';
    const outcome = await this.api.followUser(follower.accessToken, edge.followedId);
    return outcome === 'exists' ? 'existing' : outcome;
  }

  private async sentinelsPresent(): Promise<boolean> {
    const sentinels = [
      ...new Set([this.plan[0], this.plan[Math.floor(this.plan.length / 2)], this.plan[this.plan.length - 1]]),
    ];
    const checks = await Promise.all(
      sentinels.map(async (edge) => {
        const follower = this.actorsById.get(edge.followerId);
        if (!follower) return false;
        return (await this.api.isFollowing(follower.accessToken, edge.followedId)) === true;
      }),
    );
    return checks.every(Boolean);
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
