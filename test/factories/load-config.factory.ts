import type { LoadConfig } from '../../src/load/load-config.js';

export function buildLoadConfig(overrides: Partial<LoadConfig> = {}): LoadConfig {
  return {
    mode: 'routes',
    appMix: [{ route: 'me', weight: 1 }],
    writes: [],
    poolActors: 2,
    baseUrl: 'http://gateway.test/api/v1',
    steps: [10],
    stepSeconds: 2,
    rampUpSeconds: 0,
    warmupSeconds: 0,
    onsetSeconds: 0,
    windowSeconds: 1,
    actors: 10,
    maxInFlight: 1000,
    timeoutMs: 1000,
    abortErrorRate: 0.05,
    abortP95Ms: 2000,
    abortWindows: 2,
    mix: [{ route: 'events-list', weight: 1 }],
    accessHeaders: {},
    confirmEachStep: false,
    reportPath: 'load-report.test.json',
    ...overrides,
  };
}
