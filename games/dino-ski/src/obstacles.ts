/**
 * Les obstacles sur la piste : génération déterministe et collisions.
 * Pas de React ni de dessin ici.
 */
import { createRandom } from '@gamebovh/sdk';
import { DINO_WIDTH, speedMultiplierAt, type Dino, type SpeedUp } from './dino.ts';
import { TRACK_LENGTH_M } from './match.ts';

export interface Obstacle {
  id: number;
  /** 0 = Tas_neige.png, 1 = Snowman.png */
  kind: number;
  /** Position horizontale dans le monde (en pixels, comme dino.x). */
  x: number;
  width: number;
  height: number;
  /** Déjà touché ou esquivé ? (évite de compter deux fois le même obstacle). */
  resolved: boolean;
}

// Tailles adaptées aux proportions des sprites (en pixels).
// `margin` : pixels ignorés à gauche et à droite pour les collisions (bords vides, bras fins) ;
// `top`    : pixels ignorés en haut (sommet arrondi, chapeau).
// Ces valeurs sont réglées pour que chaque obstacle soit sautable SANS toucher la croix.
const OBSTACLE_VARIANTS = [
  { width: 20, height: 15, margin: 4, top: 3 }, // 0 : Tas de neige (large et bas)
  { width: 24, height: 22, margin: 7, top: 5 }, // 1 : Bonhomme de neige (plus haut)
];

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
    const kind = Math.floor(rand() * OBSTACLE_VARIANTS.length);
    const size = OBSTACLE_VARIANTS[kind];

    obstacles.push({
      id: id++,
      kind,
      x: Math.round(currentX),
      width: size.width,
      height: size.height,
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

    // 1. Test de collision (chevauchement horizontal ET dino pas assez haut)
    const overlapX = dinoRight > obsLeft && dinoLeft < obsRight;
    const overlapY = dinoBottom < obs.height - variant.top;

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