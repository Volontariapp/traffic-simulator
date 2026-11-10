import type { LoadResponse } from '../../src/load/load-http.js';

/** Reponse de liste de la gateway : posts (ranking/feed, /posts) ou events (ranking/events, /events). */
export function buildListResponse(body: { posts?: unknown[]; events?: unknown[] }): LoadResponse {
  return { status: 200, ms: 20, timedOut: false, body };
}

export function buildPost(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `post-${index}`, authorId: `author-${index}`, title: `Post ${index}`, ...overrides };
}

export function buildEvent(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `event-${index}`, organizerId: `organizer-${index}`, ...overrides };
}
