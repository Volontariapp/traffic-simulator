import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LOCAL_SEED_OFFSET,
  buildActorIdentities,
  localEmailForIndex,
  reservedLocalPseudos,
  reservedMainPseudos,
} from '../src/actors/actor-identity.js';

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

describe('identites des acteurs locaux', () => {
  const options = {
    emailFor: localEmailForIndex,
    seedOffset: LOCAL_SEED_OFFSET,
    reservedPseudos: reservedMainPseudos(),
    localBios: true,
  };
  const locals = buildActorIdentities(60, roleOf, options);

  it('ne partage ni email ni pseudo avec le pool principal', () => {
    const main = buildActorIdentities(1000, roleOf);
    const mainEmails = new Set(main.map((i) => i.email));
    const mainPseudos = new Set(main.map((i) => i.pseudo));
    for (const { email, pseudo } of locals) {
      assert.ok(!mainEmails.has(email), email);
      assert.ok(!mainPseudos.has(pseudo), pseudo);
    }
    assert.equal(new Set(locals.map((i) => i.pseudo)).size, 60);
    assert.equal(locals[0].email, 'local.0001@simulator.volontariapp.test');
  });

  it('n evoque aucun arrondissement dans les bios', () => {
    for (const { bio } of locals) {
      assert.doesNotMatch(bio, /\{district\}|Paris|\d+e\b/);
    }
  });

  it('est deterministe', () => {
    assert.deepEqual(buildActorIdentities(60, roleOf, options), locals);
  });

  it('laisse le pool principal inchange par defaut', () => {
    assert.equal(buildActorIdentities(3, roleOf)[0].email, 'actor.0001@simulator.volontariapp.test');
  });
});


describe('pool principal a 1500 acteurs', () => {
  const mainRole = (i: number) => (i < 375 ? 'ORGANIZER' : 'VOLUNTEER');
  const reserved = reservedLocalPseudos();
  const main = buildActorIdentities(1500, mainRole, { reservedPseudos: reserved });
  const local = buildActorIdentities(200, () => 'VOLUNTEER', {
    emailFor: localEmailForIndex,
    seedOffset: LOCAL_SEED_OFFSET,
    reservedPseudos: reservedMainPseudos(),
    localBios: true,
  });

  it('genere 1500 pseudos uniques, disjoints de ceux des 200 acteurs locaux', () => {
    const mainPseudos = new Set(main.map((i) => i.pseudo));
    assert.equal(mainPseudos.size, 1500);
    assert.equal(new Set(local.map((i) => i.pseudo)).size, 200);
    for (const { pseudo } of local) assert.equal(mainPseudos.has(pseudo), false, `collision ${pseudo}`);
  });

  it('ne change aucune identite des 1000 premiers acteurs deja en base', () => {
    const legacy = buildActorIdentities(1000, mainRole);
    assert.deepEqual(main.slice(0, 1000), legacy);
  });

  it('garde des pseudos valides meme apres suffixe', () => {
    for (const { pseudo } of main) assert.match(pseudo, /^[a-z0-9._]{3,30}$/);
  });
});
