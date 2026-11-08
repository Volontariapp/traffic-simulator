import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRng } from '../src/actors/actor-identity.js';
import { buildFollowPlan, pickWelcomeFollowers, type FollowParticipant } from '../src/social/follow-plan.js';

function participants(count: number): FollowParticipant[] {
  return Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, key: `actor.${i}@simulator.test` }));
}

const range = { min: 5, max: 30 };

describe('buildFollowPlan', () => {
  it('ne produit ni auto-follow ni doublon', () => {
    const edges = buildFollowPlan({ participants: participants(300), follows: range, reciprocity: 0.3 });
    const seen = new Set<string>();
    for (const edge of edges) {
      assert.notEqual(edge.followerId, edge.followedId);
      const key = `${edge.followerId}>${edge.followedId}`;
      assert.equal(seen.has(key), false, `doublon ${key}`);
      seen.add(key);
    }
  });

  it('donne a chaque acteur entre min et max follows sortants, hors reciprocite', () => {
    const edges = buildFollowPlan({ participants: participants(300), follows: range, reciprocity: 0 });
    const out = new Map<string, number>();
    for (const edge of edges) out.set(edge.followerId, (out.get(edge.followerId) ?? 0) + 1);
    assert.equal(out.size, 300);
    for (const count of out.values()) assert.ok(count >= range.min && count <= range.max, `count=${count}`);
  });

  it('est deterministe', () => {
    const a = buildFollowPlan({ participants: participants(120), follows: range, reciprocity: 0.3 });
    const b = buildFollowPlan({ participants: participants(120), follows: range, reciprocity: 0.3 });
    assert.deepEqual(a, b);
  });

  it('concentre les follows sur quelques comptes populaires', () => {
    const edges = buildFollowPlan({ participants: participants(500), follows: range, reciprocity: 0 });
    const incoming = new Map<string, number>();
    for (const edge of edges) incoming.set(edge.followedId, (incoming.get(edge.followedId) ?? 0) + 1);
    const counts = [...incoming.values()].sort((x, y) => y - x);
    const top = counts[0];
    const median = counts[Math.floor(counts.length / 2)];
    assert.ok(top >= median * 4, `top=${top} median=${median}`);
  });

  it('ajoute des follow-back mutuels avec la reciprocite', () => {
    const none = buildFollowPlan({ participants: participants(200), follows: range, reciprocity: 0 });
    const some = buildFollowPlan({ participants: participants(200), follows: range, reciprocity: 0.5 });
    assert.ok(some.length > none.length);
  });

  it('reste borne quand il y a moins d acteurs que le maximum demande', () => {
    const edges = buildFollowPlan({ participants: participants(8), follows: range, reciprocity: 0 });
    assert.ok(edges.length <= 8 * 7);
    assert.ok(edges.length > 0);
  });

  it('garde les follows d un acteur quand un autre acteur est absent', () => {
    const all = participants(200);
    const withoutLast = all.slice(0, -1);
    const full = buildFollowPlan({ participants: all, follows: range, reciprocity: 0 });
    const partial = buildFollowPlan({ participants: withoutLast, follows: range, reciprocity: 0 });
    const missing = all[all.length - 1].id;
    const fullOfFirst = full.filter((e) => e.followerId === 'id-0' && e.followedId !== missing);
    const partialOfFirst = partial.filter((e) => e.followerId === 'id-0');
    assert.ok(fullOfFirst.length > 0);
    for (const edge of fullOfFirst) {
      assert.ok(
        partialOfFirst.some((p) => p.followedId === edge.followedId),
        `follow vers ${edge.followedId} perdu`,
      );
    }
  });

  it('retourne un plan vide sans acteur ni cible', () => {
    assert.deepEqual(buildFollowPlan({ participants: [], follows: range, reciprocity: 0.3 }), []);
    assert.deepEqual(buildFollowPlan({ participants: participants(1), follows: range, reciprocity: 0.3 }), []);
  });
});

describe('pickWelcomeFollowers', () => {
  it('choisit des acteurs distincts dans la fourchette demandee', () => {
    const picked = pickWelcomeFollowers({
      actorIds: participants(100).map((p) => p.id),
      count: { min: 6, max: 15 },
      rng: createRng(9),
    });
    assert.ok(picked.length >= 6 && picked.length <= 15);
    assert.equal(new Set(picked).size, picked.length);
  });

  it('plafonne au nombre d acteurs disponibles', () => {
    const picked = pickWelcomeFollowers({ actorIds: ['a', 'b', 'c'], count: { min: 6, max: 15 }, rng: createRng(1) });
    assert.equal(picked.length, 3);
  });
});
