import type { UserAuthCredentials } from '../clients/api-client.js';
import { AbortPolicy } from './abort-policy.js';
import { classify, StatsWindow, type Sample } from './latency-stats.js';
import type { LoadConfig } from './load-config.js';
import type { LoadSender } from './load-http.js';
import { findLastHealthyRate, type LoadReport, type StepResult, type StopReason } from './load-report.js';
import { buildTarget, pickRoute } from './load-request.js';
import { runAtRate, systemClock, type SchedulerClock } from './rate-scheduler.js';

export interface RunnerDeps {
  config: LoadConfig;
  actors: readonly UserAuthCredentials[];
  send: LoadSender;
  log: (line: string) => void;
  shouldStop: () => boolean;
  /** Absent : aucune confirmation. Refus : la rampe s'arrete avant le palier. */
  confirm?: (rate: number) => Promise<boolean>;
  clock?: SchedulerClock;
  rng?: () => number;
  nowIso?: () => string;
}

/** Recoit chaque resultat : dans la fenetre courante et, pendant la mesure, dans le cumul du palier. */
class Sink {
  current = new StatsWindow();
  aggregate?: StatsWindow;

  add(sample: Sample): void {
    this.current.add(sample);
    this.aggregate?.add(sample);
  }
}

function formatWindow(index: number, total: number, snap: ReturnType<StatsWindow['snapshot']>): string {
  return `[load]   fenetre ${index}/${total} : ${snap.count} req, p50 ${Math.round(snap.p50)} ms, p95 ${Math.round(snap.p95)} ms, erreurs ${(snap.errorRate * 100).toFixed(1)} %`;
}

export async function runRamp(deps: RunnerDeps): Promise<LoadReport> {
  const { config, actors } = deps;
  const clock = deps.clock ?? systemClock;
  const rng = deps.rng ?? Math.random;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const policy = new AbortPolicy({
    maxErrorRate: config.abortErrorRate,
    maxP95Ms: config.abortP95Ms,
    windowsRequired: config.abortWindows,
  });
  const sink = new Sink();
  const steps: StepResult[] = [];
  const startedAt = nowIso();
  let inFlight = 0;
  let dropped = 0;
  let stopReason: StopReason = 'completed';

  const fire = (): void => {
    const route = pickRoute(config.mix, rng);
    if (inFlight >= config.maxInFlight) {
      dropped += 1;
      sink.add({ route, outcome: 'dropped', ms: 0 });
      return;
    }
    const actor = actors[Math.floor(rng() * actors.length)];
    const peer = actors[Math.floor(rng() * actors.length)];
    const target = buildTarget(route, peer.id, rng);
    inFlight += 1;
    void (async () => {
      try {
        const res = await deps.send(target, actor.accessToken);
        sink.add({ route, outcome: classify(res.status, res.timedOut), ms: res.ms });
      } catch {
        sink.add({ route, outcome: 'network-error', ms: 0 });
      } finally {
        inFlight -= 1;
      }
    })();
  };

  /** Laisse finir les requetes en vol : le palier suivant ne herite pas d'une file en cours. */
  const drain = async (): Promise<void> => {
    const deadline = clock.now() + config.timeoutMs + 1000;
    while (inFlight > 0 && clock.now() < deadline) await clock.sleep(50);
  };

  for (const rate of config.steps) {
    if (deps.shouldStop()) {
      stopReason = 'signal';
      break;
    }
    if (deps.confirm && !(await deps.confirm(rate))) {
      stopReason = 'declined';
      break;
    }

    policy.reset();
    const stepStartedAt = nowIso();
    deps.log(`[load] palier ${rate} req/s : debut ${stepStartedAt}, echauffement ${config.warmupSeconds} s`);

    sink.aggregate = undefined;
    sink.current = new StatsWindow();
    if (config.warmupSeconds > 0) {
      await runAtRate({
        ratePerSec: rate,
        durationMs: config.warmupSeconds * 1000,
        fire,
        shouldStop: deps.shouldStop,
        clock,
      });
    }

    dropped = 0;
    const aggregate = new StatsWindow();
    sink.aggregate = aggregate;
    const windowCount = Math.max(1, Math.round(config.stepSeconds / config.windowSeconds));
    let sent = 0;
    let windowsRun = 0;
    let abortReason: string | undefined;

    for (let w = 1; w <= windowCount && !deps.shouldStop(); w++) {
      sink.current = new StatsWindow();
      const result = await runAtRate({
        ratePerSec: rate,
        durationMs: config.windowSeconds * 1000,
        fire,
        shouldStop: deps.shouldStop,
        clock,
      });
      sent += result.sent;
      windowsRun += 1;
      const snap = sink.current.snapshot();
      deps.log(formatWindow(w, windowCount, snap));
      abortReason = policy.observe(snap);
      if (abortReason) break;
    }

    await drain();
    sink.aggregate = undefined;
    const stepEndedAt = nowIso();
    if (windowsRun > 0) {
      steps.push({
        targetRate: rate,
        startedAt: stepStartedAt,
        endedAt: stepEndedAt,
        sent,
        dropped,
        achievedRate: (sent - dropped) / (windowsRun * config.windowSeconds),
        stats: aggregate.snapshot(),
        ...(abortReason ? { abortReason } : {}),
      });
    }
    deps.log(
      abortReason
        ? `[load] palier ${rate} req/s : ARRET (${abortReason}), fin ${stepEndedAt}`
        : `[load] palier ${rate} req/s : termine, fin ${stepEndedAt}`,
    );

    if (abortReason) {
      stopReason = 'abort-policy';
      break;
    }
    if (deps.shouldStop()) {
      stopReason = 'signal';
      break;
    }
  }

  const lastHealthyRate = findLastHealthyRate(steps);
  return {
    startedAt,
    endedAt: nowIso(),
    baseUrl: config.baseUrl,
    mix: config.mix.map((m) => `${m.route}:${m.weight}`).join(','),
    stopReason,
    steps,
    ...(lastHealthyRate === undefined ? {} : { lastHealthyRate }),
  };
}
