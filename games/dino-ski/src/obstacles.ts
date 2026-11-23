/**
 * Les obstacles sur la piste : génération déterministe et collisions.
 * Pas de React ni de dessin ici.
 */
import { createRandom } from '@gamebovh/sdk';
import { DINO_WIDTH, type Dino } from './dino.ts';
import { WIN_DISTANCE } from './match.ts';

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

// Tailles adaptées aux proportions des sprites (en pixels)
const OBSTACLE_VARIANTS = [
  { width: 20, height: 15 }, // 0 : Tas de neige (large et bas)
  { width: 24, height: 22 }, // 1 : Bonhomme de neige (plus haut)
];

/** Génère tous les obstacles de la course à partir de la graine `seed`. */
export function generateObstacles(seed: number): Obstacle[] {
  const rand = createRandom(seed);
  const obstacles: Obstacle[] = [];
  const maxPixels = WIN_DISTANCE * 10; // 10 px = 1 m

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

    // Espacement aléatoire entre 140 px (14 m) et 280 px (28 m)
    currentX += 140 + rand() * 140;
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

    // Marge de tolérance pour ne pas toucher les branches fines du bonhomme de neige
    const obsLeft = obs.x + 4;
    const obsRight = obs.x + obs.width - 4;

    // 1. Test de collision (chevauchement horizontal ET dino pas assez haut)
    const overlapX = dinoRight > obsLeft && dinoLeft < obsRight;
    const overlapY = dinoBottom < obs.height - 3;

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