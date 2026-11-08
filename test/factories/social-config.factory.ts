import type { AmbientConfig, RealUsersConfig, SocialConfig } from '../../src/config/simulator-config.js';

export function buildSocialConfig(overrides: Partial<SocialConfig> = {}): SocialConfig {
  return {
    enabled: true,
    followsMin: 5,
    followsMax: 10,
    reciprocity: 0.3,
    concurrency: 10,
    pauseMs: 0,
    forceSync: false,
    ...overrides,
  };
}

export function buildAmbientConfig(overrides: Partial<AmbientConfig> = {}): AmbientConfig {
  return {
    enabled: true,
    actionsPerSec: 10,
    commentRatio: 0.2,
    maxLikesPerPost: 150,
    maxCommentsPerPost: 25,
    burstSize: 0,
    burstIntervalMs: 1_800_000,
    maxConcurrency: 250,
    ...overrides,
  };
}

export function buildRealUsersConfig(overrides: Partial<RealUsersConfig> = {}): RealUsersConfig {
  return {
    enabled: true,
    scanIntervalMs: 120_000,
    followersMin: 6,
    followersMax: 15,
    includeExisting: true,
    ...overrides,
  };
}
