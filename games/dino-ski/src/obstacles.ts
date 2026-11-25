/**
 * Les obstacles sur la piste : génération déterministe et collisions.
 * Pas de React ni de dessin ici.
 */
import { createRandom } from '@gamebovh/sdk';
import { DINO_HEIGHT, DINO_WIDTH, speedMultiplierAt, type Dino, type SpeedUp } from './dino.ts';
import { TRACK_LENGTH_M } from './match.ts';

export interface Obstacle {
  id: number;
  /** 0 = Tas_neige.png, 1 = Snowman.png, 2 = Oiseau.png (volant) */
  kind: number;
  /** Position horizontale dans le monde (en pixels, comme dino.x). */
  x: number;
  width: number;
  height: number;
  /** Hauteur du bas de l'obstacle au-dessus du sol (0 = posé au sol, > 0 = il vole). */
  fly: number;
  /** Déjà touché ou esquivé ? (évite de compter deux fois le même obstacle). */
  resolved: boolean;
}

// Tailles adaptées aux proportions des sprites (en pixels).
// `margin` : pixels ignorés à gauche et à droite pour les collisions (bords vides, bras fins) ;
// `top`    : pixels ignorés en haut (sommet arrondi, chapeau, ailes).
// `fly`    : hauteur du bas de l'obstacle au-dessus du sol (0 = au sol).
// Ces valeurs sont réglées pour que chaque obstacle soit sautable SANS toucher la croix.
const OBSTACLE_VARIANTS = [
  { width: 20, height: 15, margin: 4, top: 3, fly: 0 }, // 0 : Tas de neige (large et bas)
  { width: 24, height: 22, margin: 7, top: 5, fly: 0 }, // 1 : Bonhomme de neige (plus haut)
  // 2 : Oiseau volant, juste au-dessus de la tête du dino : il passe dessous s'il reste au sol,
  // mais s'il saute (ou si une boule de neige le fait sauter), il le prend en pleine tête.
  { width: 23, height: 14, margin: 3, top: 2, fly: DINO_HEIGHT + 3 },
];
const FLYING_KIND = 2;
const FLYING_CHANCE = 0.25; // environ 1 obstacle sur 4 est un oiseau

/** Haut de la tête du dino, mesuré depuis le bas de son image (la 1re ligne du sprite est vide). */
const DINO_HEAD = DINO_HEIGHT - 2;

// Espace libre entre deux obstacles (du bord droit de l'un au bord gauche du suivant).
// Minimum : assez pour retomber après un saut et ressauter tranquillement.
// Maximum : pas trop, pour qu'il se passe toujours quelque chose.
const MIN_GAP = 100; // 10 m, environ 1,4 s à pleine vitesse
const MAX_GAP = 190; // 19 m, environ 2,7 s

/**
 * Génère tous les obstacles de la course à partir de la graine `seed`.
 * `speedUp` : l'accélération du mode de jeu (voir dino.ts). Plus le dino va vite,
 * plus les écarts sont grands : l'espace entre deux obstacles reste le même EN TEMPS.
 */
export function generateObstacles(seed: number, speedUp?: SpeedUp): Obstacle[] {
  const rand = createRandom(seed);
  const obstacles: Obstacle[] = [];
  const maxPixels = TRACK_LENGTH_M * 10; // 10 px = 1 m

  // Premier obstacle vers 35 mètres (350 px), puis espacés aléatoirement
  let currentX = 350;
  let id = 1;

  while (currentX < maxPixels - 100) {
    // Un oiseau de temps en temps, sinon un obstacle au sol (tas ou bonhomme).
    const kind = rand() < FLYING_CHANCE ? FLYING_KIND : Math.floor(rand() * 2);
    const size = OBSTACLE_VARIANTS[kind];

    obstacles.push({
      id: id++,
      kind,
      x: Math.round(currentX),
      width: size.width,
      height: size.height,
      fly: size.fly,
      resolved: false,
    });

    // Espace libre aléatoire entre MIN_GAP et MAX_GAP : jamais deux obstacles collés.
    const stretch = speedUp ? speedMultiplierAt(currentX / 10, speedUp) : 1;
    currentX += size.width + (MIN_GAP + rand() * (MAX_GAP - MIN_GAP)) * stretch;
  }

  return obstacles;
}

/**
 * Vérifie les collisions et esquives pour un dino sur sa liste d'obstacles.
 * Renvoie le nombre de nouveaux impacts (`hits`) et de nouvelles esquives (`dodged`).
 */
export function checkObstacles(dino: Dino, obstacles: Obstacle[]): { hits: number; dodged: number } {
  let hits = 0;
  let dodged = 0;

  // Position réelle du dino dans le monde (avec légère marge de tolérance de 3 px sur la hitbox)
  const dinoLeft = dino.x + dino.offsetX + 3;
  const dinoRight = dino.x + dino.offsetX + DINO_WIDTH - 3;
  const dinoBottom = dino.height;

  for (const obs of obstacles) {
    if (obs.resolved) continue;

    // Marge de tolérance (bords vides du sprite, branches fines du bonhomme de neige)
    const variant = OBSTACLE_VARIANTS[obs.kind] ?? OBSTACLE_VARIANTS[0];
    const obsLeft = obs.x + variant.margin;
    const obsRight = obs.x + obs.width - variant.margin;

    // 1. Test de collision : chevauchement horizontal ET vertical.
    //    Au sol : le dino touche s'il n'est pas assez haut.
    //    En l'air (oiseau) : le dino touche si sa tête monte jusqu'à l'oiseau.
    const overlapX = dinoRight > obsLeft && dinoLeft < obsRight;
    const obsBottom = obs.fly + (obs.fly > 0 ? 2 : 0); // 2 px de tolérance sous les ailes
    const obsTop = obs.fly + obs.height - variant.top;
    const overlapY = dinoBottom < obsTop && dinoBottom + DINO_HEAD > obsBottom;

    if (overlapX && overlapY) {
      obs.resolved = true;
      hits++;
    }
    // 2. Test d'esquive (l'obstacle est complètement passé derrière le dino sans impact)
    else if (obsRight < dinoLeft) {
      obs.resolved = true;
      dodged++;
    }
  }

  return { hits, dodged };
}