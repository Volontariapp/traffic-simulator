export interface FollowParticipant {
  /** Identifiant utilisateur (cible des appels API). */
  id: string;
  /** Cle stable (email) : le plan ne depend jamais de l'ordre ni de la presence des autres acteurs. */
  key: string;
}

export interface FollowEdge {
  followerId: string;
  followedId: string;
}

export interface FollowRange {
  min: number;
  max: number;
}

/** Poids de popularite : plancher pour que tout le monde puisse etre suivi, queue longue au-dessus. */
const POPULARITY_FLOOR = 0.1;
const POPULARITY_SPREAD = 20;
const POPULARITY_EXPONENT = 4;

/** Hachage FNV-1a 32 bits suivi d'un melange final, rendu en flottant dans [0, 1). */
function hash01(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

function popularity(participant: FollowParticipant): number {
  return POPULARITY_FLOOR + POPULARITY_SPREAD * hash01(`${participant.key}#popularity`) ** POPULARITY_EXPONENT;
}

/**
 * Plan de follow entre acteurs : chaque acteur en suit entre `min` et `max`, choisis avec une
 * preference pour les comptes populaires (queue longue : quelques comptes tres suivis, la plupart peu).
 * Une part des cibles suit en retour (`reciprocity`, entre 0 et 1).
 *
 * Pur et sans etat : le choix d'un acteur ne depend que des cles (echantillonnage pondere par cle
 * de hachage, Efraimidis-Spirakis). Retirer un acteur absent ne modifie donc pas les follows des autres,
 * et un redeploiement retrouve exactement les memes liens.
 */
export function buildFollowPlan(params: {
  participants: readonly FollowParticipant[];
  follows: FollowRange;
  reciprocity: number;
}): FollowEdge[] {
  const { participants, follows, reciprocity } = params;
  if (participants.length < 2) return [];

  const weights = participants.map(popularity);
  const edges: FollowEdge[] = [];
  const seen = new Set<string>();

  const add = (followerId: string, followedId: string): void => {
    if (followerId === followedId) return;
    const key = `${followerId}>${followedId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ followerId, followedId });
  };

  for (const follower of participants) {
    const span = follows.max - follows.min + 1;
    const wanted = Math.min(
      follows.min + Math.floor(hash01(`${follower.key}#count`) * span),
      participants.length - 1,
    );

    const ranked: Array<{ index: number; score: number }> = [];
    for (let i = 0; i < participants.length; i++) {
      const target = participants[i];
      if (target.id === follower.id) continue;
      const u = hash01(`${follower.key}>${target.key}`);
      ranked.push({ index: i, score: Math.log(u) / weights[i] });
    }
    ranked.sort((a, b) => b.score - a.score);

    for (const { index } of ranked.slice(0, wanted)) {
      const target = participants[index];
      add(follower.id, target.id);
      if (hash01(`${target.key}>${follower.key}#back`) < reciprocity) add(target.id, follower.id);
    }
  }

  return edges;
}

/**
 * Acteurs qui suivent un vrai compte (decouverte d'un nouvel utilisateur).
 * Tirage uniforme sans remise, `count.min` a `count.max` acteurs au plus.
 */
export function pickWelcomeFollowers(params: {
  actorIds: readonly string[];
  count: FollowRange;
  rng: () => number;
}): string[] {
  const { actorIds, count, rng } = params;
  const wanted = Math.min(count.min + Math.floor(rng() * (count.max - count.min + 1)), actorIds.length);
  const pool = [...actorIds];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, wanted);
}
