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
export function dueCount(elapsedMs: number, ratePerSec: number, alreadySent: number, rampUpMs = 0): number {
  return Math.max(0, plannedCount(elapsedMs, ratePerSec, rampUpMs) - alreadySent);
}

/**
 * Requetes prevues depuis le debut. Sans rampe, debit constant. Avec `rampUpMs`, le debit monte
 * lineairement de 0 a `ratePerSec` : le cumul est l'aire du triangle, puis le debit plein.
 */
export function plannedCount(elapsedMs: number, ratePerSec: number, rampUpMs = 0): number {
  if (rampUpMs <= 0) return Math.floor((elapsedMs * ratePerSec) / 1000);
  if (elapsedMs < rampUpMs) return Math.floor((ratePerSec * elapsedMs * elapsedMs) / (2 * rampUpMs * 1000));
  return Math.floor((ratePerSec * rampUpMs) / 2000 + (ratePerSec * (elapsedMs - rampUpMs)) / 1000);
}

export interface RunAtRateOptions {
  ratePerSec: number;
  durationMs: number;
  /** Lance une requete sans l'attendre : le debit ne depend jamais du temps de reponse (boucle ouverte). */
  fire: () => void;
  shouldStop: () => boolean;
  clock?: SchedulerClock;
  tickMs?: number;
  /** Montee lineaire de 0 au debit cible sur ce delai (0 ou absent : debit plein des le depart). */
  rampUpMs?: number;
}

/** Emet a debit constant pendant `durationMs`. Retourne le nombre de requetes lancees. */
export async function runAtRate(options: RunAtRateOptions): Promise<{ sent: number }> {
  const clock = options.clock ?? systemClock;
  const tickMs = options.tickMs ?? 5;
  const rampUpMs = options.rampUpMs ?? 0;
  const start = clock.now();
  let sent = 0;

  const emit = (count: number): void => {
    for (let i = 0; i < count; i++) options.fire();
    sent += count;
  };

  while (!options.shouldStop()) {
    const elapsed = clock.now() - start;
    if (elapsed >= options.durationMs) {
      emit(dueCount(options.durationMs, options.ratePerSec, sent, rampUpMs));
      break;
    }
    emit(dueCount(elapsed, options.ratePerSec, sent, rampUpMs));
    await clock.sleep(tickMs);
  }
  return { sent };
}
