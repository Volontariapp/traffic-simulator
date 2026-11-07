const ECOLOGY = [
  'Bravo pour cette belle initiative pour notre quartier !',
  'Excellente démarche citoyenne, j’amène des gants et des sacs en renfort.',
  'Super projet, hâte de voir le quartier tout propre !',
  'Un grand merci pour l’organisation, c’est exactement ce qu’il fallait faire.',
  'Présent avec grand plaisir, superbe énergie collective.',
  'Bravo à toute l’équipe pour ce chantier éco-citoyen.',
  'On y sera ! Quelqu’un a une pince de ramassage en plus ?',
  'Ça fait du bien de voir des gens se bouger pour leur quartier.',
  'Merci pour le travail, ça se voit que le coin respire mieux.',
  'Belle matinée en perspective, la météo a l’air de suivre.',
  'Génial, je partage autour de moi pour ramener du monde.',
  'Chaque geste compte, merci de montrer l’exemple.',
  'Je n’ai pas pu venir cette fois mais je serai là à la prochaine.',
  'Les photos donnent envie de rejoindre le groupe !',
];

const SOLIDARITY = [
  'Magnifique action de solidarité, tout mon soutien aux organisateurs et bénévoles.',
  'Merci infiniment pour votre engagement au quotidien auprès de ceux qui en ont besoin.',
  'Comptez sur moi pour donner un coup de main au tri et à la distribution.',
  'Superbe mobilisation solidaire, un grand bravo à tous.',
  'Très belle initiative humaine et chaleureuse, merci pour eux.',
  'Bravo pour ce vestiaire solidaire, je ramène aussi des vêtements chauds.',
  'Je peux apporter des denrées, dites-moi où les déposer.',
  'Respect pour votre régularité, ça change vraiment des vies.',
  'Merci d’être là quand il fait froid, vraiment.',
  'Je connais des voisins qui voudraient donner, je leur en parle ce soir.',
  'Quel beau travail d’équipe, bravo.',
  'Si vous manquez de bras samedi, prévenez-moi.',
];

const ANIMAL = [
  'Tellement important de prendre soin de nos petits compagnons de refuge.',
  'Un immense merci pour cette action auprès des animaux !',
  'Superbe promenade solidaire, ils ont tellement besoin d’attention et d’affection.',
  'Bravo pour votre engagement pour la cause animale.',
  'J’ai adopté mon chat dans un refuge, merci à tous ceux qui les aident.',
  'Je viendrai avec plaisir, j’adore les chiens.',
  'Quelle belle idée, les loulous vont être ravis !',
];

const BIKE = [
  'Super idée cet atelier, mon vélo en a bien besoin.',
  'Je ramène ma clé à molette et ma bonne humeur.',
  'Merci pour ce service de proximité, c’est précieux.',
  'Est-ce qu’il faut s’inscrire à l’avance ou on peut passer ?',
];

const GENERAL = [
  'Superbe initiative, bravo pour l’engagement et l’énergie positive !',
  'Très belle action, ravi de voir la communauté se mobiliser comme ça.',
  'Bravo ! On a besoin de plus d’actions citoyennes de ce genre.',
  'Génial, hâte de voir les photos du bilan. Bon courage à tous.',
  'Félicitations pour cette organisation au top.',
  'Merci pour le partage, je m’inscris tout de suite.',
  'Ça donne envie de s’y mettre aussi, bravo.',
  'Belle dynamique dans le quartier, continuez comme ça.',
  'Quelle équipe motivée, ça fait plaisir à voir.',
  'On se retrouve sur place, j’ai hâte.',
  'Merci à tous ceux qui prennent de leur temps pour les autres.',
  'Je ne connaissais pas cette asso, belle découverte.',
  'Très bonne initiative, j’en parle à mes collègues.',
  'Trop bien, ça faisait longtemps que je cherchais un truc comme ça près de chez moi.',
  'Top ! Je réserve ma place.',
  'Bravo à tous les participants.',
];

const SHORT = [
  'Top !',
  'Bravo !',
  'Super !',
  'Merci à tous',
  'Génial',
  'Belle initiative',
  'Je suis partant',
  'Chapeau',
  'Excellent',
  'Magnifique',
  'On y sera',
  'Avec plaisir',
];

export function commentPoolFor(title: string): readonly string[] {
  const lower = title.toLowerCase();
  const pool: string[] = [...GENERAL, ...SHORT];
  if (['déchet', 'clean', 'arbre', 'vert', 'nettoy', 'jardin', 'plant'].some((k) => lower.includes(k))) {
    pool.push(...ECOLOGY, ...ECOLOGY);
  }
  if (['maraude', 'repas', 'vêtement', 'don', 'collecte', 'solidaire', 'distribution'].some((k) => lower.includes(k))) {
    pool.push(...SOLIDARITY, ...SOLIDARITY);
  }
  if (['chien', 'animal', 'refuge', 'chat'].some((k) => lower.includes(k))) {
    pool.push(...ANIMAL, ...ANIMAL);
  }
  if (['vélo', 'velo', 'atelier', 'répar'].some((k) => lower.includes(k))) {
    pool.push(...BIKE, ...BIKE);
  }
  if (pool.length === GENERAL.length + SHORT.length) {
    // Aucun theme reconnu : un peu de tout pour eviter la repetition
    pool.push(...ECOLOGY.slice(0, 5), ...SOLIDARITY.slice(0, 5));
  }
  return pool;
}
