export interface SleepConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timeZone: string;
  /** Marge avant le debut de la fenetre pendant laquelle on cesse de creer des events. */
  drainSec: number;
}

export type SleepPhase = 'awake' | 'draining' | 'asleep';

const SECONDS_PER_DAY = 86_400;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Leve une RangeError si le fuseau est inconnu. */
export function assertValidTimeZone(timeZone: string): void {
  getFormatter(timeZone);
}

/** Secondes ecoulees depuis minuit dans le fuseau demande. */
export function secondsOfDay(date: Date, timeZone: string): number {
  const parts = getFormatter(timeZone).formatToParts(date);
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return read('hour') * 3600 + read('minute') * 60 + read('second');
}

function inWindow(second: number, startHour: number, endHour: number): boolean {
  const start = startHour * 3600;
  const end = endHour * 3600;
  if (start === end) return false;
  if (start < end) return second >= start && second < end;
  return second >= start || second < end;
}

export function getSleepPhase(now: Date, config: SleepConfig): SleepPhase {
  if (!config.enabled) return 'awake';
  const second = secondsOfDay(now, config.timeZone);
  if (inWindow(second, config.startHour, config.endHour)) return 'asleep';
  const lookahead = (second + config.drainSec) % SECONDS_PER_DAY;
  if (config.drainSec > 0 && inWindow(lookahead, config.startHour, config.endHour)) {
    return 'draining';
  }
  return 'awake';
}
