import type { LatencySummary } from './latency-stats.js';

export interface AbortThresholds {
  maxErrorRate: number;
  maxP95Ms: number;
  /** Fenetres consecutives hors seuil avant l'arret. */
  windowsRequired: number;
}

/**
 * Garde-fou : arrete la rampe quand le systeme cede de facon durable. Une seule fenetre mauvaise ne
 * suffit pas (a-coup isole) ; une fenetre saine remet le compteur a zero ; une fenetre vide ne compte pas.
 */
export class AbortPolicy {
  private consecutive = 0;

  constructor(private readonly thresholds: AbortThresholds) {}

  observe(window: LatencySummary): string | undefined {
    const reasons: string[] = [];
    if (window.count > 0 && window.errorRate > this.thresholds.maxErrorRate) {
      reasons.push(
        `erreurs ${(window.errorRate * 100).toFixed(1)} % > ${(this.thresholds.maxErrorRate * 100).toFixed(1)} %`,
      );
    }
    if (window.count > 0 && window.p95 > this.thresholds.maxP95Ms) {
      reasons.push(`p95 ${Math.round(window.p95)} ms > ${this.thresholds.maxP95Ms} ms`);
    }

    if (reasons.length === 0) {
      if (window.count > 0) this.consecutive = 0;
      return undefined;
    }
    this.consecutive += 1;
    if (this.consecutive < this.thresholds.windowsRequired) return undefined;
    return `${reasons.join(' et ')} sur ${this.consecutive} fenetres consecutives`;
  }

  /** Nouveau palier : on repart de zero, un palier ne herite pas des fenetres du precedent. */
  reset(): void {
    this.consecutive = 0;
  }
}
