import { mock } from 'node:test';
import type { SchedulerClock } from '../../src/load/rate-scheduler.js';
import type { LoadResponse, LoadSender } from '../../src/load/load-http.js';

/** Horloge manuelle : `sleep` avance le temps sans attendre, les tests de debit sont instantanes. */
export class FakeClock implements SchedulerClock {
  private time = 0;

  now(): number {
    return this.time;
  }

  async sleep(ms: number): Promise<void> {
    this.time += ms;
  }
}

export function createSenderMock(
  respond: (callIndex: number) => Promise<LoadResponse> | LoadResponse = () => ({
    status: 200,
    ms: 20,
    timedOut: false,
  }),
) {
  let calls = 0;
  return mock.fn<LoadSender>(async () => respond(calls++));
}

/** Reponse jamais resolue : simule un serveur qui ne repond plus. */
export function neverResolves(): Promise<LoadResponse> {
  return new Promise<LoadResponse>(() => undefined);
}
