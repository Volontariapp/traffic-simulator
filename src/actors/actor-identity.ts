export type ActorRole = 'ORGANIZER' | 'VOLUNTEER';

export interface ActorIdentity {
  email: string;
  pseudo: string;
  bio: string;
}

const FIRST_NAMES = [
  'lea', 'thomas', 'camille', 'julien', 'manon', 'lucas', 'ines', 'hugo', 'chloe', 'nathan',
  'sarah', 'maxime', 'emma', 'antoine', 'clara', 'romain', 'jade', 'alexis', 'louise', 'theo',
  'oceane', 'baptiste', 'lola', 'quentin', 'anais', 'mehdi', 'yasmine', 'karim', 'amina', 'samir',
  'fatou', 'moussa', 'aya', 'bilal', 'nadia', 'rayan', 'leila', 'adam', 'sofia', 'elias',
  'marie', 'pierre', 'juliette', 'paul', 'alice', 'victor', 'zoe', 'arthur', 'eva', 'gabriel',
  'maeva', 'florian', 'pauline', 'kevin', 'marion', 'dylan', 'justine', 'valentin', 'elodie', 'benjamin',
  'axel', 'candice', 'tom', 'jeanne', 'nicolas', 'charlotte', 'simon', 'agathe', 'adrien', 'noemie',
  'matteo', 'lina', 'enzo', 'mila', 'sacha', 'salome', 'tiago', 'ilona', 'yanis', 'rose',
];

const LAST_NAMES = [
  'martin', 'bernard', 'dubois', 'thomas', 'robert', 'richard', 'petit', 'durand', 'leroy', 'moreau',
  'simon', 'laurent', 'lefebvre', 'michel', 'garcia', 'david', 'bertrand', 'roux', 'vincent', 'fournier',
  'morel', 'girard', 'andre', 'mercier', 'dupont', 'lambert', 'bonnet', 'francois', 'martinez', 'legrand',
  'garnier', 'faure', 'rousseau', 'blanc', 'guerin', 'muller', 'henry', 'roussel', 'nicolas', 'perrin',
  'morin', 'mathieu', 'clement', 'gauthier', 'dumont', 'lopez', 'fontaine', 'chevalier', 'robin', 'masson',
  'sanchez', 'gerard', 'nguyen', 'boyer', 'denis', 'lemaire', 'duval', 'joly', 'gautier', 'roger',
  'diallo', 'traore', 'benali', 'haddad', 'ferreira', 'costa', 'silva', 'rodrigues', 'kone', 'cisse',
];

const HOBBIES = [
  'velo', 'rando', 'jardin', 'photo', 'trail', 'bouquins', 'cuisine', 'yoga', 'surf', 'musique',
  'escalade', 'potager', 'cafe', 'bricole', 'running', 'cine','voyage', 'skate', 'bio', 'paris',
];

const ORGANIZER_BIOS = [
  'Coordination de bénévoles sur Paris {district}e. On se retrouve sur le terrain.',
  'Je monte des actions solidaires dans le {district}e, venez nombreux.',
  'Engagé dans la vie associative du {district}e depuis plusieurs années.',
  'Organisation de maraudes et de collectes, Paris {district}e.',
  'Passionné par les projets de quartier. Toujours partant pour une nouvelle idée.',
  'Responsable de petits chantiers citoyens dans le {district}e.',
  'Je fédère les voisins autour d’actions utiles. Paris {district}e.',
  'Bénévole depuis longtemps, organisateur par plaisir.',
];

const VOLUNTEER_BIOS = [
  'Bénévole le week-end, dans le {district}e.',
  'J’aime me rendre utile près de chez moi. Paris {district}e.',
  'Toujours partant pour donner un coup de main.',
  'Nouveau dans le bénévolat, je découvre et j’adore.',
  'Étudiant, un peu de temps libre et l’envie d’aider.',
  'Sensible à l’écologie et à la solidarité de proximité.',
  'Je participe quand mon planning le permet. Paris {district}e.',
  'Voisin du {district}e, curieux et motivé.',
  'Fan des actions de quartier et de bonne humeur.',
  'Un peu de sport, beaucoup de bénévolat.',
  'Là pour rencontrer du monde et faire bouger les choses.',
  'Disponible en soirée et le dimanche.',
];

/** Bios des gens du coin : aucun arrondissement, ils vivent la ou se trouve l'utilisateur. */
const LOCAL_ORGANIZER_BIOS = [
  'Je monte des petites actions solidaires dans mon quartier, venez nombreux.',
  'Engagé dans la vie associative locale depuis plusieurs années.',
  'Organisation de collectes et de chantiers entre voisins.',
  'Passionné par les projets de quartier. Toujours partant pour une nouvelle idée.',
  'Je fédère les voisins autour d’actions utiles près de chez nous.',
  'Bénévole depuis longtemps, organisateur par plaisir.',
];

const LOCAL_VOLUNTEER_BIOS = [
  'Habitant du quartier, partant pour donner un coup de main.',
  'J’aime me rendre utile près de chez moi.',
  'Nouveau dans le coin, je découvre le bénévolat local.',
  'Je participe quand mon planning le permet.',
  'Voisin curieux et motivé.',
  'Fan des actions de quartier et de bonne humeur.',
  'Disponible en soirée et le week-end.',
  'Là pour rencontrer du monde autour de moi.',
];

export interface IdentityOptions {
  /** Email de l'acteur d'index i (defaut : `emailForIndex`). */
  emailFor?: (index: number) => string;
  /** Decale la graine du PRNG pour obtenir d'autres pseudos que le pool principal. */
  seedOffset?: number;
  /** Pseudos deja pris (autre pool) : une collision recoit un suffixe numerique. */
  reservedPseudos?: ReadonlySet<string>;
  /** Bios sans arrondissement parisien. */
  localBios?: boolean;
}

/** PRNG deterministe (mulberry32), independant du faker global. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function ascii(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function twoDigits(rng: () => number): string {
  return String(Math.floor(rng() * 100)).padStart(2, '0');
}

function buildPseudo(rng: () => number): string {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  const style = Math.floor(rng() * 6);
  switch (style) {
    case 0:
      return `${first}_${last}`;
    case 1:
      return `${first}.${last[0]}${twoDigits(rng)}`;
    case 2:
      return `${first}${twoDigits(rng)}`;
    case 3:
      return `${first[0]}_${last}`;
    case 4:
      return `${first}_${ascii(pick(rng, HOBBIES))}`;
    default:
      return `${last}${first[0]}${twoDigits(rng)}`;
  }
}

export function emailForIndex(index: number): string {
  return `actor.${String(index + 1).padStart(4, '0')}@simulator.volontariapp.test`;
}

/**
 * Identites deterministes : l'acteur d'index i recoit toujours le meme pseudo,
 * quel que soit le nombre total d'acteurs. Les collisions sont resolues par un
 * suffixe numerique, en ne dependant que des index precedents.
 */
export function buildActorIdentities(
  count: number,
  roleOf: (index: number) => ActorRole,
  options: IdentityOptions = {},
): ActorIdentity[] {
  const emailFor = options.emailFor ?? emailForIndex;
  const seedOffset = options.seedOffset ?? 0;
  const seen = new Set<string>(options.reservedPseudos);
  const identities: ActorIdentity[] = [];

  for (let index = 0; index < count; index++) {
    const rng = createRng(0x9e3779b1 ^ ((index + seedOffset) * 2654435761));
    let pseudo = ascii(buildPseudo(rng));
    if (seen.has(pseudo)) {
      let suffix = 2;
      while (seen.has(`${pseudo}${suffix}`)) suffix++;
      pseudo = `${pseudo}${suffix}`;
    }
    seen.add(pseudo);

    const district = 1 + Math.floor(rng() * 20);
    const isOrganizer = roleOf(index) === 'ORGANIZER';
    const bios = options.localBios
      ? isOrganizer
        ? LOCAL_ORGANIZER_BIOS
        : LOCAL_VOLUNTEER_BIOS
      : isOrganizer
        ? ORGANIZER_BIOS
        : VOLUNTEER_BIOS;
    const bio = pick(rng, bios).replace('{district}', String(district));

    identities.push({ email: emailFor(index), pseudo, bio });
  }

  return identities;
}

/** Email des acteurs locaux, distinct de `emailForIndex` pour ne jamais melanger les deux pools. */
export function localEmailForIndex(index: number): string {
  return `local.${String(index + 1).padStart(4, '0')}@simulator.volontariapp.test`;
}

/** Decalage de graine des acteurs locaux : au-dela de toute taille realiste du pool principal. */
export const LOCAL_SEED_OFFSET = 100_000;

/** Pseudos que le pool principal peut prendre (jusqu'a 1000 acteurs), a ecarter pour les locaux. */
export function reservedMainPseudos(): Set<string> {
  return new Set(buildActorIdentities(1000, () => 'VOLUNTEER').map((identity) => identity.pseudo));
}
