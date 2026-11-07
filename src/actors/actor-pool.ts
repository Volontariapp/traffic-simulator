import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient, UserAuthCredentials } from '../clients/api-client.js';
import { buildActorIdentities } from './actor-identity.js';

export class ActorPool {
  private actors: UserAuthCredentials[] = [];
  private organizers: UserAuthCredentials[] = [];
  private volunteers: UserAuthCredentials[] = [];

  constructor(private readonly client: ApiClient) {}

  /**
   * Initialise ou reconnecte le pool d'acteurs de maniere deterministe et parallelisee.
   * - Login-first : Si le compte existe deja, reutilisation immediate sans recreation.
   * - Identites realistes deterministes (pseudo, bio) : les comptes existants dont le pseudo
   *   differe sont renommes en place (PATCH /users/me), l'historique est conserve.
   * - Traitement par lots (concurrence de 20), avec une pause apres tout lot qui a ecrit en base.
   */
  async initialize(targetCount: number = 40, batchPauseMs: number = 0): Promise<void> {
    console.log(`[ActorPool] Synchronisation des sessions (Cible: ${targetCount} acteurs deterministes)...`);

    const CONCURRENCY_LIMIT = 20;
    const organizerCount = Math.max(5, Math.floor(targetCount * 0.25));
    const roleOf = (idx: number): 'ORGANIZER' | 'VOLUNTEER' => (idx < organizerCount ? 'ORGANIZER' : 'VOLUNTEER');
    const identities = buildActorIdentities(targetCount, roleOf);
    const indices = Array.from({ length: targetCount }, (_, i) => i);
    const password = 'Password123!Secure';
    let connected = 0;
    let newlyCreated = 0;
    let renamed = 0;

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
          let wasRenamed = false;

          // 2. Si le compte n'existe pas encore en base, le creer avec son identite finale
          if (!auth.accessToken) {
            const signed = await this.client.signUp({ email, pseudo, password, bio });
            created = true;
            auth = { user: signed.user, accessToken: signed.accessToken };

            // En cas de creation concurrente ou demarrage progressif du backend, re-tenter login avec backoff
            for (let retry = 0; retry < 3 && !auth.accessToken; retry++) {
              if (retry > 0) await new Promise((r) => setTimeout(r, 800));
              auth = await this.client.login({ email, password }, true);
            }
          } else if (auth.user?.pseudo !== pseudo) {
            // 3. Compte existant avec une ancienne identite : renommage idempotent
            wasRenamed = await this.client.updateMe(auth.accessToken, { pseudo, bio }, true);
          }

          if (auth.user?.id && auth.accessToken) {
            return {
              creds: {
                id: auth.user.id,
                email,
                pseudo,
                password,
                accessToken: auth.accessToken,
                role,
              } satisfies UserAuthCredentials,
              isOrganizer,
              created,
              wasRenamed,
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
          if (res.isOrganizer) {
            this.organizers.push(res.creds);
          } else {
            this.volunteers.push(res.creds);
          }
          connected++;
          if (res.created) newlyCreated++;
          if (res.wasRenamed) renamed++;
          if (res.created || res.wasRenamed) wroteToDb = true;
        }
      }

      if (targetCount >= 50 && (i + CONCURRENCY_LIMIT) % 100 === 0) {
        console.log(`[ActorPool] Progression sessions : ${connected}/${targetCount} connectes...`);
      }

      if (wroteToDb && batchPauseMs > 0 && i + CONCURRENCY_LIMIT < indices.length) {
        await new Promise((r) => setTimeout(r, batchPauseMs));
      }
    }

    console.log(
      `[ActorPool] Pool pret : ${this.actors.length}/${targetCount} acteurs connectes (${this.organizers.length} organisateurs, ${this.volunteers.length} benevoles, ${newlyCreated} crees, ${renamed} renommes).`,
    );
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
   * Renouvelle le token JWT d'un acteur en cas d'expiration au long cours.
   */
  async refreshActorToken(actor: UserAuthCredentials): Promise<boolean> {
    if (!actor.password) return false;
    const res = await this.client.login({ email: actor.email, password: actor.password }, true);
    if (res.accessToken) {
      actor.accessToken = res.accessToken;
      return true;
    }
    return false;
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
