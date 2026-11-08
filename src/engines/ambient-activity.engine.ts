import type { ActorPool } from '../actors/actor-pool.js';
import type { ApiClient } from '../clients/api-client.js';
import type { AmbientConfig } from '../config/simulator-config.js';
import { commentPoolFor } from './comment-corpus.js';

export type AmbientApi = Pick<ApiClient, 'listPosts' | 'likePost' | 'createComment'>;
export type AmbientActors = Pick<ActorPool, 'getAllActors' | 'isSimulatedUser'>;
/** Comptes qu'un acteur suit (graphe de follow) : ses posts sont plus souvent likes et commentes. */
export type FollowLookup = (actorId: string) => ReadonlySet<string>;

interface TrackedPost {
  id: string;
  title: string;
  authorId: string;
  likers: Set<string>;
  commenters: Set<string>;
  usedComments: Set<string>;
}

type ActionKind = 'like' | 'comment';

interface Action {
  kind: ActionKind;
  actorToken: string;
  post: TrackedPost;
  text?: string;
}

const POST_REFRESH_MS = 15_000;
const POST_PAGE_SIZE = 50;
/** Un tick ne rattrape jamais plus de ce delai : pas de rafale apres une longue pause du process. */
const MAX_CATCH_UP_MS = 5_000;
/** Un post suivi par l'acteur pese autant de fois plus dans le tirage. */
const FOLLOWED_AUTHOR_WEIGHT = 4;
const PICK_ATTEMPTS = 8;
const STATS_LOG_MS = 60_000;
const NO_FOLLOWS: ReadonlySet<string> = new Set();

/**
 * Activite de fond : des acteurs likent et commentent en continu les posts des simulateurs
 * (events parisiens et locaux), pour que chaque post ait un nombre de reactions realiste.
 * Les posts de vrais utilisateurs sont exclus : `UserReactionEngine` s'en occupe, avec son propre
 * echeancier, et les deux moteurs ne doivent pas se marcher dessus.
 *
 * Debit continu (`actionsPerSec`) plus rafales periodiques (`burstSize`) pour reproduire des pics
 * d'utilisateurs simultanes. Toute action est plafonnee par `maxConcurrency` appels simultanes.
 */
export class AmbientActivityEngine {
  private posts = new Map<string, TrackedPost>();
  private lastTickAt: number;
  private lastRefreshAt = 0;
  private nextBurstAt: number;
  private budget = 0;
  private stats = { likes: 0, comments: 0, failed: 0 };
  private lastStatsLogAt: number;

  constructor(
    private readonly api: AmbientApi,
    private readonly pool: AmbientActors,
    private readonly config: AmbientConfig,
    private readonly followsOf: FollowLookup = () => NO_FOLLOWS,
    private readonly rng: () => number = Math.random,
  ) {
    const now = Date.now();
    this.lastTickAt = now;
    this.lastStatsLogAt = now;
    this.nextBurstAt = now + config.burstIntervalMs;
  }

  /** Oublie les posts suivis (entree en sommeil) : au reveil, la liste est relue. */
  reset(): void {
    this.posts.clear();
    this.lastRefreshAt = 0;
    this.budget = 0;
    this.lastTickAt = Date.now();
    this.nextBurstAt = this.lastTickAt + this.config.burstIntervalMs;
  }

  getTrackedPostCount(): number {
    return this.posts.size;
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const elapsed = Math.min(Math.max(now - this.lastTickAt, 0), MAX_CATCH_UP_MS);
    this.lastTickAt = now;

    if (now - this.lastRefreshAt >= POST_REFRESH_MS) {
      this.lastRefreshAt = now;
      await this.refreshPosts();
    }

    this.budget += (this.config.actionsPerSec * elapsed) / 1000;
    let due = Math.floor(this.budget);
    this.budget -= due;

    if (this.config.burstSize > 0 && now >= this.nextBurstAt) {
      this.nextBurstAt = now + this.config.burstIntervalMs;
      due += this.config.burstSize;
      console.log(`[Ambient] Rafale : ${this.config.burstSize} actions (concurrence max ${this.config.maxConcurrency}).`);
    }

    if (due > 0 && this.posts.size > 0) await this.run(due);
    this.logStats(now);
  }

  /** Execute `count` actions par vagues de `maxConcurrency` appels simultanes. */
  private async run(count: number): Promise<void> {
    let remaining = count;
    while (remaining > 0) {
      const wave: Action[] = [];
      const size = Math.min(this.config.maxConcurrency, remaining);
      for (let i = 0; i < size; i++) {
        const action = this.chooseAction();
        if (action) wave.push(action);
      }
      remaining -= size;
      if (wave.length === 0) break; // plus rien d'inedit a faire sur les posts connus
      await Promise.allSettled(wave.map((action) => this.execute(action)));
    }
  }

  private chooseAction(): Action | undefined {
    const actors = this.pool.getAllActors();
    if (actors.length === 0) return undefined;

    const kind: ActionKind = this.rng() < this.config.commentRatio ? 'comment' : 'like';
    const open = [...this.posts.values()].filter((post) => this.hasRoom(post, kind));
    if (open.length === 0) return undefined;

    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      const actor = actors[Math.floor(this.rng() * actors.length)];
      const follows = this.followsOf(actor.id);
      const post = this.weightedPick(open, (p) => (follows.has(p.authorId) ? FOLLOWED_AUTHOR_WEIGHT : 1));
      if (post.authorId === actor.id) continue;

      const done = kind === 'like' ? post.likers : post.commenters;
      if (done.has(actor.id)) continue;
      // Reservation immediate : deux actions d'une meme vague ne ciblent jamais le meme couple
      done.add(actor.id);

      if (kind === 'like') return { kind, actorToken: actor.accessToken, post };
      return { kind, actorToken: actor.accessToken, post, text: this.commentFor(post) };
    }
    return undefined;
  }

  private hasRoom(post: TrackedPost, kind: ActionKind): boolean {
    return kind === 'like'
      ? post.likers.size < this.config.maxLikesPerPost
      : post.commenters.size < this.config.maxCommentsPerPost;
  }

  private weightedPick(posts: TrackedPost[], weightOf: (post: TrackedPost) => number): TrackedPost {
    const weights = posts.map(weightOf);
    let threshold = this.rng() * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < posts.length; i++) {
      threshold -= weights[i];
      if (threshold < 0) return posts[i];
    }
    return posts[posts.length - 1];
  }

  private commentFor(post: TrackedPost): string {
    const pool = commentPoolFor(post.title);
    const unused = pool.filter((text) => !post.usedComments.has(text));
    const source = unused.length > 0 ? unused : pool;
    const text = source[Math.floor(this.rng() * source.length)];
    post.usedComments.add(text);
    return text;
  }

  private async execute(action: Action): Promise<void> {
    const ok =
      action.kind === 'like'
        ? await this.api.likePost(action.actorToken, action.post.id, true)
        : await this.api.createComment(action.actorToken, action.post.id, action.text ?? '', true);
    if (!ok) this.stats.failed++;
    else if (action.kind === 'like') this.stats.likes++;
    else this.stats.comments++;
  }

  private async refreshPosts(): Promise<void> {
    const caller = this.pool.getAllActors()[0];
    if (!caller?.accessToken) return;

    try {
      const listed = await this.api.listPosts(caller.accessToken, { limit: POST_PAGE_SIZE }, true);
      const current = new Set<string>();
      for (const post of listed) {
        const authorId = post.authorId || post.userId;
        if (!post.id || !authorId || !this.pool.isSimulatedUser(authorId)) continue;
        current.add(post.id);
        if (!this.posts.has(post.id)) {
          this.posts.set(post.id, {
            id: post.id,
            title: post.title ?? '',
            authorId,
            likers: new Set(),
            commenters: new Set(),
            usedComments: new Set(),
          });
        }
      }
      // Un post sorti de la page ne reviendra pas : on borne la memoire
      for (const id of this.posts.keys()) {
        if (!current.has(id)) this.posts.delete(id);
      }
    } catch {
      // Erreur transitoire : la liste precedente reste utilisable, nouvelle tentative au prochain cycle
    }
  }

  private logStats(now: number): void {
    if (now - this.lastStatsLogAt < STATS_LOG_MS) return;
    this.lastStatsLogAt = now;
    const { likes, comments, failed } = this.stats;
    if (likes + comments + failed > 0) {
      console.log(
        `[Ambient] Derniere minute : ${likes} likes, ${comments} commentaires, ${failed} echecs sur ${this.posts.size} posts suivis.`,
      );
    }
    this.stats = { likes: 0, comments: 0, failed: 0 };
  }
}
