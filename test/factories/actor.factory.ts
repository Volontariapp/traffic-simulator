import type { UserAuthCredentials } from '../../src/clients/api-client.js';

export function buildActor(index: number, overrides: Partial<UserAuthCredentials> = {}): UserAuthCredentials {
  return {
    id: `actor-${index}`,
    email: `actor.${index}@simulator.test`,
    pseudo: `pseudo_${index}`,
    accessToken: `token-${index}`,
    role: 'VOLUNTEER',
    ...overrides,
  };
}

export function buildActors(count: number): UserAuthCredentials[] {
  return Array.from({ length: count }, (_, i) => buildActor(i));
}
