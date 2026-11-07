import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient } from '../clients/api-client.js';
import type { ActorPool } from '../actors/actor-pool.js';
import { PARIS_DISTRICTS } from '../geo/paris-districts.js';
import { generateEventBlueprint } from '../templates/event-blueprints.js';

export class MassEventsEngine {
  private createdEventIds: string[] = [];

  constructor(
    private readonly client: ApiClient,
    private readonly pool: ActorPool,
  ) {}

  /**
   * Génère par lots jusqu'à targetCount événements (futurs / passés) avec participations croisées.
   */
  async seedMassEvents(targetCount: number = 100, batchSize: number = 10): Promise<void> {
    console.log(`[MassEventsEngine] 🌍 Démarrage du peuplement de masse (Cible: ${targetCount} events)...`);

    let count = 0;
    while (count < targetCount) {
      const currentBatch = Math.min(batchSize, targetCount - count);
      const promises = Array.from({ length: currentBatch }).map(async () => {
        const organizer = this.pool.pickOrganizer();
        const blueprint = generateEventBlueprint();
        const location = faker.helpers.arrayElement(PARIS_DISTRICTS);

        // Date future (dans 1 à 30 jours) ou passée récente
        const isFuture = Math.random() < 0.7;
        const now = Date.now();
        const offsetSec = isFuture
          ? faker.number.int({ min: 86400, max: 30 * 86400 })
          : -faker.number.int({ min: 86400, max: 15 * 86400 });

        const startAt = new Date(now + offsetSec * 1000).toISOString();
        const endAt = new Date(now + (offsetSec + 10800) * 1000).toISOString();

        const eventId = await this.client.createEvent(organizer.accessToken, {
          title: `${blueprint.title} - ${location.name}`,
          description: blueprint.description,
          startAt,
          endAt,
          localisationName: location.address,
          type: blueprint.type,
          maxParticipants: blueprint.suggestedMaxParticipants,
        });

        if (eventId) {
          this.createdEventIds.push(eventId);

          if (isFuture) {
            // Laisser le temps à l'outbox asynchrone de propager l'event vers Neo4j
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Faire participer des bénévoles aux événements futurs
            const participants = this.pool.pickVolunteers(faker.number.int({ min: 2, max: 6 }), organizer.id);
            const attendeeIds: string[] = [];
            for (const vol of participants) {
              const ok = await this.client.participateEvent(vol.accessToken, eventId, true);
              if (ok) attendeeIds.push(vol.id);
            }
            if (attendeeIds.length > 0) {
              await this.client.setEventAttendance(organizer.accessToken, eventId, attendeeIds, [], true);
            }
          } else {
            // Événement passé historique : marqué directement comme terminé
            await this.client.changeEventState(organizer.accessToken, eventId, 'EVENT_STATE_FINISHED');
          }
        }
      });

      await Promise.allSettled(promises);
      count += currentBatch;
      console.log(`[MassEventsEngine] 📊 Progression : ${count}/${targetCount} events traités.`);
    }

    console.log(`[MassEventsEngine] ✅ Peuplement de masse terminé : ${this.createdEventIds.length} events créés.`);
  }

  getCreatedCount(): number {
    return this.createdEventIds.length;
  }
}

