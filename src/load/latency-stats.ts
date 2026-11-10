export type Outcome =
  | 'ok'
  | 'degraded'
  | 'shed'
  | 'client-error'
  | 'server-error'
  | 'network-error'
  | 'timeout'
  | 'dropped';

export const OUTCOMES: readonly Outcome[] = [
  'ok',
  'degraded',
  'shed',
  'client-error',
  'server-error',
  'network-error',
  'timeout',
  'dropped',
];

/** Issues comptees comme erreur pour l'arret automatique (429 et 206 sont suivies a part). */
const ERROR_OUTCOMES: ReadonlySet<Outcome> = new Set<Outcome>([
  'server-error',
  'network-error',
  'timeout',
  'dropped',
]);

export interface Sample {
  route: string;
  outcome: Outcome;
  ms: number;
}

export interface LatencySummary {
  count: number;
  errors: number;
  errorRate: number;
  /** Part de 429 : un rate limit repond vite, il ne fait ni erreur ni p95 mais invalide la mesure. */
  shedRate: number;
  /** 206 (repli de la gateway, ex. liste de ranking pas encore calculee). */
  degraded: number;
  /** 4xx hors 429 : requete refusee (parametre, 404, 409 d'une bascule). */
  clientErrors: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface WindowStats extends LatencySummary {
  outcomes: Record<Outcome, number>;
  byRoute: Record<string, LatencySummary>;
  /** Par type de requete (`read`, `write`), si le planificateur sait les distinguer. */
  byKind?: Record<string, LatencySummary>;
}

/** Status 0 : pas de reponse (reseau ou delai). 206 : fallback de la gateway. 429 : delestage. */
export function classify(status: number, timedOut: boolean): Outcome {
  if (status === 0) return timedOut ? 'timeout' : 'network-error';
  if (status === 206) return 'degraded';
  if (status === 429) return 'shed';
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  return 'ok';
}

/** Rang le plus proche sur un tableau trie. Vide : 0. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function summarize(samples: readonly Sample[]): LatencySummary {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => ERROR_OUTCOMES.has(s.outcome)).length;
  const shed = samples.filter((s) => s.outcome === 'shed').length;
  const degraded = samples.filter((s) => s.outcome === 'degraded').length;
  const clientErrors = samples.filter((s) => s.outcome === 'client-error').length;
  return {
    count: samples.length,
    errors,
    errorRate: samples.length === 0 ? 0 : errors / samples.length,
    shedRate: samples.length === 0 ? 0 : shed / samples.length,
    degraded,
    clientErrors,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export class StatsWindow {
  private samples: Sample[] = [];

  add(sample: Sample): void {
    this.samples.push(sample);
  }

  snapshot(kindOf?: (route: string) => string): WindowStats {
    const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
    const grouped = new Map<string, Sample[]>();
    for (const sample of this.samples) {
      outcomes[sample.outcome] += 1;
      const list = grouped.get(sample.route);
      if (list) list.push(sample);
      else grouped.set(sample.route, [sample]);
    }
    const byRoute: Record<string, LatencySummary> = {};
    for (const [route, list] of grouped) byRoute[route] = summarize(list);
    if (!kindOf) return { ...summarize(this.samples), outcomes, byRoute };
    const kinds = new Map<string, Sample[]>();
    for (const sample of this.samples) {
      const kind = kindOf(sample.route);
      const list = kinds.get(kind);
      if (list) list.push(sample);
      else kinds.set(kind, [sample]);
    }
    const byKind: Record<string, LatencySummary> = {};
    for (const [kind, list] of kinds) byKind[kind] = summarize(list);
    return { ...summarize(this.samples), outcomes, byRoute, byKind };
  }
}
