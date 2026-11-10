import { randomUUID } from 'node:crypto';
import type { UserAuthCredentials } from '../../clients/api-client.js';
import type { LoadResponse } from '../load-http.js';
import type { LoadTarget } from '../load-request.js';
import type { AppWriteRoute } from './app-profile.js';

/** Ecritures executables. Position et creation d'event restent exclues (decision du 2026-11-09). */
export const EXECUTABLE_WRITES = [
  'wish-toggle',
  'participate-toggle',
  'follow-toggle',
  'pass-feedback',
  'ranking-refresh',
  'like-toggle',
  'comment-cycle',
  'post-cycle',
] as const satisfies readonly AppWriteRoute[];
export type ExecutableWrite = (typeof EXECUTABLE_WRITES)[number];

/**
 * Premier passage (option b) : rien de visible par un vrai utilisateur. Souhaits et participations
 * sur des events DRAFT du pool, follows entre comptes load, passes sur ces memes events.
 * Like, commentaire et post (visibles dans les fils) ne partent que si on les demande.
 */
export const DEFAULT_WRITES: readonly ExecutableWrite[] = [
  'wish-toggle',
  'participate-toggle',
  'follow-toggle',
  'pass-feedback',
];

export function isExecutableWrite(name: string): name is ExecutableWrite {
  return (EXECUTABLE_WRITES as readonly string[]).includes(name);
}

/** Duree de vie d'un post ou d'un commentaire du pool avant sa suppression par son auteur. */
const POST_TTL_MS = 60_000;
const COMMENT_TTL_MS = 30_000;
const PASS_BATCH = 5; // use-swipe-pass-feedback.ts
const PICK_ATTEMPTS = 8;

type Op =
  | { kind: 'add' | 'remove'; set: Map<string, Set<string>>; actorId: string; key: string; pending: string }
  | { kind: 'post-create'; actorId: string; pending: string }
  | { kind: 'post-delete'; actorId: string; postId: string; pending: string }
  | { kind: 'comment-create'; actorId: string; postId: string; pending: string }
  | { kind: 'comment-delete'; actorId: string; pending: string }
  | { kind: 'none' };

interface LivePost {
  id: string;
  authorId: string;
  createdAt: number;
}

interface LiveComment {
  id: string;
  postId: string;
  createdAt: number;
}

/** Sonde des effets asynchrones : une ecriture acceptee annonce le message WebSocket attendu. */
export interface WriteProbe {
  expect(userId: string, event: 'post.liked' | 'post.comment.created', postId: string): void;
}

export interface WritePlannerOptions {
  probe?: WriteProbe;
  loadActors: readonly UserAuthCredentials[];
  fixtureEvents: readonly string[];
  nowMs?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Identifiant d'un objet cree : `{ id }`, `{ post: { id } }` ou `{ comment: { id } }`. */
function createdId(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.id === 'string') return body.id;
  for (const key of ['post', 'comment']) {
    const nested = body[key];
    if (isRecord(nested) && typeof nested.id === 'string') return nested.id;
  }
  return undefined;
}

/**
 * Ecritures de la rampe, toutes depuis le pool `load.NNNN` et vers ses objets. Chaque action est
 * une bascule (souhaiter puis retirer, suivre puis ne plus suivre) ou un cycle (creer puis
 * supprimer apres une courte vie), suivie en memoire : la base ne grossit pas, et le nettoyage
 * final ne trouve que ce qu'un essai interrompu a laisse.
 */
export class WritePlanner {
  private readonly wished = new Map<string, Set<string>>();
  private readonly joined = new Map<string, Set<string>>();
  private readonly following = new Map<string, Set<string>>();
  private readonly liked = new Map<string, Set<string>>();
  private readonly posts = new Map<string, LivePost>();
  private readonly comments = new Map<string, LiveComment>();
  private readonly pending = new Set<string>();
  private readonly ops = new Map<LoadTarget, Op>();
  private readonly nowMs: () => number;

  constructor(private readonly options: WritePlannerOptions) {
    if (options.loadActors.length < 2) throw new Error('Pool de charge insuffisant : 2 comptes au moins');
    if (options.fixtureEvents.length === 0) throw new Error('Aucun event de fixture : lancer yarn load:setup');
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  /** Objets vivants suivis (pour les tests et le journal). */
  stats(): { posts: number; comments: number; pending: number } {
    return { posts: this.posts.size, comments: this.comments.size, pending: this.pending.size };
  }

  build(route: ExecutableWrite, rng: () => number): LoadTarget {
    switch (route) {
      case 'wish-toggle':
        return this.toggleEvent(route, this.wished, 'wish', rng);
      case 'participate-toggle':
        return this.toggleEvent(route, this.joined, 'participate', rng);
      case 'follow-toggle':
        return this.toggleFollow(rng);
      case 'pass-feedback':
        return this.passFeedback(rng);
      case 'ranking-refresh': {
        const actor = this.actor(rng);
        const listKind = rng() < 0.5 ? 'EVENT' : 'POST';
        return this.track(
          { route, path: '/ranking/refresh', method: 'POST', body: { listKind }, token: actor.accessToken },
          { kind: 'none' },
        );
      }
      case 'post-cycle':
        return this.postCycle(rng);
      case 'like-toggle':
        return this.toggleLike(rng);
      case 'comment-cycle':
        return this.commentCycle(rng);
    }
  }

  observe(target: LoadTarget, response: LoadResponse): void {
    const op = this.ops.get(target);
    if (!op) return;
    this.ops.delete(target);
    if (op.kind === 'none') return;
    this.pending.delete(op.pending);
    const { status } = response;
    const ok = status >= 200 && status < 300;

    switch (op.kind) {
      case 'add':
        // 409 : deja present cote serveur, l'etat local se recale
        if (ok || status === 409) this.setFor(op.set, op.actorId).add(op.key);
        if (ok && op.set === this.liked) this.options.probe?.expect(op.actorId, 'post.liked', op.key);
        if (ok && op.set === this.joined) this.setFor(this.wished, op.actorId).delete(op.key);
        return;
      case 'remove':
        if (ok || status === 404) this.setFor(op.set, op.actorId).delete(op.key);
        return;
      case 'post-create': {
        const id = ok ? createdId(response.body) : undefined;
        if (id) this.posts.set(id, { id, authorId: op.actorId, createdAt: this.nowMs() });
        return;
      }
      case 'post-delete':
        if (ok || status === 404) this.forgetPost(op.postId);
        return;
      case 'comment-create': {
        const id = ok ? createdId(response.body) : undefined;
        if (id) this.comments.set(op.actorId, { id, postId: op.postId, createdAt: this.nowMs() });
        if (ok) this.options.probe?.expect(op.actorId, 'post.comment.created', op.postId);
        return;
      }
      case 'comment-delete':
        if (ok || status === 404) this.comments.delete(op.actorId);
        return;
    }
  }

  private track(target: LoadTarget, op: Op): LoadTarget {
    this.ops.set(target, op);
    if (op.kind !== 'none') this.pending.add(op.pending);
    return target;
  }

  private actor(rng: () => number): UserAuthCredentials {
    const actors = this.options.loadActors;
    return actors[Math.floor(rng() * actors.length)];
  }

  private setFor(map: Map<string, Set<string>>, actorId: string): Set<string> {
    let set = map.get(actorId);
    if (!set) {
      set = new Set();
      map.set(actorId, set);
    }
    return set;
  }

  private toggleEvent(
    route: 'wish-toggle' | 'participate-toggle',
    set: Map<string, Set<string>>,
    action: 'wish' | 'participate',
    rng: () => number,
  ): LoadTarget {
    const events = this.options.fixtureEvents;
    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      const actor = this.actor(rng);
      const eventId = events[Math.floor(rng() * events.length)];
      const key = `event:${actor.id}:${eventId}`;
      // Pas de souhait sur un event rejoint (participate retire le souhait cote serveur)
      if (this.pending.has(key)) continue;
      if (action === 'wish' && this.setFor(this.joined, actor.id).has(eventId)) continue;
      const present = this.setFor(set, actor.id).has(eventId);
      return this.track(
        {
          route,
          path: `/social/events/${eventId}/${action}`,
          method: present ? 'DELETE' : 'POST',
          token: actor.accessToken,
        },
        { kind: present ? 'remove' : 'add', set, actorId: actor.id, key: eventId, pending: key },
      );
    }
    return this.passFeedback(rng);
  }

  private toggleFollow(rng: () => number): LoadTarget {
    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      const actor = this.actor(rng);
      const target = this.actor(rng);
      const key = `follow:${actor.id}:${target.id}`;
      if (target.id === actor.id || this.pending.has(key)) continue;
      const present = this.setFor(this.following, actor.id).has(target.id);
      return this.track(
        {
          route: 'follow-toggle',
          path: `/social/follow/${target.id}`,
          method: present ? 'DELETE' : 'POST',
          token: actor.accessToken,
        },
        { kind: present ? 'remove' : 'add', set: this.following, actorId: actor.id, key: target.id, pending: key },
      );
    }
    return this.passFeedback(rng);
  }

  private passFeedback(rng: () => number): LoadTarget {
    const actor = this.actor(rng);
    const events = [...this.options.fixtureEvents];
    const items: { eventId: string; action: 'PASS' }[] = [];
    while (items.length < PASS_BATCH && events.length > 0) {
      const [eventId] = events.splice(Math.floor(rng() * events.length), 1);
      items.push({ eventId, action: 'PASS' });
    }
    return this.track(
      { route: 'pass-feedback', path: '/ranking/events/feedback', method: 'POST', body: { items }, token: actor.accessToken },
      { kind: 'none' },
    );
  }

  private postCycle(rng: () => number): LoadTarget {
    const now = this.nowMs();
    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      const actor = this.actor(rng);
      const key = `post:${actor.id}`;
      if (this.pending.has(key)) continue;
      const own = [...this.posts.values()].find((post) => post.authorId === actor.id);
      if (own && now - own.createdAt >= POST_TTL_MS) {
        return this.track(
          { route: 'post-cycle', path: `/posts/${own.id}`, method: 'DELETE', token: actor.accessToken },
          { kind: 'post-delete', actorId: actor.id, postId: own.id, pending: key },
        );
      }
      if (own) continue;
      return this.track(
        {
          route: 'post-cycle',
          path: '/posts',
          method: 'POST',
          token: actor.accessToken,
          harvest: true,
          body: {
            title: `Petit retour d'action ${randomUUID().slice(0, 8)}`,
            content: 'Belle matinee avec l equipe, merci a toutes et tous.',
            fileIds: [],
            idempotencyKey: randomUUID(),
          },
        },
        { kind: 'post-create', actorId: actor.id, pending: key },
      );
    }
    return this.passFeedback(rng);
  }

  private livePost(rng: () => number, notBy: string): LivePost | undefined {
    const candidates = [...this.posts.values()].filter((post) => post.authorId !== notBy);
    return candidates.length === 0 ? undefined : candidates[Math.floor(rng() * candidates.length)];
  }

  private toggleLike(rng: () => number): LoadTarget {
    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      const actor = this.actor(rng);
      const post = this.livePost(rng, actor.id);
      // Aucun post du pool vivant : on en cree un (le like suivant aura une cible)
      if (!post) return this.postCycle(rng);
      const key = `like:${actor.id}:${post.id}`;
      if (this.pending.has(key)) continue;
      const present = this.setFor(this.liked, actor.id).has(post.id);
      return this.track(
        {
          route: 'like-toggle',
          path: `/social/likes/${post.id}`,
          method: present ? 'DELETE' : 'POST',
          token: actor.accessToken,
        },
        { kind: present ? 'remove' : 'add', set: this.liked, actorId: actor.id, key: post.id, pending: key },
      );
    }
    return this.passFeedback(rng);
  }

  private commentCycle(rng: () => number): LoadTarget {
    const now = this.nowMs();
    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      const actor = this.actor(rng);
      const key = `comment:${actor.id}`;
      if (this.pending.has(key)) continue;
      const own = this.comments.get(actor.id);
      if (own && now - own.createdAt >= COMMENT_TTL_MS) {
        return this.track(
          {
            route: 'comment-cycle',
            path: `/posts/${own.postId}/comments/${own.id}`,
            method: 'DELETE',
            token: actor.accessToken,
          },
          { kind: 'comment-delete', actorId: actor.id, pending: key },
        );
      }
      if (own) continue;
      const post = this.livePost(rng, actor.id);
      if (!post) return this.postCycle(rng);
      return this.track(
        {
          route: 'comment-cycle',
          path: `/posts/${post.id}/comments`,
          method: 'POST',
          token: actor.accessToken,
          harvest: true,
          body: { content: 'Bravo pour cette action !' },
        },
        { kind: 'comment-create', actorId: actor.id, postId: post.id, pending: key },
      );
    }
    return this.passFeedback(rng);
  }

  /** Un post supprime emporte ses likes et commentaires : l'etat local les oublie aussi. */
  private forgetPost(postId: string): void {
    this.posts.delete(postId);
    for (const set of this.liked.values()) set.delete(postId);
    for (const [actorId, comment] of this.comments) {
      if (comment.postId === postId) this.comments.delete(actorId);
    }
  }
}
