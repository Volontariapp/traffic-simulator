import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient, UserAuthCredentials } from '../clients/api-client.js';
import type { ActorPool } from '../actors/actor-pool.js';
import { OFF_GRID_DISTRICT, PARIS_DISTRICTS, getRandomLocationForDistrict, type ParisLocation } from '../geo/paris-districts.js';
import { CURATED_THEMATIC_PHOTOS, detectTheme } from '../media/photo-bank.js';
import type { MediaUploader } from '../media/uploader.js';
import { generateEventBlueprint } from '../templates/event-blueprints.js';

interface ActiveDistrictEvent {
  district: number;
  slot: number;
  location: ParisLocation;
  eventId: string;
  title: string;
  organizer: UserAuthCredentials;
  startedAt: number; // timestamp ms
  durationMs: number;
  theme: string;
  startPostId?: string;
  participants: UserAuthCredentials[];
  checkedInUserIds: Set<string>;
  lastAttendanceCheckAt: number;
}

export class ParisLiveEngine {
  // key: `${district}-${slot}` -> ActiveDistrictEvent
  private activeEvents = new Map<string, ActiveDistrictEvent>();
  // Faux pendant la phase de vidage nocturne : plus aucun nouvel event n'est cree
  private spawnEnabled = true;
  private spawnSeq = 0;

  constructor(
    private readonly client: ApiClient,
    private readonly pool: ActorPool,
    private readonly uploader: MediaUploader,
    private readonly eventLifespanSec: number = 180,
    private readonly eventsPerDistrict: number = 3,
    private readonly parallelBatchSize: number = 4,
  ) {}

  /**
   * Orchestre les événements en temps réel avec parallélisme par arrondissements.
   * Garantit l'invariant : eventsPerDistrict événements simultanés dans CHAQUE arrondissement.
   */
  async tick(): Promise<void> {
    const now = Date.now();

    // Traitement par lots d'arrondissements en parallèle pour fluidifier le débit
    for (let i = 0; i < PARIS_DISTRICTS.length; i += this.parallelBatchSize) {
      const batch = PARIS_DISTRICTS.slice(i, i + this.parallelBatchSize);
      await Promise.allSettled(
        batch.map((location) => this.tickDistrict(location, now)),
      );
    }
  }

  private async tickDistrict(location: ParisLocation, now: number): Promise<void> {
    for (let slot = 1; slot <= this.eventsPerDistrict; slot++) {
      const slotKey = `${location.district}-${slot}`;
      const current = this.activeEvents.get(slotKey);

      if (!current) {
        // Aucun événement sur ce slot : en démarrer un immédiatement (sauf pendant le vidage nocturne)
        if (this.spawnEnabled) {
          await this.startLiveEventInDistrict(location, slot);
        }
      } else {
        await this.advanceEvent(slotKey, current, location, now);
      }
    }
  }

  /** Fait avancer un événement en cours : clôture s'il a atteint sa fin, sinon activité en direct. */
  private async advanceEvent(
    slotKey: string,
    current: ActiveDistrictEvent,
    location: ParisLocation,
    now: number,
  ): Promise<void> {
    if (now - current.startedAt >= current.durationMs) {
      // L'événement a atteint sa fin artificielle : le clôturer avec bilan et émargement final
      await this.finishLiveEvent(current, location, slotKey);
    } else {
      // Événement en cours : simuler l'activité en direct (nouveaux arrivants et pointage/émargement par le créateur)
      await this.simulateLiveActivity(current, location, now);
    }
  }

  /**
   * Fait avancer tous les événements actifs sans en créer (instance dont les événements sont posés
   * à la demande avec `spawnAt`, hors des slots d'arrondissement).
   */
  async tickActive(): Promise<void> {
    const now = Date.now();
    const entries = [...this.activeEvents.entries()];
    for (let i = 0; i < entries.length; i += this.parallelBatchSize) {
      await Promise.allSettled(
        entries
          .slice(i, i + this.parallelBatchSize)
          .map(([slotKey, event]) => this.advanceEvent(slotKey, event, event.location, now)),
      );
    }
  }

  /**
   * Démarre un événement en direct à une position donnée, hors invariant d'arrondissement.
   * Retourne vrai si l'événement a bien été créé et suivi.
   */
  async spawnAt(location: ParisLocation): Promise<boolean> {
    const slotKey = `at-${++this.spawnSeq}`;
    await this.startLiveEvent(location, slotKey, 1);
    return this.activeEvents.has(slotKey);
  }

  private async startLiveEventInDistrict(districtBase: ParisLocation, slot: number): Promise<void> {
    // Sélectionne une adresse réaliste et dispersée au sein de l'arrondissement pour éviter tout chevauchement
    const location = getRandomLocationForDistrict(districtBase.district, slot);
    await this.startLiveEvent(location, `${districtBase.district}-${slot}`, slot);
  }

  private async startLiveEvent(location: ParisLocation, slotKey: string, slot: number): Promise<void> {
    const organizer = this.pool.pickOrganizer();
    const blueprint = generateEventBlueprint();
    const themeKey = detectTheme(blueprint.title);
    const thematic = CURATED_THEMATIC_PHOTOS[themeKey];

    const slotSuffix = slot === 1 ? '' : ` [Site ${slot}]`;
    const eventTitle = `${blueprint.title} (${location.name})${slotSuffix}`;

    console.log(
      `[ParisLiveEngine] 🚀 Démarrage event [${location.postalCode} | Slot ${slot}/${this.eventsPerDistrict}] : "${eventTitle}" (Orga: ${organizer.pseudo})`,
    );

    // 1. Cover photo réaliste
    const coverEntry = faker.helpers.arrayElement(thematic.coverPhotos);
    const coverFileId = await this.uploader.uploadImage(
      coverEntry.url,
      'ENTITY_TYPE_EVENT_COVER',
      organizer.accessToken,
    );

    const now = new Date();
    const startAt = now.toISOString();
    const endAt = new Date(now.getTime() + 3600 * 3000).toISOString();

    // 2. Création de l'événement
    const eventId = await this.client.createEvent(organizer.accessToken, {
      title: eventTitle,
      description: `${blueprint.description}\n\nRendez-vous : ${location.address}.`,
      startAt,
      endAt,
      localisationName: location.address,
      type: blueprint.type,
      maxParticipants: blueprint.suggestedMaxParticipants,
      coverFileId,
    });

    if (!eventId) {
      console.warn(`[ParisLiveEngine] ⚠️ Impossible de créer l'event pour le district ${location.district} slot ${slot}`);
      return;
    }

    // 3. Post d'ouverture avec photo réaliste au début de l'event
    const startPhotoEntry = faker.helpers.arrayElement(thematic.startPostPhotos);
    const startPhotoFileId = await this.uploader.uploadImage(
      startPhotoEntry.url,
      'ENTITY_TYPE_POST',
      organizer.accessToken,
    );

    const uniqueCode = faker.string.alphanumeric(4).toUpperCase();
    const startPostId = await this.client.createPost(organizer.accessToken, {
      title: `C’est parti : ${blueprint.title} (${location.name}) [${uniqueCode}]`,
      content: `L’équipe est en place à ${location.name} ! ${startPhotoEntry.caption}. Rejoignez-nous si vous êtes dans le coin !`,
      eventId,
      fileIds: startPhotoFileId ? [startPhotoFileId] : [],
    });

    // 4. Passage en statut IN_PROGRESS (Événement en direct !)
    await this.client.changeEventState(organizer.accessToken, eventId, 'EVENT_STATE_IN_PROGRESS');

    // Petite temporisation pour laisser le temps à l'outbox et au post-processor de créer le nœud Neo4j
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 5. Inscription de bénévoles du pool et likes
    const participants = this.pool.pickVolunteers(faker.number.int({ min: 3, max: 7 }), organizer.id);
    for (const vol of participants) {
      await this.client.participateEvent(vol.accessToken, eventId, true);
      if (startPostId && Math.random() < 0.6) {
        await this.client.likePost(vol.accessToken, startPostId);
      }
    }

    // Le créateur pointe immédiatement les premiers bénévoles ponctuels arrivés sur place
    const checkedInUserIds = new Set<string>();
    const earlyBirds = participants.slice(0, Math.min(2, participants.length));
    if (earlyBirds.length > 0) {
      const earlyBirdIds = earlyBirds.map((v) => v.id);
      const checkedOk = await this.client.setEventAttendance(
        organizer.accessToken,
        eventId,
        earlyBirdIds,
        [],
        true,
      );
      if (checkedOk) {
        for (const id of earlyBirdIds) {
          checkedInUserIds.add(id);
        }
      }
    }

    // 6. Enregistrement en mémoire
    const durationVarianceSec = faker.number.int({
      min: Math.floor(this.eventLifespanSec * 0.8),
      max: Math.floor(this.eventLifespanSec * 1.3),
    });

    this.activeEvents.set(slotKey, {
      district: location.district,
      slot,
      location,
      eventId,
      title: eventTitle,
      organizer,
      startedAt: Date.now(),
      durationMs: durationVarianceSec * 1000,
      theme: themeKey,
      startPostId,
      participants,
      checkedInUserIds,
      lastAttendanceCheckAt: Date.now(),
    });

    console.log(
      `[ParisLiveEngine] ✅ Event [${location.postalCode}#${slot}] LIVE (${this.activeCount(location)} total) avec ${participants.length} bénévoles (${checkedInUserIds.size} pointés)`,
    );
  }

  private async simulateLiveActivity(
    event: ActiveDistrictEvent,
    location: ParisLocation,
    now: number,
  ): Promise<void> {
    // 1. Arrivée spontanée d'un nouveau bénévole en cours d'événement (20% de chance par tick si max non atteint)
    if (event.participants.length < 15 && Math.random() < 0.2) {
      const alreadyJoinedIds = new Set(event.participants.map((p) => p.id));
      const candidates = this.pool
        .pickVolunteers(5, event.organizer.id)
        .filter((v) => !alreadyJoinedIds.has(v.id));

      if (candidates.length > 0) {
        const newVol = candidates[0];
        const ok = await this.client.participateEvent(newVol.accessToken, event.eventId, true);
        if (ok) {
          event.participants.push(newVol);
          if (event.startPostId && Math.random() < 0.5) {
            await this.client.likePost(newVol.accessToken, event.startPostId);
          }
          console.log(
            `[ParisLiveEngine] 🙋 Arrivée [${location.postalCode}#${event.slot}] : ${newVol.pseudo} a rejoint "${event.title}" (${event.participants.length} inscrits)`,
          );
        }
      }
    }

    // 2. Émargement / Pointage régulier par le créateur ("checker les arrivants") toutes les ~25s
    if (now - event.lastAttendanceCheckAt >= 25000) {
      event.lastAttendanceCheckAt = now;
      const pendingVolunteers = event.participants.filter((p) => !event.checkedInUserIds.has(p.id));

      if (pendingVolunteers.length > 0) {
        // Coche 1 à 2 arrivants à la fois
        const batchSize = Math.min(pendingVolunteers.length, faker.number.int({ min: 1, max: 2 }));
        const toCheck = pendingVolunteers.slice(0, batchSize);
        const toCheckIds = toCheck.map((v) => v.id);

        const ok = await this.client.setEventAttendance(
          event.organizer.accessToken,
          event.eventId,
          toCheckIds,
          [],
          true,
        );

        if (ok) {
          for (const id of toCheckIds) {
            event.checkedInUserIds.add(id);
          }
          const checkedNames = toCheck.map((v) => v.pseudo).join(', ');
          console.log(
            `[ParisLiveEngine] 📋 Émargement [${location.postalCode}#${event.slot}] : L'orga ${event.organizer.pseudo} a coché [${checkedNames}] (${event.checkedInUserIds.size}/${event.participants.length} présents)`,
          );
        }
      }
    }
  }

  private async finishLiveEvent(
    event: ActiveDistrictEvent,
    location: ParisLocation,
    slotKey: string,
  ): Promise<void> {
    console.log(
      `[ParisLiveEngine] 🏁 Clôture event [${location.postalCode}#${event.slot}] : "${event.title}" (eventId: ${event.eventId})`,
    );

    // 1. Émargement final : avant de clore l'événement, le créateur s'assure que tous les participants sont émargés pour le scoring
    const remainingPending = event.participants.filter((p) => !event.checkedInUserIds.has(p.id));
    if (remainingPending.length > 0) {
      const remainingIds = remainingPending.map((v) => v.id);
      const ok = await this.client.setEventAttendance(
        event.organizer.accessToken,
        event.eventId,
        remainingIds,
        [],
        true,
      );
      if (ok) {
        for (const id of remainingIds) {
          event.checkedInUserIds.add(id);
        }
      }
      console.log(
        `[ParisLiveEngine] 📋 Émargement final [${location.postalCode}#${event.slot}] : Total ${event.checkedInUserIds.size}/${event.participants.length} bénévoles validés présents avant clôture`,
      );
    }

    const thematic = CURATED_THEMATIC_PHOTOS[event.theme as keyof typeof CURATED_THEMATIC_PHOTOS];

    // 2. Post de fin avec photo de bilan réaliste
    if (thematic) {
      const finishPhotoEntry = faker.helpers.arrayElement(thematic.finishPostPhotos);
      const finishPhotoFileId = await this.uploader.uploadImage(
        finishPhotoEntry.url,
        'ENTITY_TYPE_POST',
        event.organizer.accessToken,
      );

      const finishCode = faker.string.alphanumeric(4).toUpperCase();
      await this.client.createPost(event.organizer.accessToken, {
        title: `Bilan : ${event.title} [${finishCode}]`,
        content: `Un immense bravo à tous les bénévoles mobilisés ! ${finishPhotoEntry.caption}. À très vite pour la prochaine édition !`,
        eventId: event.eventId,
        fileIds: finishPhotoFileId ? [finishPhotoFileId] : [],
      });
    }

    // 3. Passage en statut FINISHED (clôture officielle et attribution des scores)
    await this.client.changeEventState(
      event.organizer.accessToken,
      event.eventId,
      'EVENT_STATE_FINISHED',
    );

    // 4. Retirer de la liste active -> au prochain tick, ce slot prendra le relais
    this.activeEvents.delete(slotKey);
    console.log(
      `[ParisLiveEngine] 🔄 Slot [${location.postalCode}#${event.slot}] libéré (${this.activeCount(location)} actifs).`,
    );
  }

  /** `actifs/cible` pour l'invariant des arrondissements ; simple compte pour les events posés à la demande. */
  private activeCount(location: ParisLocation): string {
    if (location.district === OFF_GRID_DISTRICT) return String(this.activeEvents.size);
    return `${this.activeEvents.size}/${PARIS_DISTRICTS.length * this.eventsPerDistrict}`;
  }

  /** Active ou coupe la creation de nouveaux events (les events en cours se terminent normalement). */
  setSpawnEnabled(enabled: boolean): void {
    if (this.spawnEnabled !== enabled) {
      this.spawnEnabled = enabled;
      console.log(`[ParisLiveEngine] Creation de nouveaux events ${enabled ? 'reactivee' : 'suspendue'}.`);
    }
  }

  /** Cloture immediatement tous les events encore actifs (entree dans la fenetre de sommeil). */
  async finishAllActive(): Promise<void> {
    const entries = [...this.activeEvents.entries()];
    for (let i = 0; i < entries.length; i += this.parallelBatchSize) {
      await Promise.allSettled(
        entries.slice(i, i + this.parallelBatchSize).map(([slotKey, event]) => {
          const location = PARIS_DISTRICTS.find((d) => d.district === event.district) ?? event.location;
          return this.finishLiveEvent(event, location, slotKey);
        }),
      );
    }
  }

  getActiveEventsCount(): number {
    return this.activeEvents.size;
  }
}
