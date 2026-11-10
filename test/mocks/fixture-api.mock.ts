import { mock } from 'node:test';
import type { FixtureApi } from '../../src/load/fixtures/load-fixtures.js';

/**
 * Serveur simule pour les fixtures de la rampe : events (titre, noeud social), et par compte
 * (jeton) ses follows, souhaits et participations.
 */
export function createFixtureApiMock(options: { nodeDelayPolls?: number } = {}) {
  const titles = new Map<string, string>();
  const createdBy = new Map<string, string[]>();
  const nodePolls = new Map<string, number>();
  const follows = new Map<string, Set<string>>();
  const wishes = new Map<string, Set<string>>();
  const joins = new Map<string, Set<string>>();
  let counter = 0;
  const setOf = (map: Map<string, Set<string>>, token: string): Set<string> => {
    let set = map.get(token);
    if (!set) {
      set = new Set();
      map.set(token, set);
    }
    return set;
  };

  const api = {
    createEvent: mock.fn<FixtureApi['createEvent']>(async (token, payload) => {
      const id = `event-${++counter}`;
      titles.set(id, payload.title);
      createdBy.set(token, [...(createdBy.get(token) ?? []), id]);
      nodePolls.set(id, 0);
      return id;
    }),
    deleteEvent: mock.fn<FixtureApi['deleteEvent']>(async (token, id) => {
      titles.delete(id);
      createdBy.set(token, (createdBy.get(token) ?? []).filter((e) => e !== id));
      return true;
    }),
    listMySocialEventIds: mock.fn<FixtureApi['listMySocialEventIds']>(async (token, list) => {
      if (list === 'created') return [...(createdBy.get(token) ?? [])];
      return [...setOf(list === 'wished' ? wishes : joins, token)];
    }),
    getEventTitle: mock.fn<FixtureApi['getEventTitle']>(async (_token, id) => titles.get(id)),
    eventNodeExists: mock.fn<FixtureApi['eventNodeExists']>(async (_token, id) => {
      const polls = (nodePolls.get(id) ?? 0) + 1;
      nodePolls.set(id, polls);
      return polls > (options.nodeDelayPolls ?? 0);
    }),
    listMyFollowIds: mock.fn<FixtureApi['listMyFollowIds']>(async (token) => [...setOf(follows, token)]),
    unfollowUser: mock.fn<FixtureApi['unfollowUser']>(async (token, id) => setOf(follows, token).delete(id) || true),
    unwishEvent: mock.fn<FixtureApi['unwishEvent']>(async (token, id) => setOf(wishes, token).delete(id) || true),
    unparticipateEvent: mock.fn<FixtureApi['unparticipateEvent']>(
      async (token, id) => setOf(joins, token).delete(id) || true,
    ),
  };

  /** Etat initial : un event existant hors fixture, des relations du pool et hors pool. */
  const seed = {
    foreignEvent(token: string, id: string, title: string): void {
      titles.set(id, title);
      createdBy.set(token, [...(createdBy.get(token) ?? []), id]);
    },
    follow: (token: string, id: string) => setOf(follows, token).add(id),
    wish: (token: string, id: string) => setOf(wishes, token).add(id),
    join: (token: string, id: string) => setOf(joins, token).add(id),
  };
  return { api, seed };
}
