import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient } from '../clients/api-client.js';
import type { ActorPool } from '../actors/actor-pool.js';
import type { ReactionConfig } from '../config/simulator-config.js';
import { buildReactionPlan, type PlannedReaction } from './reaction-plan.js';

interface MonitoredCommunityEvent {
  id: string;
  title: string;
  organizerId: string;
  targetCount: number;
  joinedActorIds: Set<string>;
  nextJoinAt: number;
  isComplete: boolean;
}

interface MonitoredCommunityPost {
  id: string;
  title: string;
  authorId: string;
  detectedAt: number;
  /** Reactions restantes, triees par delai croissant depuis la detection. */
  pending: PlannedReaction[];
  likes: number;
  comments: number;
  total: number;
}

export type ReactionApi = Pick<
  ApiClient,
  'listEvents' | 'listPosts' | 'participateEvent' | 'likePost' | 'createComment'
>;

export type ReactionActors = Pick<
  ActorPool,
  'pickOrganizer' | 'getAllActors' | 'getActorById' | 'isSimulatedUser'
>;

/** Un post plus ancien que cela au moment de la detection n'est plus "frais" : pas de reaction. */
const MAX_POST_AGE_MS = 10 * 60 * 1000;
const EVENT_SCAN_INTERVAL_MS = 15_000;
/** Plafond d'appels simultanes vers l'API par tick, pour ne pas saturer la gateway. */
const MAX_REACTIONS_PER_TICK = 12;

export class UserReactionEngine {
  private monitoredEvents = new Map<string, MonitoredCommunityEvent>();
  private monitoredPosts = new Map<string, MonitoredCommunityPost>();
  private seenPostIds = new Set<string>();
  private firstPostScanDone = false;
  private lastEventScanAt = 0;
  private lastPostScanAt = 0;

  constructor(
    private readonly client: ReactionApi,
    private readonly pool: ReactionActors,
    private readonly config: ReactionConfig,
    private readonly rng: () => number = Math.random,
  ) {}

  /**
   * Tick de la boucle de reaction aux actions des utilisateurs reels.
   * Detecte les evenements et posts crees par de vrais utilisateurs et y injecte
   * de l'activite sociale (benevoles, likes, commentaires).
   */
  async tick(): Promise<void> {
    const now = Date.now();
    const scans: Array<Promise<void>> = [];

    if (now - this.lastPostScanAt >= this.config.scanIntervalMs) {
      this.lastPostScanAt = now;
      scans.push(this.scanCommunityPosts(now));
    }
    if (now - this.lastEventScanAt >= EVENT_SCAN_INTERVAL_MS) {
      this.lastEventScanAt = now;
      scans.push(this.scanCommunityEvents());
    }
    if (scans.length > 0) {
      await Promise.allSettled(scans);
    }

    await this.processEventsJoins(Date.now());
    await this.processPostReactions(Date.now());
  }

  /**
   * Oublie tout l'etat de suivi (entree en sommeil). Au prochain scan, les posts deja
   * presents sont simplement memorises : aucune rafale de reactions sur du contenu ancien.
   */
  reset(): void {
    this.monitoredEvents.clear();
    this.monitoredPosts.clear();
    this.seenPostIds.clear();
    this.firstPostScanDone = false;
  }

  /** Nombre de posts en cours de socialisation (utile pour les logs et les tests). */
  getMonitoredPostCount(): number {
    return this.monitoredPosts.size;
  }

  /**
   * Detecte les evenements crees par des utilisateurs reels (hors vivier de simulateurs).
   */
  private async scanCommunityEvents(): Promise<void> {
    const caller = this.pool.pickOrganizer();
    if (!caller?.accessToken) return;

    try {
      const events = await this.client.listEvents(caller.accessToken, { limit: 50 }, true);

      for (const ev of events) {
        if (!ev.id || !ev.organizerId) continue;

        // Si l'organisateur N'EST PAS un acteur du simulateur -> c'est un vrai utilisateur
        if (!this.pool.isSimulatedUser(ev.organizerId) && !this.monitoredEvents.has(ev.id)) {
          const targetCount = Math.min(
            ev.maxParticipants > 0 ? ev.maxParticipants : 15,
            faker.number.int({ min: 6, max: 12 }),
          );

          this.monitoredEvents.set(ev.id, {
            id: ev.id,
            title: ev.title,
            organizerId: ev.organizerId,
            targetCount,
            joinedActorIds: new Set<string>(),
            nextJoinAt: Date.now() + faker.number.int({ min: 3000, max: 8000 }),
            isComplete: false,
          });

          console.log(
            `[UserReactionEngine] Nouvel evenement communautaire detecte : "${ev.title}" (Orga: ${ev.organizerId}). Remplissage programme (cible: ${targetCount} participants).`,
          );
        }
      }
    } catch {
      // Erreur transitoire de scan : on reessaie au prochain cycle
    }
  }

  /**
   * Detecte les posts crees par des utilisateurs reels et planifie leurs reactions.
   * Le premier scan apres un demarrage ne fait que memoriser les posts existants.
   */
  private async scanCommunityPosts(now: number): Promise<void> {
    const caller = this.pool.pickOrganizer();
    if (!caller?.accessToken) return;

    try {
      const posts = await this.client.listPosts(caller.accessToken, { limit: 50 }, true);
      const isFirstScan = !this.firstPostScanDone;
      const currentIds = new Set<string>();

      for (const p of posts) {
        const authorId = p.authorId || p.userId;
        if (!p.id || !authorId) continue;
        currentIds.add(p.id);

        if (this.seenPostIds.has(p.id)) continue;
        this.seenPostIds.add(p.id);

        if (isFirstScan || this.pool.isSimulatedUser(authorId)) continue;

        const createdAt = p.createdAt ? Date.parse(p.createdAt) : Number.NaN;
        if (!Number.isNaN(createdAt) && now - createdAt > MAX_POST_AGE_MS) continue;

        const candidateActorIds = this.pool
          .getAllActors()
          .filter((a) => a.id !== authorId)
          .map((a) => a.id);
        const pending = buildReactionPlan({
          title: p.title,
          candidateActorIds,
          config: this.config,
          rng: this.rng,
        });
        if (pending.length === 0) continue;

        const likes = pending.filter((r) => r.kind === 'like').length;
        this.monitoredPosts.set(p.id, {
          id: p.id,
          title: p.title,
          authorId,
          detectedAt: now,
          pending,
          likes: 0,
          comments: 0,
          total: pending.length,
        });

        console.log(
          `[UserReactionEngine] Nouveau post communautaire detecte : "${p.title}" (Auteur: ${authorId}). ${likes} likes et ${pending.length - likes} commentaires planifies.`,
        );
      }

      this.firstPostScanDone = true;
      // Un post sorti de la page courante ne reviendra pas : on borne la memoire
      for (const id of this.seenPostIds) {
        if (!currentIds.has(id)) this.seenPostIds.delete(id);
      }
    } catch {
      // Erreur transitoire de scan : on reessaie au prochain cycle
    }
  }

  /**
   * Remplit progressivement les evenements des utilisateurs reels avec des benevoles.
   */
  private async processEventsJoins(now: number): Promise<void> {
    for (const item of this.monitoredEvents.values()) {
      if (item.isComplete) continue;

      if (item.joinedActorIds.size >= item.targetCount) {
        item.isComplete = true;
        console.log(
          `[UserReactionEngine] Evenement utilisateur "${item.title}" complete (${item.joinedActorIds.size} benevoles mobilises).`,
        );
        continue;
      }

      if (now >= item.nextJoinAt) {
        const availableVolunteers = this.pool
          .getAllActors()
          .filter((a) => !item.joinedActorIds.has(a.id) && a.id !== item.organizerId);

        if (availableVolunteers.length > 0) {
          const volunteer = faker.helpers.arrayElement(availableVolunteers);
          const ok = await this.client.participateEvent(volunteer.accessToken, item.id, true);

          if (ok) {
            item.joinedActorIds.add(volunteer.id);
            console.log(
              `[UserReactionEngine] ${volunteer.pseudo} a rejoint l'evenement de l'utilisateur : "${item.title}" (${item.joinedActorIds.size}/${item.targetCount})`,
            );
          }
        }

        // Prochaine arrivee echelonnee entre 10 et 25 secondes
        item.nextJoinAt = now + faker.number.int({ min: 10000, max: 25000 });
      }
    }
  }

  /**
   * Execute les reactions arrivees a echeance, en parallele et avec un plafond par tick.
   */
  private async processPostReactions(now: number): Promise<void> {
    const due: Array<{ post: MonitoredCommunityPost; reaction: PlannedReaction }> = [];

    for (const post of this.monitoredPosts.values()) {
      while (post.pending.length > 0 && post.detectedAt + post.pending[0].atMs <= now) {
        if (due.length >= MAX_REACTIONS_PER_TICK) break;
        due.push({ post, reaction: post.pending.shift() as PlannedReaction });
      }
      if (due.length >= MAX_REACTIONS_PER_TICK) break;
    }

    if (due.length === 0) return;

    await Promise.allSettled(due.map(({ post, reaction }) => this.executeReaction(post, reaction)));

    for (const [postId, post] of this.monitoredPosts) {
      if (post.pending.length === 0) {
        this.monitoredPosts.delete(postId);
        console.log(
          `[UserReactionEngine] Post utilisateur "${post.title}" socialise (${post.likes} likes, ${post.comments} commentaires sur ${post.total} prevus).`,
        );
      }
    }
  }

  private async executeReaction(post: MonitoredCommunityPost, reaction: PlannedReaction): Promise<void> {
    const actor = this.pool.getActorById(reaction.actorId);
    if (!actor) return;

    if (reaction.kind === 'like') {
      if (await this.client.likePost(actor.accessToken, post.id)) post.likes++;
      return;
    }

    if (reaction.text && (await this.client.createComment(actor.accessToken, post.id, reaction.text, true))) {
      post.comments++;
      console.log(`[UserReactionEngine] ${actor.pseudo} a commente "${post.title}" : "${reaction.text}"`);
    }
  }
}
