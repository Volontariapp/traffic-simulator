import { StatsWindow, type Sample, type WindowStats } from './latency-stats.js';

export interface OnsetSecond {
  /** Seconde de lancement depuis le debut du palier (0 = premiere seconde). */
  second: number;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface OnsetStats {
  seconds: number;
  stats: WindowStats;
  /** Une ligne par seconde de lancement, dans l'ordre, secondes vides comprises. */
  series: OnsetSecond[];
}

/**
 * Debut de palier lu a part (demarrage a froid, attaque brutale) : chaque requete est rangee selon
 * l'instant ou elle est partie, pas celui ou elle a repondu. Une requete lancee a la seconde 2 qui
 * repond en 8 s compte dans la seconde 2 : c'est ce que vit un utilisateur arrive a ce moment-la.
 */
export class OnsetRecorder {
  private readonly total = new StatsWindow();
  private readonly bySecond = new Map<number, StatsWindow>();

  constructor(
    private readonly startedAtMs: number,
    readonly seconds: number,
  ) {}

  /** Vrai si une requete lancee a `firedAtMs` appartient au debut de palier. */
  covers(firedAtMs: number): boolean {
    return firedAtMs - this.startedAtMs < this.seconds * 1000;
  }

  add(sample: Sample, firedAtMs: number): void {
    const second = Math.max(0, Math.floor((firedAtMs - this.startedAtMs) / 1000));
    this.total.add(sample);
    let bucket = this.bySecond.get(second);
    if (!bucket) {
      bucket = new StatsWindow();
      this.bySecond.set(second, bucket);
    }
    bucket.add(sample);
  }

  snapshot(): OnsetStats {
    const series: OnsetSecond[] = [];
    for (let second = 0; second < this.seconds; second++) {
      const snap = this.bySecond.get(second)?.snapshot();
      series.push({
        second,
        count: snap?.count ?? 0,
        errors: snap?.errors ?? 0,
        p50: snap?.p50 ?? 0,
        p95: snap?.p95 ?? 0,
        p99: snap?.p99 ?? 0,
      });
    }
    return { seconds: this.seconds, stats: this.total.snapshot(), series };
  }
}
