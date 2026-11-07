import { fakerFR as faker } from '@faker-js/faker';
import type { ApiClient } from '../clients/api-client.js';
import type { ActorPool } from '../actors/actor-pool.js';

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
  targetLikes: number;
  targetComments: number;
  likedActorIds: Set<string>;
  commentedActorIds: Set<string>;
  nextLikeAt: number;
  nextCommentAt: number;
  isComplete: boolean;
}

const SUPPORTIVE_COMMENTS_ECOLOGY = [
  'Bravo pour cette belle initiative pour notre quartier ! La planète vous remercie 🌱',
  'Excellente démarche citoyenne ! J’amène des gants et des sacs en renfort !',
  'Super projet de ramassage, hâte de voir le quartier tout propre !',
  'Un grand merci pour l’organisation, c’est exactement ce qu’il fallait faire !',
  'Présent avec grand plaisir ! Superbe énergie collective.',
  'Bravo à toute l’équipe pour ce chantier éco-citoyen 🌍',
];

const SUPPORTIVE_COMMENTS_SOLIDARITY = [
  'Magnifique action de solidarité, tout mon soutien aux organisateurs et bénévoles !',
  'Merci infiniment pour votre engagement au quotidien auprès de ceux qui en ont besoin ❤️',
  'Comptez sur moi pour donner un coup de main au tri et à la distribution !',
  'Superbe mobilisation solidaire, un grand bravo à tous !',
  'Très belle initiative humaine et chaleureuse, merci pour eux.',
  'Bravo pour ce vestiaire solidaire, je ramène également des vêtements chauds !',
];

const SUPPORTIVE_COMMENTS_ANIMAL = [
  'Tellement important de prendre soin de nos petits compagnons de refuge 🐾',
  'Un immense merci pour cette action auprès des animaux !',
  'Superbe promenade solidaire, ils ont tellement besoin d’attention et d’affection.',
  'Bravo pour votre engagement pour la cause animale ❤️',
];

const SUPPORTIVE_COMMENTS_GENERAL = [
  'Superbe initiative, bravo pour l’engagement et l’énergie positive !',
  'Très belle action, ravi de voir la communauté se mobiliser comme ça !',
  'Bravo ! On a besoin de plus d’actions citoyennes de ce genre.',
  'Génial, hâte de voir les photos du bilan ! Bon courage à tous.',
  'Félicitations pour cette organisation au top !',
];

export class UserReactionEngine {
  private monitoredEvents = new Map<string, MonitoredCommunityEvent>();
  private monitoredPosts = new Map<string, MonitoredCommunityPost>();
  private lastScanAt: number = 0;
  private readonly scanIntervalMs: number = 15000; // Scanne toutes les 15 secondes

  constructor(
    private readonly client: ApiClient,
    private readonly pool: ActorPool,
  ) {}

  /**
   * Tick de la boucle de réaction aux actions des utilisateurs réels.
   * Détecte les événements et posts créés par les vrais utilisateurs
   * et y injecte du dynamisme social (bénévoles, likes, commentaires).
   */
  async tick(): Promise<void> {
    const now = Date.now();

    // 1. Scan régulier des nouveaux événements et posts de la communauté
    if (now - this.lastScanAt >= this.scanIntervalMs) {
      this.lastScanAt = now;
      await Promise.allSettled([this.scanCommunityEvents(), this.scanCommunityPosts()]);
    }

    // 2. Traitement des adhésions progressives aux événements utilisateurs
    await this.processEventsJoins(now);

    // 3. Traitement des interactions (likes & commentaires) sur les posts utilisateurs
    await this.processPostsReactions(now);
  }

  /**
   * Détecte les événements créés par des utilisateurs réels (hors vivier de simulateurs).
   */
  private async scanCommunityEvents(): Promise<void> {
    const caller = this.pool.pickOrganizer();
    if (!caller?.accessToken) return;

    try {
      const events = await this.client.listEvents(caller.accessToken, { limit: 50 }, true);

      for (const ev of events) {
        if (!ev.id || !ev.organizerId) continue;

        // Si l'organisateur N'EST PAS un acteur du simulateur -> c'est un vrai utilisateur !
        if (!this.pool.isSimulatedUser(ev.organizerId)) {
          if (!this.monitoredEvents.has(ev.id)) {
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
              `[UserReactionEngine] 🔍 Nouvel événement communautaire détecté : "${ev.title}" (Orga: ${ev.organizerId}). Remplissage automatique programmé (cible: ${targetCount} participants)...`,
            );
          }
        }
      }
    } catch (err) {
      // Ignorer les erreurs transitoires de scan
    }
  }

  /**
   * Détecte les posts créés par des utilisateurs réels (hors vivier de simulateurs).
   */
  private async scanCommunityPosts(): Promise<void> {
    const caller = this.pool.pickOrganizer();
    if (!caller?.accessToken) return;

    try {
      const posts = await this.client.listPosts(caller.accessToken, { limit: 50 }, true);

      for (const p of posts) {
        const authorId = p.authorId || p.userId;
        if (!p.id || !authorId) continue;

        // Si l'auteur N'EST PAS un acteur du simulateur -> c'est un vrai utilisateur !
        if (!this.pool.isSimulatedUser(authorId)) {
          if (!this.monitoredPosts.has(p.id)) {
            this.monitoredPosts.set(p.id, {
              id: p.id,
              title: p.title,
              authorId,
              targetLikes: faker.number.int({ min: 5, max: 10 }),
              targetComments: faker.number.int({ min: 2, max: 4 }),
              likedActorIds: new Set<string>(),
              commentedActorIds: new Set<string>(),
              nextLikeAt: Date.now() + faker.number.int({ min: 2000, max: 6000 }),
              nextCommentAt: Date.now() + faker.number.int({ min: 5000, max: 15000 }),
              isComplete: false,
            });

            console.log(
              `[UserReactionEngine] 📝 Nouveau post communautaire détecté : "${p.title}" (Auteur: ${authorId}). Réactions programmées (likes & commentaires)...`,
            );
          }
        }
      }
    } catch (err) {
      // Ignorer les erreurs transitoires de scan
    }
  }

  /**
   * Remplit progressivement les événements des utilisateurs réels avec des bénévoles.
   */
  private async processEventsJoins(now: number): Promise<void> {
    for (const [eventId, item] of this.monitoredEvents.entries()) {
      if (item.isComplete) continue;

      if (item.joinedActorIds.size >= item.targetCount) {
        item.isComplete = true;
        console.log(
          `[UserReactionEngine] 🎉 Événement utilisateur "${item.title}" complété avec succès (${item.joinedActorIds.size} bénévoles mobilisés) !`,
        );
        continue;
      }

      if (now >= item.nextJoinAt) {
        // Sélectionne un bénévole qui n'a pas encore rejoint cet événement
        const availableVolunteers = this.pool.getAllActors().filter(
          (a) => !item.joinedActorIds.has(a.id) && a.id !== item.organizerId,
        );

        if (availableVolunteers.length > 0) {
          const volunteer = faker.helpers.arrayElement(availableVolunteers);
          const ok = await this.client.participateEvent(volunteer.accessToken, eventId, true);

          if (ok) {
            item.joinedActorIds.add(volunteer.id);
            console.log(
              `[UserReactionEngine] 🙋 ${volunteer.pseudo} a rejoint l’événement de l’utilisateur : "${item.title}" (${item.joinedActorIds.size}/${item.targetCount})`,
            );
          }
        }

        // Prochaine arrivée échelonnée entre 10 et 25 secondes
        item.nextJoinAt = now + faker.number.int({ min: 10000, max: 25000 });
      }
    }
  }

  /**
   * Ajoute progressivement des likes et des commentaires réalistes aux posts des utilisateurs.
   */
  private async processPostsReactions(now: number): Promise<void> {
    for (const [postId, item] of this.monitoredPosts.entries()) {
      if (item.isComplete) continue;

      // 1. Gestion progressive des likes
      if (item.likedActorIds.size < item.targetLikes && now >= item.nextLikeAt) {
        const availableLikers = this.pool.getAllActors().filter(
          (a) => !item.likedActorIds.has(a.id) && a.id !== item.authorId,
        );

        if (availableLikers.length > 0) {
          const liker = faker.helpers.arrayElement(availableLikers);
          const ok = await this.client.likePost(liker.accessToken, postId);
          if (ok) {
            item.likedActorIds.add(liker.id);
            console.log(
              `[UserReactionEngine] ❤️ ${liker.pseudo} a liké le post de l’utilisateur : "${item.title}" (${item.likedActorIds.size}/${item.targetLikes} likes)`,
            );
          }
        }

        item.nextLikeAt = now + faker.number.int({ min: 6000, max: 18000 });
      }

      // 2. Gestion progressive des commentaires réalistes et chaleureux
      if (item.commentedActorIds.size < item.targetComments && now >= item.nextCommentAt) {
        const availableCommenters = this.pool.getAllActors().filter(
          (a) => !item.commentedActorIds.has(a.id) && a.id !== item.authorId,
        );

        if (availableCommenters.length > 0) {
          const commenter = faker.helpers.arrayElement(availableCommenters);
          const commentText = this.pickSupportiveComment(item.title);

          const ok = await this.client.createComment(commenter.accessToken, postId, commentText, true);
          if (ok) {
            item.commentedActorIds.add(commenter.id);
            console.log(
              `[UserReactionEngine] 💬 ${commenter.pseudo} a commenté le post "${item.title}" : "${commentText}" (${item.commentedActorIds.size}/${item.targetComments})`,
            );
          }
        }

        item.nextCommentAt = now + faker.number.int({ min: 15000, max: 40000 });
      }

      // Vérifie si le post a reçu toutes ses interactions
      if (
        item.likedActorIds.size >= item.targetLikes &&
        item.commentedActorIds.size >= item.targetComments
      ) {
        item.isComplete = true;
        console.log(
          `[UserReactionEngine] ✨ Post utilisateur "${item.title}" fully socialized (${item.likedActorIds.size} likes, ${item.commentedActorIds.size} commentaires) !`,
        );
      }
    }
  }

  /**
   * Sélectionne un commentaire pertinent et bienveillant selon la thématique du post.
   */
  private pickSupportiveComment(postTitle: string): string {
    const lower = postTitle.toLowerCase();
    if (lower.includes('déchet') || lower.includes('clean') || lower.includes('arbre') || lower.includes('vert')) {
      return faker.helpers.arrayElement(SUPPORTIVE_COMMENTS_ECOLOGY);
    }
    if (lower.includes('maraude') || lower.includes('repas') || lower.includes('vêtement') || lower.includes('don')) {
      return faker.helpers.arrayElement(SUPPORTIVE_COMMENTS_SOLIDARITY);
    }
    if (lower.includes('chien') || lower.includes('animal') || lower.includes('refuge') || lower.includes('chat')) {
      return faker.helpers.arrayElement(SUPPORTIVE_COMMENTS_ANIMAL);
    }
    return faker.helpers.arrayElement(SUPPORTIVE_COMMENTS_GENERAL);
  }
}
