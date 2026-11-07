export type EventTheme =
  | 'waste_collection'
  | 'solidarity_food'
  | 'urban_gardening'
  | 'animal_shelter'
  | 'bike_repair'
  | 'clothing_donation'
  | 'homework_support';

export interface PhotoCuratedEntry {
  url: string;
  credit: string;
  caption: string;
}

export interface ThematicPhotos {
  theme: EventTheme;
  titleKeywords: string[];
  coverPhotos: PhotoCuratedEntry[];
  startPostPhotos: PhotoCuratedEntry[];
  finishPostPhotos: PhotoCuratedEntry[];
}

export const CURATED_THEMATIC_PHOTOS: Record<EventTheme, ThematicPhotos> = {
  waste_collection: {
    theme: 'waste_collection',
    titleKeywords: ['déchet', 'cleanwalk', 'ramassage', 'plastique', 'dépollution', 'berges'],
    coverPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Cleanwalk and plastic collection',
        caption: 'Bénévoles ramassant des déchets le long des berges avec gants et pinces',
      },
      {
        url: 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Community cleanup volunteer',
        caption: 'Sac de tri sélectif et pince de ramassage en action dans un parc',
      },
    ],
    startPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1595278069441-2cf29f8005a4?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Gloves and bags distribution',
        caption: 'Briefing du matin et distribution des gants de protection et sacs 100L',
      },
    ],
    finishPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Weighed trash bags at the end',
        caption: 'Bilan de la collecte : 14 sacs de déchets et plastiques retirés de la nature !',
      },
    ],
  },
  solidarity_food: {
    theme: 'solidarity_food',
    titleKeywords: ['maraude', 'repas', 'alimentaire', 'soupe', 'solidaire', 'distribution'],
    coverPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Food bank donation and care',
        caption: 'Colis alimentaires et kits de première nécessité préparés par l’équipe',
      },
      {
        url: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Volunteers serving food',
        caption: 'Distribution solidaire chaleureuse aux personnes dans le besoin',
      },
    ],
    startPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1578357078586-491adf1aa5ba?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Cooking soup for volunteers',
        caption: 'Marmites et thermos de café chaud prêts pour la maraude du soir',
      },
    ],
    finishPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Solidarity team debrief',
        caption: 'Maraude terminée : 85 repas chauds distribués et de magnifiques échanges humains',
      },
    ],
  },
  urban_gardening: {
    theme: 'urban_gardening',
    titleKeywords: ['jardin', 'plantation', 'végétalisation', 'arbres', 'compost', 'biodiversité'],
    coverPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Urban gardening community',
        caption: 'Plantation participative d’arbustes et fleurs mellifères au jardin partagé',
      },
      {
        url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Hands holding plant with soil',
        caption: 'Mains dans la terre : repiquage de semis pour verdir le quartier',
      },
    ],
    startPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Seedlings ready for planting',
        caption: 'Bêches, arrosoirs et jeunes pousses prêtes pour le chantier végétalisation',
      },
    ],
    finishPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1592417817098-8f3d69104a47?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Beautiful green garden bed',
        caption: 'Chantier achevé : 40 nouveaux plants arrosés et paillés pour la biodiversité !',
      },
    ],
  },
  animal_shelter: {
    theme: 'animal_shelter',
    titleKeywords: ['animal', 'refuge', 'chiens', 'chats', 'spa', 'promenade'],
    coverPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1548767797-d8c844163c4c?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Walking shelter dog in the park',
        caption: 'Bénévoles promenant les chiens du refuge dans le parc pour leur bien-être',
      },
    ],
    startPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Happy shelter dogs getting harnessed',
        caption: 'Lancement de la session promenade : nos pensionnaires sont ravis !',
      },
    ],
    finishPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1535930891776-0c2dfb7fda1a?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Relaxed dogs resting happily',
        caption: 'Retour au refuge après 2h de balade vivifiante, chiens comblés et détendus',
      },
    ],
  },
  bike_repair: {
    theme: 'bike_repair',
    titleKeywords: ['vélo', 'atelier', 'réparation', 'mécanique', 'cyclisme', 'mobilité'],
    coverPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Bicycle workshop repair',
        caption: 'Atelier associatif d’auto-réparation vélo : transmission des savoir-faire',
      },
    ],
    startPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1507035895480-2b3156c31fc8?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Bike repair tools stand',
        caption: 'Pieds d’atelier déployés, pompes à pied et caisses à outils ouvertes !',
      },
    ],
    finishPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Fixed bike ready to ride',
        caption: 'Bilan : 12 vélos remis en état de rouler en sécurité (freins, câbles et crevaisons) !',
      },
    ],
  },
  clothing_donation: {
    theme: 'clothing_donation',
    titleKeywords: ['vêtement', 'vestiaire', 'friperie', 'don', 'tri', 'textile'],
    coverPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1532453288672-3a27e9be9efd?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Clothes donation racks and sorting',
        caption: 'Tri participatif de vêtements chauds et couvertures pour l’hiver',
      },
    ],
    startPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Clothes hanging on rack',
        caption: 'Installation du vestiaire solidaire : nous trions les dons par taille et saison',
      },
    ],
    finishPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Organized boutique style vestiaire',
        caption: 'Près de 250 pièces de vêtements triées et prêtes à être redistribuées !',
      },
    ],
  },
  homework_support: {
    theme: 'homework_support',
    titleKeywords: ['devoir', 'scolaire', 'soutien', 'enfants', 'lecture', 'tutorat'],
    coverPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=80',
        credit: 'Unsplash - Education tutoring kids',
        caption: 'Séance de tutorat solidaire et d’aide aux devoirs pour les écoliers du quartier',
      },
    ],
    startPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - School books and pencils',
        caption: 'Cahiers ouverts et crayons en main pour accompagner les enfants ce soir',
      },
    ],
    finishPostPhotos: [
      {
        url: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=1000&q=80',
        credit: 'Unsplash - Classroom smiles',
        caption: 'Devoirs bouclés avec brio, fiches de révision validées et sourires partagés !',
      },
    ],
  },
};

export function detectTheme(title: string): EventTheme {
  const lower = title.toLowerCase();
  for (const [theme, info] of Object.entries(CURATED_THEMATIC_PHOTOS)) {
    if (info.titleKeywords.some((kw) => lower.includes(kw))) {
      return theme as EventTheme;
    }
  }
  return 'waste_collection'; // Défaut écologique représentatif
}

