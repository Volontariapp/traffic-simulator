export interface SchedulerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: SchedulerClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Nombre de requetes a emettre maintenant pour tenir `ratePerSec` : cumul theorique moins ce qui est
 * deja parti. Le retard de l'horloge (tick tardif) est rattrape au tick suivant, le debit moyen reste exact.
 */
export function dueCount(elapsedMs: number, ratePerSec: number, alreadySent: number): number {
  return Math.max(0, Math.floor((elapsedMs * ratePerSec) / 1000) - alreadySent);
}

export interface RunAtRateOptions {
  ratePerSec: number;
  durationMs: number;
  /** Lance une requete sans l'attendre : le debit ne depend jamais du temps de reponse (boucle ouverte). */
  fire: () => void;
  shouldStop: () => boolean;
  clock?: SchedulerClock;
  tickMs?: number;
}

/** Emet a debit constant pendant `durationMs`. Retourne le nombre de requetes lancees. */
export async function runAtRate(options: RunAtRateOptions): Promise<{ sent: number }> {
  const clock = options.clock ?? systemClock;
  const tickMs = options.tickMs ?? 5;
  const start = clock.now();
  let sent = 0;

  const emit = (count: number): void => {
    for (let i = 0; i < count; i++) options.fire();
    sent += count;
  };

  while (!options.shouldStop()) {
    const elapsed = clock.now() - start;
    if (elapsed >= options.durationMs) {
      emit(dueCount(options.durationMs, options.ratePerSec, sent));
      break;
    }
    emit(dueCount(elapsed, options.ratePerSec, sent));
    await clock.sleep(tickMs);
  }
  return { sent };
}
