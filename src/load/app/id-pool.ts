/**
 * Identifiants vus dans les reponses (posts, events, utilisateurs), bornes en memoire : au-dela de
 * `capacity`, le plus ancien sort. Les routes de detail y tirent leur cible, comme l'app ouvre un
 * element qu'elle vient d'afficher.
 */
export class IdPool {
  private readonly ids: string[] = [];
  private readonly known = new Set<string>();
  private next = 0;

  constructor(private readonly capacity = 1000) {}

  get size(): number {
    return this.ids.length;
  }

  add(id: unknown): void {
    if (typeof id !== 'string' || id === '' || this.known.has(id)) return;
    if (this.ids.length < this.capacity) {
      this.ids.push(id);
    } else {
      this.known.delete(this.ids[this.next]);
      this.ids[this.next] = id;
      this.next = (this.next + 1) % this.capacity;
    }
    this.known.add(id);
  }

  pick(rng: () => number): string | undefined {
    if (this.ids.length === 0) return undefined;
    return this.ids[Math.floor(rng() * this.ids.length)];
  }

  /** Jusqu'a `count` identifiants distincts. */
  sample(count: number, rng: () => number): string[] {
    const picked = new Set<string>();
    const wanted = Math.min(count, this.ids.length);
    for (let attempt = 0; picked.size < wanted && attempt < wanted * 4; attempt++) {
      const id = this.pick(rng);
      if (id !== undefined) picked.add(id);
    }
    return [...picked];
  }
}
