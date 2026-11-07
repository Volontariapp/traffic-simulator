import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildActorIdentities } from '../src/actors/actor-identity.js';

const roleOf = (i: number) => (i < 5 ? 'ORGANIZER' : 'VOLUNTEER');

describe('buildActorIdentities', () => {
  const identities = buildActorIdentities(300, roleOf);

  it('genere des pseudos uniques pour 300 acteurs', () => {
    assert.equal(new Set(identities.map((i) => i.pseudo)).size, 300);
  });

  it('genere des emails uniques et stables', () => {
    assert.equal(identities[0].email, 'actor.0001@simulator.volontariapp.test');
    assert.equal(identities[299].email, 'actor.0300@simulator.volontariapp.test');
  });

  it('ne laisse aucune trace du mot simulateur', () => {
    for (const { pseudo, bio } of identities) {
      assert.doesNotMatch(pseudo, /sim_user|simulat|actor|\bbot\b|test/i);
      assert.doesNotMatch(bio, /acteur|virtuel|simulat|\bbot\b/i);
    }
  });

  it('produit des pseudos en minuscules ascii courts', () => {
    for (const { pseudo } of identities) {
      assert.match(pseudo, /^[a-z0-9._]{3,30}$/);
    }
  });

  it('est deterministe et stable quand le nombre d acteurs augmente', () => {
    const small = buildActorIdentities(120, roleOf);
    assert.deepEqual(small, identities.slice(0, 120));
    assert.deepEqual(buildActorIdentities(300, roleOf), identities);
  });

  it('utilise des bios differentes selon le role', () => {
    const organizerBios = new Set(identities.slice(0, 5).map((i) => i.bio));
    assert.ok(organizerBios.size >= 1);
    assert.ok(identities.slice(5).some((i) => !organizerBios.has(i.bio)));
  });
});
