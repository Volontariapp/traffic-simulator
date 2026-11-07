import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient, UserAuthCredentials } from '../clients/api-client.js';

export class ActorPool {
  private actors: UserAuthCredentials[] = [];
  private organizers: UserAuthCredentials[] = [];
  private volunteers: UserAuthCredentials[] = [];

  constructor(private readonly client: ApiClient) {}

  /**
   * Initialise ou reconnecte le pool d'acteurs de manière déterministe et parallélisée.
   * - Login-first : Si le compte existe déjà, réutilisation immédiate sans recréation.
   * - Traitement par lots (concurrence de 20) pour monter facilement jusqu'à 1000+ sessions.
   * - Aucune collision 409 possible : emails et pseudos indexés de façon unique.
   */
  async initialize(targetCount: number = 40): Promise<void> {
    console.log(`[ActorPool] Synchronisation des sessions (Cible: ${targetCount} acteurs déterministes)...`);

    const CONCURRENCY_LIMIT = 20;
    const indices = Array.from({ length: targetCount }, (_, i) => i);
    let connected = 0;
    let newlyCreated = 0;

    for (let i = 0; i < indices.length; i += CONCURRENCY_LIMIT) {
      const chunk = indices.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.all(
        chunk.map(async (idx) => {
          const indexStr = String(idx + 1).padStart(4, '0');
          const email = `actor.${indexStr}@simulator.volontariapp.test`;
          const pseudo = `sim_user_${indexStr}`;
          const password = 'Password123!Secure';
          const isOrganizer = idx < Math.max(5, Math.floor(targetCount * 0.25));
          const role: 'ORGANIZER' | 'VOLUNTEER' = isOrganizer ? 'ORGANIZER' : 'VOLUNTEER';

          // 1. Tenter le login en priorité (silencieux pour ne pas polluer les logs si nouveau)
          let auth = await this.client.login({ email, password }, true);
          let created = false;

          // 2. Si le compte n'existe pas encore en base, le créer
          if (!auth.accessToken) {
            auth = await this.client.signUp({
              email,
              pseudo,
              password,
              bio: isOrganizer
                ? `Responsable d'association solidaire (Acteur Virtuel #${indexStr}).`
                : `Bénévole engagé pour la solidarité et l'écologie (Acteur Virtuel #${indexStr}).`,
            });
            created = true;

            // En cas de création concurrente, re-tenter login
            if (!auth.accessToken) {
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
                role,
              } satisfies UserAuthCredentials,
              isOrganizer,
              created,
            };
          }

          console.warn(`[ActorPool] ⚠️ Impossible d'obtenir une session pour l'acteur #${indexStr}`);
          return null;
        }),
      );

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
        }
      }

      if (targetCount >= 50 && (i + CONCURRENCY_LIMIT) % 100 === 0) {
        console.log(`[ActorPool] 🔄 Progression sessions : ${connected}/${targetCount} connectés...`);
      }
    }

    console.log(
      `[ActorPool] ✅ Pool prêt : ${this.actors.length}/${targetCount} acteurs connectés (${this.organizers.length} organisateurs, ${this.volunteers.length} bénévoles, ${newlyCreated} créés).`,
    );
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

  getAllActors(): UserAuthCredentials[] {
    return this.actors;
  }
}
