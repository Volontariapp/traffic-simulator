import { writeFile } from 'node:fs/promises';
import type { WindowStats } from './latency-stats.js';

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
