import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient, UserAuthCredentials } from '../clients/api-client.js';
import { isExpiringWithin } from '../auth/token-expiry.js';
import { buildActorIdentities } from './actor-identity.js';

export type PoolApi = Pick<
  ApiClient,
  'login' | 'signUp' | 'updateMe' | 'getMyPseudo' | 'refreshSession' | 'setTokenRefresher'
>;

export class ActorPool {
  private actors: UserAuthCredentials[] = [];
  private organizers: UserAuthCredentials[] = [];
  private volunteers: UserAuthCredentials[] = [];
  /** Tous les access tokens connus (y compris remplaces) -> acteur, pour retrouver l'acteur d'un 401. */
  private tokenOwners = new Map<string, UserAuthCredentials>();
  /** Un seul renouvellement a la fois par acteur, les 401 concurrents s'y raccrochent. */
  private renewals = new Map<string, Promise<string | undefined>>();
  private renewalStats = { refresh: 0, login: 0, failed: 0 };
  private renewalLogTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly client: PoolApi,
    private readonly loginRetryDelayMs: number = 800,
  ) {
    this.client.setTokenRefresher((staleToken) => this.renewSession(staleToken));
  }

  /**
   * Initialise ou reconnecte le pool d'acteurs de maniere deterministe et parallelisee.
   * - Login-first : Si le compte existe deja, reutilisation immediate sans recreation.
   * - Identites realistes deterministes (pseudo, bio) : les comptes existants dont le pseudo
   *   differe sont renommes en place (PATCH /users/me), l'historique est conserve.
   *   Trois comptes sentinelles (premier, milieu, dernier) sont lus d'abord : s'ils portent deja
   *   leur identite cible, la phase de renommage est sautee (aucune requete par compte).
   *   `forceIdentitySync` force la verification complete de chaque compte.
   * - Traitement par lots (concurrence de 20), avec une pause apres tout lot qui a ecrit en base.
   */
  async initialize(
    targetCount: number = 40,
    batchPauseMs: number = 0,
    forceIdentitySync: boolean = false,
  ): Promise<void> {
    console.log(`[ActorPool] Synchronisation des sessions (Cible: ${targetCount} acteurs deterministes)...`);

    const CONCURRENCY_LIMIT = 20;
    const organizerCount = Math.max(5, Math.floor(targetCount * 0.25));
    const roleOf = (idx: number): 'ORGANIZER' | 'VOLUNTEER' => (idx < organizerCount ? 'ORGANIZER' : 'VOLUNTEER');
    const identities = buildActorIdentities(targetCount, roleOf);
    const indices = Array.from({ length: targetCount }, (_, i) => i);
    const password = 'Password123!Secure';
    let connected = 0;
    let newlyCreated = 0;
    const existingAccounts: Array<{ creds: UserAuthCredentials; bio: string }> = [];

    for (let i = 0; i < indices.length; i += CONCURRENCY_LIMIT) {
      const chunk = indices.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.all(
        chunk.map(async (idx) => {
          const { email, pseudo, bio } = identities[idx];
          const role = roleOf(idx);
          const isOrganizer = role === 'ORGANIZER';

          // 1. Tenter le login en priorite (silencieux pour ne pas polluer les logs si nouveau)
          let auth = await this.client.login({ email, password }, true);
          let created = false;

          // 2. Si le compte n'existe pas encore en base, le creer avec son identite finale
          if (!auth.accessToken) {
            const signed = await this.client.signUp({ email, pseudo, password, bio });
            created = true;
            auth = { user: signed.user, accessToken: signed.accessToken, refreshToken: signed.refreshToken };

            // En cas de creation concurrente ou demarrage progressif du backend, re-tenter login avec backoff
            for (let retry = 0; retry < 3 && !auth.accessToken; retry++) {
              if (retry > 0) await new Promise((r) => setTimeout(r, this.loginRetryDelayMs));
              auth = await this.client.login({ email, password }, true);
            }
          }

          if (auth.user?.id && auth.accessToken) {
            return {
              creds: {
                id: auth.user.id,
                email,
                pseudo,
                password,
                accessToken: auth.accessToken,
                refreshToken: auth.refreshToken,
                role,
              } satisfies UserAuthCredentials,
              isOrganizer,
              created,
              bio,
            };
          }

          console.warn(`[ActorPool] Impossible d'obtenir une session pour l'acteur #${idx + 1}`);
          return null;
        }),
      );

      let wroteToDb = false;
      for (const res of results) {
        if (res) {
          this.actors.push(res.creds);
          this.tokenOwners.set(res.creds.accessToken, res.creds);
          if (res.isOrganizer) {
            this.organizers.push(res.creds);
          } else {
            this.volunteers.push(res.creds);
          }
          connected++;
          if (res.created) {
            newlyCreated++;
            wroteToDb = true;
          } else {
            existingAccounts.push({ creds: res.creds, bio: res.bio });
          }
        }
      }

      if (targetCount >= 50 && (i + CONCURRENCY_LIMIT) % 100 === 0) {
        console.log(`[ActorPool] Progression sessions : ${connected}/${targetCount} connectes...`);
      }

      if (wroteToDb && batchPauseMs > 0 && i + CONCURRENCY_LIMIT < indices.length) {
        await new Promise((r) => setTimeout(r, batchPauseMs));
      }
    }

    const identity = await this.reconcileIdentities(existingAccounts, batchPauseMs, forceIdentitySync);

    console.log(
      `[ActorPool] Pool pret : ${this.actors.length}/${targetCount} acteurs connectes (${this.organizers.length} organisateurs, ${this.volunteers.length} benevoles, ${newlyCreated} crees, ${identity.renamed} renommes, identites ${identity.skipped ? 'a jour (sentinelles)' : `verifiees (${identity.checked} lectures)`}).`,
    );
  }

  /**
   * Aligne pseudo et bio des comptes existants sur leur identite cible. Evite 300 ecritures a chaque
   * redemarrage : les sentinelles a jour suffisent a sauter la phase. Sinon, lecture par compte et
   * ecriture uniquement en cas de difference.
   */
  private async reconcileIdentities(
    accounts: Array<{ creds: UserAuthCredentials; bio: string }>,
    batchPauseMs: number,
    force: boolean,
  ): Promise<{ renamed: number; checked: number; skipped: boolean }> {
    if (accounts.length === 0) return { renamed: 0, checked: 0, skipped: true };

    if (!force) {
      const sentinels = [
        ...new Set([accounts[0], accounts[Math.floor(accounts.length / 2)], accounts[accounts.length - 1]]),
      ];
      const current = await Promise.all(sentinels.map((a) => this.client.getMyPseudo(a.creds.accessToken)));
      if (sentinels.every((a, i) => current[i] === a.creds.pseudo)) {
        return { renamed: 0, checked: sentinels.length, skipped: true };
      }
    }

    const CONCURRENCY_LIMIT = 20;
    let renamed = 0;
    let checked = 0;
    for (let i = 0; i < accounts.length; i += CONCURRENCY_LIMIT) {
      const chunk = accounts.slice(i, i + CONCURRENCY_LIMIT);
      const outcomes = await Promise.all(
        chunk.map(async ({ creds, bio }) => {
          const current = await this.client.getMyPseudo(creds.accessToken);
          if (current === creds.pseudo) return false;
          return this.client.updateMe(creds.accessToken, { pseudo: creds.pseudo, bio }, true);
        }),
      );
      checked += chunk.length;
      const wrote = outcomes.filter(Boolean).length;
      renamed += wrote;
      if (wrote > 0 && batchPauseMs > 0 && i + CONCURRENCY_LIMIT < accounts.length) {
        await new Promise((r) => setTimeout(r, batchPauseMs));
      }
    }
    return { renamed, checked, skipped: false };
  }

  /**
   * Renouvelle les tokens de tous les acteurs (reveil apres la fenetre de sommeil).
   * Retourne le nombre de sessions rafraichies.
   */
  async refreshAllTokens(): Promise<number> {
    const CONCURRENCY_LIMIT = 20;
    let refreshed = 0;
    for (let i = 0; i < this.actors.length; i += CONCURRENCY_LIMIT) {
      const chunk = this.actors.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.all(chunk.map((actor) => this.refreshActorToken(actor)));
      refreshed += results.filter(Boolean).length;
    }
    console.log(`[ActorPool] Tokens rafraichis : ${refreshed}/${this.actors.length}`);
    return refreshed;
  }

  /**
   * Re-login d'un acteur (reveil apres la fenetre de sommeil).
   */
  async refreshActorToken(actor: UserAuthCredentials): Promise<boolean> {
    if (!actor.password) return false;
    const res = await this.client.login({ email: actor.email, password: actor.password }, true);
    if (res.accessToken) {
      this.applySession(actor, res.accessToken, res.refreshToken);
      return true;
    }
    return false;
  }

  /**
   * Renouvelle la session de l'acteur dont le token vient de recevoir un 401.
   * Basculement : refresh token d'abord, puis re-login avec le mot de passe.
   * Retourne le nouvel access token, ou undefined si les deux voies echouent.
   * Appels concurrents pour un meme acteur : un seul renouvellement reseau.
   */
  async renewSession(staleToken: string): Promise<string | undefined> {
    const actor = this.tokenOwners.get(staleToken);
    if (!actor) return undefined;

    // Deja renouvele par un autre appel entre-temps : rien a faire
    if (actor.accessToken !== staleToken) return actor.accessToken;

    return this.renewActor(actor);
  }

  /**
   * Demarre les renouvellements preventifs : toutes les `intervalMs`, renouvelle les sessions dont
   * l'access token expire dans moins de `marginMs`. Evite d'envoyer des tokens expires aux services
   * (401 en rafale dans les logs). `canRun` permet de suspendre le renouvellement (fenetre de sommeil).
   */
  startTokenKeepAlive(options: { intervalMs: number; marginMs: number; canRun: () => boolean }): void {
    const timer = setInterval(() => {
      if (!options.canRun()) return;
      this.refreshExpiringSessions(options.marginMs).catch((err: unknown) =>
        console.error('[ActorPool] Renouvellement preventif en echec :', err instanceof Error ? err.message : String(err)),
      );
    }, options.intervalMs);
    timer.unref();
  }

  /**
   * Renouvelle les sessions dont l'access token expire dans moins de `marginMs` (ou est deja expire).
   * Retourne le nombre de sessions renouvelees avec succes.
   */
  async refreshExpiringSessions(marginMs: number, now: number = Date.now()): Promise<number> {
    const CONCURRENCY_LIMIT = 20;
    const due = this.actors.filter((actor) => isExpiringWithin(actor.accessToken, marginMs, now));
    let renewed = 0;
    for (let i = 0; i < due.length; i += CONCURRENCY_LIMIT) {
      const chunk = due.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.all(chunk.map((actor) => this.renewActor(actor)));
      renewed += results.filter((token) => token !== undefined).length;
    }
    return renewed;
  }

  /** Un seul renouvellement reseau en vol par acteur : les appels concurrents partagent la meme promesse. */
  private renewActor(actor: UserAuthCredentials): Promise<string | undefined> {
    const inFlight = this.renewals.get(actor.id);
    if (inFlight) return inFlight;

    const renewal = this.performRenewal(actor).finally(() => this.renewals.delete(actor.id));
    this.renewals.set(actor.id, renewal);
    return renewal;
  }

  private async performRenewal(actor: UserAuthCredentials): Promise<string | undefined> {
    // 1. Refresh token (leger, pas de hachage de mot de passe cote serveur)
    if (actor.refreshToken) {
      const refreshed = await this.client.refreshSession(actor.refreshToken);
      if (refreshed.accessToken) {
        this.applySession(actor, refreshed.accessToken, refreshed.refreshToken);
        this.noteRenewal('refresh');
        return refreshed.accessToken;
      }
    }

    // 2. Secours : re-login complet
    if (actor.password) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, this.loginRetryDelayMs));
        const res = await this.client.login({ email: actor.email, password: actor.password }, true);
        if (res.accessToken) {
          this.applySession(actor, res.accessToken, res.refreshToken);
          this.noteRenewal('login');
          return res.accessToken;
        }
      }
    }

    this.noteRenewal('failed');
    return undefined;
  }

  private applySession(actor: UserAuthCredentials, accessToken: string, refreshToken?: string): void {
    actor.accessToken = accessToken;
    if (refreshToken) actor.refreshToken = refreshToken;
    this.tokenOwners.set(accessToken, actor);

    // Les anciens tokens restent resolvables (401 en vol), mais on borne la memoire
    if (this.tokenOwners.size > this.actors.length * 4 + 16) {
      this.tokenOwners = new Map(this.actors.map((a) => [a.accessToken, a]));
    }
  }

  /** Resume agrege des renouvellements : une ligne par fenetre de 10 s, pas une par acteur. */
  private noteRenewal(kind: 'refresh' | 'login' | 'failed'): void {
    this.renewalStats[kind]++;
    if (this.renewalLogTimer) return;
    this.renewalLogTimer = setTimeout(() => {
      const { refresh, login, failed } = this.renewalStats;
      console.log(
        `[ActorPool] Sessions renouvelees : ${refresh} par refresh token, ${login} par re-login, ${failed} echecs.`,
      );
      this.renewalStats = { refresh: 0, login: 0, failed: 0 };
      this.renewalLogTimer = undefined;
    }, 10_000);
    this.renewalLogTimer.unref();
  }

  pickOrganizer(): UserAuthCredentials {
    if (this.organizers.length > 0) {
      return faker.helpers.arrayElement(this.organizers);
    }
    return faker.helpers.arrayElement(this.actors);
  }

  pickVolunteers(count: number, excludeId?: string): UserAuthCredentials[] {
    const pool = this.actors.filter((a) => a.id !== excludeId);
    return faker.helpers.arrayElements(pool, Math.min(count, pool.length));
  }

  getActorById(id: string): UserAuthCredentials | undefined {
    return this.actors.find((a) => a.id === id);
  }

  getAllActors(): UserAuthCredentials[] {
    return this.actors;
  }

  isSimulatedUser(userId?: string): boolean {
    if (!userId) return false;
    return this.actors.some((a) => a.id === userId);
  }

  getSimulatedUserIds(): Set<string> {
    return new Set(this.actors.map((a) => a.id));
  }

  getRandomActor(excludeId?: string): UserAuthCredentials {
    const candidates = this.actors.filter((a) => a.id !== excludeId);
    return faker.helpers.arrayElement(candidates.length > 0 ? candidates : this.actors);
  }
}
