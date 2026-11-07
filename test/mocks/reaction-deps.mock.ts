import { mock } from 'node:test';
import type { UserAuthCredentials } from '../../src/clients/api-client.js';
import type { ReactionActors, ReactionApi } from '../../src/engines/user-reaction.engine.js';

export interface FakePost {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt?: string;
}

export function createReactionApiMock(initialPosts: FakePost[] = []) {
  const state = { posts: initialPosts };
  const api = {
    listEvents: mock.fn(async () => []),
    listPosts: mock.fn(async () => state.posts),
    participateEvent: mock.fn(async () => true),
    likePost: mock.fn(async () => true),
    createComment: mock.fn(async () => true),
  } satisfies ReactionApi;
  return { api, state };
}

export function createReactionActorsMock(actors: UserAuthCredentials[]) {
  const simulatedIds = new Set(actors.map((a) => a.id));
  return {
    pickOrganizer: () => actors[0],
    getAllActors: () => actors,
    getActorById: (id: string) => actors.find((a) => a.id === id),
    isSimulatedUser: (id?: string) => (id ? simulatedIds.has(id) : false),
  } satisfies ReactionActors;
}
