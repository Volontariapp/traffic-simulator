import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient, UserAuthCredentials } from '../clients/api-client.js';

export class ActorPool {
  private actors: UserAuthCredentials[] = [];
  private organizers: UserAuthCredentials[] = [];
  private volunteers: UserAuthCredentials[] = [];

  constructor(private readonly client: ApiClient) {}

  async initialize(targetCount: number = 30): Promise<void> {
    console.log(`[ActorPool] Initialisation du pool d'utilisateurs virtuels (Cible: ${targetCount})...`);

    for (let i = 0; i < targetCount; i++) {
      const isOrganizer = i < Math.max(5, Math.floor(targetCount * 0.3));
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      const pseudo = faker.internet.username({ firstName, lastName }).slice(0, 20).replace(/[^a-zA-Z0-9_]/g, '');
      const email = `simulator.${faker.string.alphanumeric(8)}@volontariapp.test`;
      const password = 'Password123!Secure';
      const role = isOrganizer ? 'ORGANIZER' : 'VOLUNTEER';

      try {
        const signupRes = await this.client.signUp({
          email,
          pseudo: pseudo || `volontaire_${i}`,
          password,
          bio: isOrganizer
            ? `Responsable d'association solidaire engagé à Paris et en Île-de-France.`
            : `Bénévole motivé pour des actions écologiques, de maraude et de solidarité urbaine.`,
        });

        if (signupRes.user?.id && signupRes.accessToken) {
          const creds: UserAuthCredentials = {
            id: signupRes.user.id,
            email,
            pseudo,
            accessToken: signupRes.accessToken,
            role,
          };
          this.actors.push(creds);
          if (isOrganizer) {
            this.organizers.push(creds);
          } else {
            this.volunteers.push(creds);
          }
        }
      } catch (err) {
        console.warn(`[ActorPool] Échec création acteur ${i}:`, err instanceof Error ? err.message : String(err));
      }
    }

    console.log(
      `[ActorPool] Pool prêt : ${this.actors.length} acteurs (${this.organizers.length} organisateurs, ${this.volunteers.length} bénévoles).`,
    );
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

