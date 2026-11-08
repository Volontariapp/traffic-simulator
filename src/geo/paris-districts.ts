import { fakerFR as faker } from '@faker-js/faker';

export interface ParisLocation {
  district: number; // 1 à 20
  postalCode: string; // 75001 à 75020
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** Valeur de `district` pour un lieu hors des 20 arrondissements (events autour d'un utilisateur). */
export const OFF_GRID_DISTRICT = 0;

interface VenueSeed {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/**
 * Catalogue de plusieurs lieux et adresses emblématiques pour chaque arrondissement de Paris.
 * Permet d'éviter que les événements du même arrondissement se chevauchent sur la carte.
 */
export const PARIS_DISTRICT_VENUES: Record<number, VenueSeed[]> = {
  1: [
    { name: 'Châtelet - Les Halles', address: 'Place Carrée, 75001 Paris', lat: 48.8619, lng: 2.347 },
    { name: 'Jardin des Tuileries', address: 'Jardin des Tuileries, 75001 Paris', lat: 48.8635, lng: 2.3275 },
    { name: 'Palais-Royal & Comédie', address: 'Place du Palais-Royal, 75001 Paris', lat: 48.8631, lng: 2.3364 },
    { name: 'Quai de la Mégisserie - Pont Neuf', address: 'Quai de la Mégisserie, 75001 Paris', lat: 48.8582, lng: 2.3441 },
    { name: 'Square du Vert-Galant', address: '1 Square du Vert-Galant, 75001 Paris', lat: 48.8575, lng: 2.3402 },
  ],
  2: [
    { name: 'Rue Montorgueil - Sentier', address: 'Rue Montorgueil, 75002 Paris', lat: 48.866, lng: 2.3475 },
    { name: 'Square Louvois', address: 'Square Louvois, 75002 Paris', lat: 48.8682, lng: 2.3378 },
    { name: 'Passage des Panoramas', address: '11 Boulevard Montmartre, 75002 Paris', lat: 48.8715, lng: 2.3418 },
    { name: 'Place de la Bourse', address: 'Place de la Bourse, 75002 Paris', lat: 48.869, lng: 2.3413 },
  ],
  3: [
    { name: 'Carreau du Temple - Haut Marais', address: '4 Rue Eugène Spuller, 75003 Paris', lat: 48.8641, lng: 2.3615 },
    { name: 'Square du Temple - Elie Wiesel', address: '64 Rue de Bretagne, 75003 Paris', lat: 48.8633, lng: 2.3612 },
    { name: 'Marché des Enfants Rouges', address: '39 Rue de Bretagne, 75003 Paris', lat: 48.863, lng: 2.363 },
    { name: 'Square Saint-Gilles Grand Veneur', address: '9 Rue Villehardouin, 75003 Paris', lat: 48.8596, lng: 2.3662 },
  ],
  4: [
    { name: 'Place des Vosges - Marais', address: 'Place des Vosges, 75004 Paris', lat: 48.8556, lng: 2.3653 },
    { name: 'Parvis de l’Hôtel de Ville', address: 'Place de l’Hôtel de Ville, 75004 Paris', lat: 48.8566, lng: 2.3522 },
    { name: 'Île Saint-Louis - Quai d’Anjou', address: 'Quai d’Anjou, 75004 Paris', lat: 48.8521, lng: 2.3575 },
    { name: 'Square Jean XXIII - Cité', address: 'Square Jean XXIII, 75004 Paris', lat: 48.8525, lng: 2.3512 },
  ],
  5: [
    { name: 'Jardin des Plantes - Quartier Latin', address: '57 Rue Cuvier, 75005 Paris', lat: 48.8436, lng: 2.3597 },
    { name: 'Square Saint-Médard - Mouffetard', address: 'Place Saint-Médard, 75005 Paris', lat: 48.8398, lng: 2.3503 },
    { name: 'Place de la Contrescarpe', address: 'Place de la Contrescarpe, 75005 Paris', lat: 48.8443, lng: 2.3508 },
    { name: 'Arènes de Lutèce', address: '49 Rue Monge, 75005 Paris', lat: 48.8451, lng: 2.3527 },
  ],
  6: [
    { name: 'Jardin du Luxembourg', address: 'Rue de Médicis, 75006 Paris', lat: 48.8462, lng: 2.3372 },
    { name: 'Place Saint-Sulpice', address: 'Place Saint-Sulpice, 75006 Paris', lat: 48.8508, lng: 2.3332 },
    { name: 'Square Gabriel Pierné', address: 'Rue Mazarine, 75006 Paris', lat: 48.8571, lng: 2.3371 },
    { name: 'Square Ozanam - Notre-Dame-des-Champs', address: 'Rue Stanislas, 75006 Paris', lat: 48.8439, lng: 2.3278 },
  ],
  7: [
    { name: 'Berges de Seine - Pont Alexandre III', address: 'Port des Invalides, 75007 Paris', lat: 48.8637, lng: 2.3135 },
    { name: 'Champ de Mars - Mur pour la Paix', address: 'Allée Adrienne Lecouvreur, 75007 Paris', lat: 48.8556, lng: 2.2986 },
    { name: 'Esplanade des Invalides', address: 'Place Salvador Allende, 75007 Paris', lat: 48.8584, lng: 2.3128 },
    { name: 'Square Boucicaut - Sèvres Babylone', address: 'Square Boucicaut, 75007 Paris', lat: 48.851, lng: 2.3255 },
  ],
  8: [
    { name: 'Parc Monceau', address: '35 Boulevard de Courcelles, 75008 Paris', lat: 48.8794, lng: 2.309 },
    { name: 'Jardins des Champs-Élysées', address: 'Avenue Gabriel, 75008 Paris', lat: 48.8682, lng: 2.3142 },
    { name: 'Place de la Madeleine', address: 'Place de la Madeleine, 75008 Paris', lat: 48.8702, lng: 2.3245 },
    { name: 'Square Marcel Pagnol', address: 'Rue de Laborde, 75008 Paris', lat: 48.8758, lng: 2.3168 },
  ],
  9: [
    { name: 'Square d’Estienne d’Orves - Trinité', address: 'Place d’Estienne d’Orves, 75009 Paris', lat: 48.8765, lng: 2.3323 },
    { name: 'Place Saint-Georges', address: 'Place Saint-Georges, 75009 Paris', lat: 48.8785, lng: 2.3372 },
    { name: 'Square Montholon', address: 'Rue La Fayette, 75009 Paris', lat: 48.8761, lng: 2.3496 },
    { name: 'Rue des Martyrs - Pigalle', address: 'Rue des Martyrs, 75009 Paris', lat: 48.8812, lng: 2.3392 },
  ],
  10: [
    { name: 'Canal Saint-Martin - Quai de Valmy', address: 'Quai de Valmy, 75010 Paris', lat: 48.8719, lng: 2.3653 },
    { name: 'Jardin Villemin - Hôpital St-Louis', address: '14 Rue des Récollets, 75010 Paris', lat: 48.8748, lng: 2.3615 },
    { name: 'Place de la République (Nord)', address: 'Boulevard de Magenta, 75010 Paris', lat: 48.8685, lng: 2.3618 },
    { name: 'Square Alban Satragne', address: '107 Rue du Faubourg Saint-Denis, 7510 Paris', lat: 48.8752, lng: 2.3551 },
  ],
  11: [
    { name: 'Place de la République - Bastille', address: 'Place de la République, 75011 Paris', lat: 48.8675, lng: 2.3638 },
    { name: 'Square Maurice Gardette', address: 'Rue du Général Guilhem, 75011 Paris', lat: 48.8615, lng: 2.3789 },
    { name: 'Boulevard Voltaire - Charonne', address: 'Boulevard Voltaire, 75011 Paris', lat: 48.8548, lng: 2.3852 },
    { name: 'Square Jean Allemane - Roquette', address: 'Rue de la Roquette, 75011 Paris', lat: 48.855, lng: 2.3731 },
  ],
  12: [
    { name: 'Bois de Vincennes - Lac Daumesnil', address: 'Route de la Ceinture du Lac, 75012 Paris', lat: 48.8315, lng: 2.4137 },
    { name: 'Coulée Verte René-Dumont', address: '1 Avenue Daumesnil, 75012 Paris', lat: 48.8475, lng: 2.3735 },
    { name: 'Parc de Bercy', address: '128 Quai de Bercy, 75012 Paris', lat: 48.8352, lng: 2.382 },
    { name: 'Place de la Nation (Sud)', address: 'Place de la Nation, 75012 Paris', lat: 48.8482, lng: 2.3955 },
  ],
  13: [
    { name: 'Butte-aux-Cailles - Place Paul Verlaine', address: 'Place Paul Verlaine, 75013 Paris', lat: 48.8285, lng: 2.3588 },
    { name: 'Parc de Choisy', address: 'Avenue de Choisy, 75013 Paris', lat: 48.8272, lng: 2.3612 },
    { name: 'Esplanade BnF François-Mitterrand', address: 'Quai François Mauriac, 75013 Paris', lat: 48.8338, lng: 2.3765 },
    { name: 'Square René Le Gall', address: 'Rue Croulebarbe, 75013 Paris', lat: 48.8335, lng: 2.3521 },
  ],
  14: [
    { name: 'Parc Montsouris', address: 'Boulevard Jourdan, 75014 Paris', lat: 48.8222, lng: 2.3381 },
    { name: 'Square du Serment de Koufra', address: 'Avenue de la Porte d’Orléans, 75014 Paris', lat: 48.8205, lng: 2.3242 },
    { name: 'Place Denfert-Rochereau', address: 'Place Denfert-Rochereau, 75014 Paris', lat: 48.8338, lng: 2.3324 },
    { name: 'Rue Daguerre', address: 'Rue Daguerre, 75014 Paris', lat: 48.834, lng: 2.3285 },
  ],
  15: [
    { name: 'Parc André Citroën', address: '2 Rue Cauchy, 75015 Paris', lat: 48.8415, lng: 2.2743 },
    { name: 'Parc Georges Brassens', address: '2 Place Jacques Marette, 75015 Paris', lat: 48.8315, lng: 2.3015 },
    { name: 'Square Saint-Lambert', address: 'Square Saint-Lambert, 75015 Paris', lat: 48.8432, lng: 2.2982 },
    { name: 'Île aux Cygnes - Bir-Hakeim', address: 'Allée des Cygnes, 75015 Paris', lat: 48.8542, lng: 2.2865 },
  ],
  16: [
    { name: 'Bois de Boulogne - Serres d’Auteuil', address: 'Avenue de la Porte d’Auteuil, 75016 Paris', lat: 48.8475, lng: 2.2519 },
    { name: 'Jardins du Trocadéro', address: 'Place du Trocadéro, 75016 Paris', lat: 48.8618, lng: 2.2892 },
    { name: 'Jardin du Ranelagh', address: 'Avenue Ingres, 75016 Paris', lat: 48.8572, lng: 2.2695 },
    { name: 'Passy - Place de Costa Rica', address: 'Place de Costa Rica, 75016 Paris', lat: 48.8585, lng: 2.2852 },
  ],
  17: [
    { name: 'Parc Martin Luther King - Batignolles', address: 'Rue Cardinet, 75017 Paris', lat: 48.8911, lng: 2.315 },
    { name: 'Square des Batignolles', address: 'Place Charles Fillion, 75017 Paris', lat: 48.8875, lng: 2.3168 },
    { name: 'Place de Lévis - Villiers', address: 'Rue de Lévis, 75017 Paris', lat: 48.8825, lng: 2.3105 },
    { name: 'Square de l’Épinette', address: 'Rue de La Jonquière, 75017 Paris', lat: 48.8942, lng: 2.3242 },
  ],
  18: [
    { name: 'Square Louise Michel - Sacré-Cœur', address: 'Place Saint-Pierre, 75018 Paris', lat: 48.8867, lng: 2.3431 },
    { name: 'Square Léon Serpollet - Joffrin', address: 'Rue des Cloÿs, 75018 Paris', lat: 48.8925, lng: 2.3412 },
    { name: 'Jardins d’Éole', address: '45 Rue d’Aubervilliers, 75018 Paris', lat: 48.8885, lng: 2.3668 },
    { name: 'Place des Abbesses', address: 'Place des Abbesses, 75018 Paris', lat: 48.8845, lng: 2.3385 },
  ],
  19: [
    { name: 'Parc des Buttes-Chaumont', address: 'Rue Botzaris, 75019 Paris', lat: 48.8809, lng: 2.3828 },
    { name: 'Parc de la Villette - Bassin', address: '211 Avenue Jean Jaurès, 75019 Paris', lat: 48.8925, lng: 2.3895 },
    { name: 'Bassin de la Villette - Quai de Seine', address: 'Quai de la Seine, 75019 Paris', lat: 48.8835, lng: 2.3735 },
    { name: 'Place des Fêtes', address: 'Place des Fêtes, 75019 Paris', lat: 48.8765, lng: 2.3932 },
  ],
  20: [
    { name: 'Parc de Belleville - Ménilmontant', address: 'Rue Piat, 75020 Paris', lat: 48.8712, lng: 2.3855 },
    { name: 'Square Séverine - Porte de Bagnolet', address: 'Rue Le Vau, 75020 Paris', lat: 48.8682, lng: 2.4085 },
    { name: 'Place Gambetta - Père Lachaise', address: 'Place Gambetta, 75020 Paris', lat: 48.8652, lng: 2.3985 },
    { name: 'Campagne à Paris', address: 'Rue Jules Siegfried, 75020 Paris', lat: 48.867, lng: 2.4095 },
  ],
};

/**
 * Liste historique des 20 arrondissements (points d'ancrage par défaut).
 */
export const PARIS_DISTRICTS: ParisLocation[] = Object.entries(PARIS_DISTRICT_VENUES).map(
  ([districtStr, venues]) => {
    const district = Number(districtStr);
    const postalCode = `750${String(district).padStart(2, '0')}`;
    const firstVenue = venues[0];
    return {
      district,
      postalCode,
      name: firstVenue.name,
      address: firstVenue.address,
      lat: firstVenue.lat,
      lng: firstVenue.lng,
    };
  },
);

/**
 * Retourne une adresse aléatoire et réaliste pour un arrondissement donné.
 * Si un numéro de slot est fourni (ex: 1, 2, 3), sélectionne des lieux différents
 * et applique une dispersion spatiale (jitter) de 50 à 250m pour garantir
 * qu'aucun événement ne se chevauche sur la carte ou dans le fil.
 */
export function getRandomLocationForDistrict(district: number, slot: number = 1): ParisLocation {
  const venues = PARIS_DISTRICT_VENUES[district] ?? PARIS_DISTRICT_VENUES[1];
  const postalCode = `750${String(district).padStart(2, '0')}`;

  // Choix du lieu en fonction du slot pour garantir la variété inter-slots
  const venueIndex = (slot - 1) % venues.length;
  const baseVenue = venues[venueIndex] ?? faker.helpers.arrayElement(venues);

  // Génération d'un numéro de rue réaliste si l'adresse est un axe/rue
  let streetAddress = baseVenue.address;
  if (!streetAddress.match(/^\d+/)) {
    const streetNumber = faker.number.int({ min: 1, max: 120 });
    streetAddress = `${streetNumber} ${streetAddress}`;
  }

  // Dispersion spatiale (jitter ±0.0015° ~ 150m) pour empêcher tout chevauchement de marker
  const jitterLat = (Math.random() - 0.5) * 0.003;
  const jitterLng = (Math.random() - 0.5) * 0.004;

  return {
    district,
    postalCode,
    name: baseVenue.name,
    address: streetAddress,
    lat: Number((baseVenue.lat + jitterLat).toFixed(6)),
    lng: Number((baseVenue.lng + jitterLng).toFixed(6)),
  };
}
