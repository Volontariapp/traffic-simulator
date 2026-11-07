import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRng } from '../src/actors/actor-identity.js';
import { buildReactionPlan } from '../src/engines/reaction-plan.js';
import { buildReactionConfig } from './factories/reaction-config.factory.js';
import { buildActors } from './factories/actor.factory.js';

const candidates = buildActors(300).map((a) => a.id);

function plan(seed: number, title = 'Grande maraude du quartier') {
  return buildReactionPlan({
    title,
    candidateActorIds: candidates,
    config: buildReactionConfig(),
    rng: createRng(seed),
  });
}

describe('buildReactionPlan', () => {
  it('respecte les fourchettes de likes et de commentaires', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = plan(seed);
      const likes = result.filter((r) => r.kind === 'like').length;
      const comments = result.filter((r) => r.kind === 'comment').length;
      assert.ok(likes >= 12 && likes <= 25, `likes=${likes}`);
      assert.ok(comments >= 4 && comments <= 8, `comments=${comments}`);
    }
  });

  it('un acteur like au plus une fois et commente au plus une fois', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = plan(seed);
      for (const kind of ['like', 'comment'] as const) {
        const ids = result.filter((r) => r.kind === kind).map((r) => r.actorId);
        assert.equal(new Set(ids).size, ids.length);
      }
    }
  });

  it('est triee par delai croissant', () => {
    const result = plan(7);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i].atMs >= result[i - 1].atMs);
    }
  });

  it('fait arriver des likes et un commentaire en moins de 20 secondes', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = plan(seed);
      const fastLikes = result.filter((r) => r.kind === 'like' && r.atMs <= 20_000).length;
      const firstComment = result.find((r) => r.kind === 'comment');
      assert.ok(fastLikes >= 4, `fastLikes=${fastLikes}`);
      assert.ok(firstComment && firstComment.atMs >= 4_000 && firstComment.atMs <= 9_000);
    }
  });

  it('ne repete pas un meme texte de commentaire sur un post', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const texts = plan(seed)
        .filter((r) => r.kind === 'comment')
        .map((r) => r.text);
      assert.ok(texts.every((t) => typeof t === 'string' && t.length > 0));
      assert.equal(new Set(texts).size, texts.length);
    }
  });

  it('plafonne au nombre d acteurs disponibles', () => {
    const result = buildReactionPlan({
      title: 'x',
      candidateActorIds: candidates.slice(0, 3),
      config: buildReactionConfig(),
      rng: createRng(1),
    });
    assert.equal(result.filter((r) => r.kind === 'like').length, 3);
    assert.equal(result.filter((r) => r.kind === 'comment').length, 3);
  });

  it('retourne un plan vide sans acteur disponible', () => {
    const result = buildReactionPlan({
      title: 'x',
      candidateActorIds: [],
      config: buildReactionConfig(),
      rng: createRng(1),
    });
    assert.deepEqual(result, []);
  });

  it('est deterministe pour un rng donne', () => {
    assert.deepEqual(plan(42), plan(42));
  });
});
