import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient, UserAuthCredentials } from '../clients/api-client.js';
import type { ActorPool } from '../actors/actor-pool.js';
import { PARIS_DISTRICTS, type ParisLocation } from '../geo/paris-districts.js';
import { CURATED_THEMATIC_PHOTOS, detectTheme } from '../media/photo-bank.js';
import type { MediaUploader } from '../media/uploader.js';
import { generateEventBlueprint } from '../templates/event-blueprints.js';

interface ActiveDistrictEvent {
  district: number;
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
  private activeEvents = new Map<number, ActiveDistrictEvent>(); // district (1-20) -> ActiveDistrictEvent

  constructor(
    private readonly client: ApiClient,
    private readonly pool: ActorPool,
    private readonly uploader: MediaUploader,
    private readonly eventLifespanSec: number = 120, // 2 minutes par défaut pour le cycle continu
  ) {}

  /**
   * Vérifie et garantit l'invariant : 1 événement IN_PROGRESS dans CHAQUE arrondissement (1 à 20).
   */
  async tick(): Promise<void> {
    const now = Date.now();

    for (const location of PARIS_DISTRICTS) {
      const current = this.activeEvents.get(location.district);

      if (!current) {
        // Aucun événement en cours dans cet arrondissement : en démarrer un immédiatement !
        await this.startLiveEventInDistrict(location);
      } else if (now - current.startedAt >= current.durationMs) {
        // L'événement a atteint sa fin artificielle : le clôturer avec son post de fin
        await this.finishLiveEvent(current, location);
      } else {
        // Événement en cours : simuler l'activité en direct (nouveaux arrivants et pointage/émargement par le créateur)
        await this.simulateLiveActivity(current, location, now);
      }
    }
  }

  private async startLiveEventInDistrict(location: ParisLocation): Promise<void> {
    const organizer = this.pool.pickOrganizer();
    const blueprint = generateEventBlueprint();
    const themeKey = detectTheme(blueprint.title);
    const thematic = CURATED_THEMATIC_PHOTOS[themeKey];

    console.log(
      `[ParisLiveEngine] 🚀 Démarrage nouvel event [${location.postalCode} - ${location.name}] : "${blueprint.title}" (Organisateur: ${organizer.pseudo})`,
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
      title: `${blueprint.title} (${location.name})`,
      description: `${blueprint.description}\n\nRendez-vous : ${location.address}.`,
      startAt,
      endAt,
      localisationName: location.address,
      type: blueprint.type,
      maxParticipants: blueprint.suggestedMaxParticipants,
      coverFileId,
    });

    if (!eventId) {
      console.warn(`[ParisLiveEngine] ⚠️ Impossible de créer l'event pour le district ${location.district}`);
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

    this.activeEvents.set(location.district, {
      district: location.district,
      eventId,
      title: blueprint.title,
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
      `[ParisLiveEngine] ✅ Event ${location.district}/20 [${location.postalCode}] LIVE pour ~${durationVarianceSec}s avec ${participants.length} bénévoles (${checkedInUserIds.size} pointés à l'arrivée)`,
    );
  }

  private async simulateLiveActivity(
    event: ActiveDistrictEvent,
    location: ParisLocation,
    now: number,
  ): Promise<void> {
    // 1. Arrivée spontanée d'un nouveau bénévole en cours d'événement (30% de chance par tick si max non atteint)
    if (event.participants.length < 12 && Math.random() < 0.3) {
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
            `[ParisLiveEngine] 🙋 Nouvelle arrivée en direct [${location.postalCode}] : ${newVol.pseudo} a rejoint "${event.title}" (${event.participants.length} inscrits)`,
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
            `[ParisLiveEngine] 📋 Émargement [${location.postalCode}] : L'organisateur ${event.organizer.pseudo} a pointé [${checkedNames}] (${event.checkedInUserIds.size}/${event.participants.length} présents)`,
          );
        }
      }
    }
  }

  private async finishLiveEvent(event: ActiveDistrictEvent, location: ParisLocation): Promise<void> {
    console.log(
      `[ParisLiveEngine] 🏁 Clôture de l'event [${location.postalCode}] : "${event.title}" (eventId: ${event.eventId})`,
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
        `[ParisLiveEngine] 📋 Émargement final [${location.postalCode}] : Total ${event.checkedInUserIds.size}/${event.participants.length} bénévoles validés présents avant clôture`,
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
        title: `Bilan : ${event.title} (${location.name}) [${finishCode}]`,
        content: `Un immense bravo à tous les bénévoles mobilisés ! ${finishPhotoEntry.caption}. À très vite pour la prochaine édition !`,
        eventId: event.eventId,
        fileIds: finishPhotoFileId ? [finishPhotoFileId] : [],
      });
    }

    // 2. Passage en statut FINISHED (clôture officielle et attribution des scores)
    await this.client.changeEventState(
      event.organizer.accessToken,
      event.eventId,
      'EVENT_STATE_FINISHED',
    );

    // 3. Retirer de la liste active -> au prochain tick, un nouvel event prendra le relais
    this.activeEvents.delete(location.district);
    console.log(`[ParisLiveEngine] 🔄 District ${location.district} libéré, prêt pour le prochain cycle.`);
  }

  getActiveEventsCount(): number {
    return this.activeEvents.size;
  }
}

