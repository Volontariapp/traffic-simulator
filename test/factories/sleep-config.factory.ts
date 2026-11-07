import type { SleepConfig } from '../../src/schedule/sleep-window.js';

export function buildSleepConfig(overrides: Partial<SleepConfig> = {}): SleepConfig {
  return {
    enabled: true,
    startHour: 0,
    endHour: 8,
    timeZone: 'Europe/Paris',
    drainSec: 300,
    ...overrides,
  };
}
