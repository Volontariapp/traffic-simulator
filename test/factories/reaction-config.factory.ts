import type { ReactionConfig } from '../../src/config/simulator-config.js';

export function buildReactionConfig(overrides: Partial<ReactionConfig> = {}): ReactionConfig {
  return {
    scanIntervalMs: 4000,
    tickIntervalMs: 1000,
    likesMin: 12,
    likesMax: 25,
    commentsMin: 4,
    commentsMax: 8,
    ...overrides,
  };
}
