import { writeFile } from 'node:fs/promises';
import type { WindowStats } from './latency-stats.js';
import type { OnsetStats } from './onset-recorder.js';

export type StopReason = 'completed' | 'abort-policy' | 'declined' | 'signal';

export interface StepResult {
  targetRate: number;
  startedAt: string;
  endedAt: string;
  sent: number;
  dropped: number;
  /** Requetes effectivement lancees (hors dropped) par seconde de mesure. */
  achievedRate: number;
  stats: WindowStats;
  /** Duree de la montee lineaire, absente quand le palier part a plein debit. */
  rampUpSeconds?: number;
  /** Debut de palier lu a part (LOAD_ONSET_SECONDS), montee et echauffement compris. */
  onset?: OnsetStats;
  abortReason?: string;
}

export interface LoadReport {
  startedAt: string;
  endedAt: string;
  baseUrl: string;
  mix: string;
  stopReason: StopReason;
  steps: StepResult[];
  /** Plus haut palier termine sans declencher l'arret automatique. */
  lastHealthyRate?: number;
}

export function findLastHealthyRate(steps: readonly StepResult[]): number | undefined {
  const healthy = steps.filter((s) => s.abortReason === undefined);
  return healthy.length === 0 ? undefined : Math.max(...healthy.map((s) => s.targetRate));
}

function cell(value: number, digits = 0): string {
  return value.toFixed(digits);
}

export function renderMarkdown(report: LoadReport): string {
  const lines = [
    `Rampe de charge sur ${report.baseUrl}`,
    `Debut ${report.startedAt}, fin ${report.endedAt}, arret : ${report.stopReason}`,
    `Melange : ${report.mix}`,
    '',
    '| Cible (req/s) | Obtenu | p50 ms | p95 ms | p99 ms | Erreurs % | 206 | 429 | Dropped | Verdict |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |',
  ];
  for (const step of report.steps) {
    const { stats } = step;
    lines.push(
      `| ${step.targetRate} | ${cell(step.achievedRate, 1)} | ${cell(stats.p50)} | ${cell(stats.p95)} | ${cell(stats.p99)} | ${cell(stats.errorRate * 100, 1)} | ${stats.outcomes.degraded} | ${stats.outcomes.shed} | ${step.dropped} | ${step.abortReason ? `ARRET : ${step.abortReason}` : 'ok'} |`,
    );
  }
  const withOnset = report.steps.filter((step) => step.onset !== undefined);
  if (withOnset.length > 0) {
    lines.push('');
    lines.push('Debut de palier (requetes rangees par seconde de lancement) :');
    lines.push('');
    lines.push('| Cible (req/s) | Secondes | Requetes | p50 ms | p95 ms | p99 ms | Erreurs % | Pire seconde (p95) |');
    lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |');
    for (const step of withOnset) {
      const { onset } = step;
      if (!onset) continue;
      const worst = onset.series.reduce((a, b) => (b.p95 > a.p95 ? b : a), onset.series[0]);
      const worstCell = worst ? `s${worst.second} : ${cell(worst.p95)} ms` : '-';
      lines.push(
        `| ${step.targetRate} | ${onset.seconds} | ${onset.stats.count} | ${cell(onset.stats.p50)} | ${cell(onset.stats.p95)} | ${cell(onset.stats.p99)} | ${cell(onset.stats.errorRate * 100, 1)} | ${worstCell} |`,
      );
    }
  }
  lines.push('');
  lines.push(
    report.lastHealthyRate === undefined
      ? 'Aucun palier termine sans arret automatique.'
      : `Dernier palier sain : ${report.lastHealthyRate} req/s.`,
  );
  return lines.join('\n');
}

export async function writeReport(path: string, report: LoadReport): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
