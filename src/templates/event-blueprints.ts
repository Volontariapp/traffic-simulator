import { fakerFR as faker } from '@faker-js/faker';
import type { EventTheme } from '../media/photo-bank.js';

export interface EventBlueprint {
  title: string;
  description: string;
  theme: EventTheme;
  type: 'EVENT_TYPE_ECOLOGY' | 'EVENT_TYPE_SOCIAL';
  suggestedMaxParticipants: number;
}

const TEMPLATES: Record<EventTheme, { titles: string[]; descriptions: string[]; isEcology: boolean }> = {
  waste_collection: {
    isEcology: true,
    titles: [
      'Grande Cleanwalk citoyenne et dépollution des berges',
      'Opération zéro déchet et ramassage participatif',
      'Cleanwalk de quartier : élimination des mégots et plastiques',
      'Chantier éco-citoyen : collecte de déchets en plein air',
      'Action fleuve propre : tri sélectif et nettoyage collectif',
    ],
    descriptions: [
      'Venez nous prêter main forte pour ramasser et trier les déchets dans le quartier. Gants, sacs et pinces sont fournis par l’association. Pesée collective à la fin !',
      'Mobilisons-nous ensemble pour préserver la biodiversité urbaine. Une action concrète et conviviale accessible à tous, petits et grands.',
      'Dépollution citoyenne : retirons les plastiques qui polluent nos parcs et nos rues avant qu’ils n’atteignent les cours d’eau.',
    ],
  },
  solidarity_food: {
    isEcology: false,
    titles: [
      'Maraude solidaire et distribution de repas chauds',
      'Collecte et distribution de denrées alimentaires',
      'Préparation et tournée solidaire de boissons chaudes',
      'Banque alimentaire de quartier : distribution conviviale',
      'Maraude nocturne d’écoute et de réconfort',
    ],
    descriptions: [
      'Rejoignez notre équipe pour distribuer repas chauds, soupes et kits d’hygiène aux personnes en situation de précarité. Un moment fort de partage et de chaleur humaine.',
      'Tournée solidaire à pied dans le quartier. Nous apportons du thé chaud, des repas et surtout une présence bienveillante et de l’écoute.',
      'Participez à la logistique et au partage de notre buffet solidaire ouvert à tous. Chacun contribue à son échelle !',
    ],
  },
  urban_gardening: {
    isEcology: true,
    titles: [
      'Atelier végétalisation et plantation participative',
      'Chantier biodiversité : compostage et semis de printemps',
      'Création d’un îlot de fraîcheur au jardin partagé',
      'Plantation d’arbustes et désherbage écologique',
      'Entretien participatif et paillage des espaces verts',
    ],
    descriptions: [
      'Apprenons ensemble à verdir nos rues et notre quartier. Venez planter des aromatiques, semer des fleurs mellifères et enrichir la biodiversité urbaine.',
      'Matinée les mains dans la terre ! Venez découvrir les techniques de permaculture urbaine et prendre soin de notre parcelle partagée.',
    ],
  },
  animal_shelter: {
    isEcology: false,
    titles: [
      'Promenade solidaire des chiens du refuge',
      'Après-midi câlins et socialisation des animaux de refuge',
      'Collecte de croquettes et couvertures pour le refuge',
      'Sensibilisation au bien-être animal et adoption responsable',
    ],
    descriptions: [
      'Offrez un moment d’évasion et d’affection aux chiens du refuge le temps d’une belle balade au parc. Votre présence change leur quotidien !',
      'Aidez notre équipe à chouchouter nos pensionnaires à 4 pattes : brossage, promenades et jeux au grand air.',
    ],
  },
  bike_repair: {
    isEcology: true,
    titles: [
      'Atelier participatif de réparation de vélos',
      'Contrôle technique et réglage freins/dérailleurs solidaires',
      'Remise en selle citoyenne : auto-réparation assistée',
    ],
    descriptions: [
      'Venez réparer votre bicyclette ou apprendre aux autres à changer une chambre à air, régler des freins et lubrifier une transmission. Outils mis à disposition.',
      'Favorisons les mobilités douces et l’autonomie de chacun à vélo. Ambiance conviviale et conseils mécaniques partagés !',
    ],
  },
  clothing_donation: {
    isEcology: false,
    titles: [
      'Grande collecte et tri de vêtements chauds pour l’hiver',
      'Vestiaire solidaire : tri et étiquetage des dons',
      'Friperie solidaire éphémère et gratuite',
    ],
    descriptions: [
      'Triez les manteaux, pulls et bonnets récoltés pour équiper dignement les familles et sans-abris face au froid. Tri par taille et saisonnalité.',
      'Mise en place de notre boutique solidaire : chaque vêtement est inspecté, plié et mis en rayon avec soin.',
    ],
  },
  homework_support: {
    isEcology: false,
    titles: [
      'Séance d’aide aux devoirs et tutorat solidaire',
      'Atelier lecture et éveil culturel pour les enfants',
      'Soutien scolaire bénévole : mathématiques et français',
    ],
    descriptions: [
      'Accompagnez des écoliers et collégiens motivés dans leurs devoirs et apprentissages du soir. Une heure de votre temps pour donner confiance à un enfant.',
      'Encourageons la curiosité et la lecture auprès des enfants du quartier dans une ambiance studieuse et bienveillante.',
    ],
  },
};

export function generateEventBlueprint(preferredTheme?: EventTheme): EventBlueprint {
  const themes = Object.keys(TEMPLATES) as EventTheme[];
  const selectedTheme = preferredTheme ?? faker.helpers.arrayElement(themes);
  const data = TEMPLATES[selectedTheme];

  const title = faker.helpers.arrayElement(data.titles);
  const description = faker.helpers.arrayElement(data.descriptions);

  return {
    title,
    description,
    theme: selectedTheme,
    type: data.isEcology ? 'EVENT_TYPE_ECOLOGY' : 'EVENT_TYPE_SOCIAL',
    suggestedMaxParticipants: faker.number.int({ min: 10, max: 35 }),
  };
}

