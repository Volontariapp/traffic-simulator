import { commentPoolFor } from './comment-corpus.js';

export type ReactionKind = 'like' | 'comment';

export interface PlannedReaction {
  /** Delai en ms depuis la detection du post. */
  atMs: number;
  kind: ReactionKind;
  actorId: string;
  text?: string;
}

export interface ReactionPlanConfig {
  likesMin: number;
  likesMax: number;
  commentsMin: number;
  commentsMax: number;
}

/** Part des likes qui arrivent dans la fenetre rapide (premiere vague). */
const FAST_LIKE_RATIO = 0.4;
const FAST_WINDOW_MS = { min: 1_000, max: 20_000 };
const TAIL_WINDOW_MS = { min: 20_000, max: 180_000 };
const FIRST_COMMENT_MS = { min: 4_000, max: 9_000 };
const OTHER_COMMENTS_MS = { min: 10_000, max: 90_000 };

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Construit l'echeancier complet des reactions a un post : qui like, qui commente,
 * quand, avec quel texte. Un acteur like au plus une fois et commente au plus une fois.
 * Pure et deterministe pour un `rng` donne.
 */
export function buildReactionPlan(params: {
  title: string;
  candidateActorIds: readonly string[];
  config: ReactionPlanConfig;
  rng: () => number;
}): PlannedReaction[] {
  const { title, candidateActorIds, config, rng } = params;
  const available = candidateActorIds.length;
  if (available === 0) return [];

  const likeCount = Math.min(intBetween(rng, config.likesMin, config.likesMax), available);
  const commentCount = Math.min(intBetween(rng, config.commentsMin, config.commentsMax), available);

  const plan: PlannedReaction[] = [];

  const likers = shuffled(rng, candidateActorIds).slice(0, likeCount);
  const fastCount = Math.round(likeCount * FAST_LIKE_RATIO);
  likers.forEach((actorId, i) => {
    const window = i < fastCount ? FAST_WINDOW_MS : TAIL_WINDOW_MS;
    plan.push({ atMs: intBetween(rng, window.min, window.max), kind: 'like', actorId });
  });

  const commenters = shuffled(rng, candidateActorIds).slice(0, commentCount);
  const pool = shuffled(rng, commentPoolFor(title));
  const usedTexts = new Set<string>();
  commenters.forEach((actorId, i) => {
    const window = i === 0 ? FIRST_COMMENT_MS : OTHER_COMMENTS_MS;
    const text = pool.find((candidate) => !usedTexts.has(candidate)) ?? pool[i % pool.length];
    usedTexts.add(text);
    plan.push({ atMs: intBetween(rng, window.min, window.max), kind: 'comment', actorId, text });
  });

  return plan.sort((a, b) => a.atMs - b.atMs);
}
