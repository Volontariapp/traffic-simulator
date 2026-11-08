import { mock } from 'node:test';
import type { SocialApi } from '../../src/engines/social-graph.engine.js';

export function createSocialApiMock(options: { existing?: boolean; isFollowing?: boolean } = {}) {
  const api = {
    followUser: mock.fn(async (): Promise<'created' | 'exists' | 'failed'> =>
      options.existing ? 'exists' : 'created',
    ),
    isFollowing: mock.fn(async (): Promise<boolean | undefined> => options.isFollowing ?? false),
  } satisfies SocialApi;
  return api;
}
