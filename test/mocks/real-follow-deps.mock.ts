import { mock } from 'node:test';
import type { RealFollowApi } from '../../src/engines/real-user-follow.engine.js';

export interface FakeUser {
  id: string;
  email: string;
  pseudo?: string;
}

export function createRealFollowApiMock(initialUsers: FakeUser[] = []) {
  const state = { users: initialUsers, loginOk: true, listOk: true };
  const api = {
    login: mock.fn(async () =>
      state.loginOk ? { user: { id: 'admin' }, accessToken: 'admin-token' } : {},
    ),
    listUsers: mock.fn(async (_token: string, page: number, limit: number) =>
      state.listOk ? state.users.slice((page - 1) * limit, page * limit) : undefined,
    ),
    followUser: mock.fn(async (): Promise<'created' | 'exists' | 'failed'> => 'created'),
  } satisfies RealFollowApi;
  return { api, state };
}
