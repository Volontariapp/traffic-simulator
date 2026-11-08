import type { ActorPool } from '../actors/actor-pool.js';
import type { ApiClient } from '../clients/api-client.js';
import type { RealUsersConfig } from '../config/simulator-config.js';
import { pickWelcomeFollowers } from '../social/follow-plan.js';

export type RealFollowApi = Pick<ApiClient, 'login' | 'listUsers' | 'followUser'>;
export type RealFollowActors = Pick<ActorPool, 'getAllActors' | 'getActorById' | 'isSimulatedUser'>;

export interface AdminCredentials {
  email: string;
  password: string;
}

interface PendingFollow {
  actorId: string;
  targetId: string;
  dueAt: number;
  attempts: number;
}

/** Domaine des comptes du simulateur : jamais traites comme de vrais utilisateurs. */
export const SIMULATOR_EMAIL_DOMAIN = '@simulator.volontariapp.test';

const USERS_PAGE_SIZE = 500;
/** Garde-fou : 40 pages de 500 couvrent 20 000 comptes, bien au-dela de la realite. */
const MAX_PAGES = 40;
/** Les follows d'un nouveau compte arrivent etales : pas de rafale de notifications d'un coup. */
const FOLLOW_DELAY_MS = { min: 5_000, max: 10 * 60_000 };
const MAX_FOLLOWS_PER_TICK = 20;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;

/**
 * Fait suivre chaque vrai compte par quelques acteurs du simulateur, pour que les profils reels ne
 * restent pas vides. La liste des utilisateurs vient de la route admin `GET /users` (le simulateur
 * dispose deja d'un compte ADMIN pour les positions) : elle n'a ni date ni ordre garantis, donc on
 * la parcourt en entier et on compare aux comptes deja connus.
 *
 * Un follow deja present (409) est sans effet : un redemarrage rejoue les follows sans doublon et
 * sans nouvelle notification pour l'utilisateur.
 */
export class RealUserFollowEngine {
  private known = new Set<string>();
  private pending: PendingFollow[] = [];
  private firstScanDone = false;
  private lastScanAt = 0;

  constructor(
    private readonly api: RealFollowApi,
    private readonly pool: RealFollowActors,
    private readonly config: RealUsersConfig,
    private readonly admin: AdminCredentials,
    private readonly rng: () => number = Math.random,
  ) {}

  getPendingFollowCount(): number {
    return this.pending.length;
  }

  getKnownUserCount(): number {
    return this.known.size;
  }

  async tick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScanAt >= this.config.scanIntervalMs) {
      this.lastScanAt = now;
      await this.scan(now);
    }
    await this.processDue(now);
  }

  private async scan(now: number): Promise<void> {
    let users: Array<{ id: string; email?: string }>;
    try {
      users = await this.fetchAllUsers();
    } catch (err) {
      console.warn(`[RealFollow] Lecture des utilisateurs impossible : ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const adminEmail = this.admin.email.toLowerCase();
    const fresh = users.filter(
      (u) =>
        u.id &&
        !this.known.has(u.id) &&
        !this.pool.isSimulatedUser(u.id) &&
        !(u.email ?? '').toLowerCase().endsWith(SIMULATOR_EMAIL_DOMAIN) &&
        (u.email ?? '').toLowerCase() !== adminEmail,
    );

    const isFirstScan = !this.firstScanDone;
    this.firstScanDone = true;
    for (const user of fresh) this.known.add(user.id);

    if (isFirstScan && !this.config.includeExisting) return;

    const actorIds = this.pool.getAllActors().map((a) => a.id);
    let planned = 0;
    for (const user of fresh) {
      const followers = pickWelcomeFollowers({
        actorIds,
        count: { min: this.config.followersMin, max: this.config.followersMax },
        rng: this.rng,
      });
      for (const actorId of followers) {
        const delay = FOLLOW_DELAY_MS.min + this.rng() * (FOLLOW_DELAY_MS.max - FOLLOW_DELAY_MS.min);
        this.pending.push({ actorId, targetId: user.id, dueAt: now + delay, attempts: 0 });
        planned++;
      }
    }
    if (fresh.length > 0) {
      console.log(`[RealFollow] ${fresh.length} compte(s) reel(s) a suivre : ${planned} follows planifies.`);
    }
  }

  private async fetchAllUsers(): Promise<Array<{ id: string; email?: string }>> {
    const session = await this.api.login({ email: this.admin.email, password: this.admin.password }, true);
    if (!session.accessToken) {
      throw new Error('connexion admin refusee (identifiants du simulateur ou role ADMIN manquant)');
    }

    const all: Array<{ id: string; email?: string }> = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const users = await this.api.listUsers(session.accessToken, page, USERS_PAGE_SIZE);
      if (!users) throw new Error(`lecture de la page ${page} refusee ou indisponible`);
      all.push(...users);
      if (users.length < USERS_PAGE_SIZE) break;
    }
    return all;
  }

  private async processDue(now: number): Promise<void> {
    const due: PendingFollow[] = [];
    const later: PendingFollow[] = [];
    for (const item of this.pending) {
      if (item.dueAt <= now && due.length < MAX_FOLLOWS_PER_TICK) due.push(item);
      else later.push(item);
    }
    if (due.length === 0) return;
    this.pending = later;

    const outcomes = await Promise.all(due.map((item) => this.follow(item)));
    due.forEach((item, i) => {
      if (outcomes[i] !== 'failed') return;
      if (item.attempts + 1 >= MAX_ATTEMPTS) return;
      this.pending.push({ ...item, attempts: item.attempts + 1, dueAt: now + RETRY_DELAY_MS });
    });
  }

  private async follow(item: PendingFollow): Promise<'created' | 'exists' | 'failed'> {
    const actor = this.pool.getActorById(item.actorId);
    if (!actor) return 'exists'; // acteur disparu : rien a rejouer
    return this.api.followUser(actor.accessToken, item.targetId);
  }
}
