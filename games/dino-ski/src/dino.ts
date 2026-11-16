/**
 * La physique d'un dino : avancer, sauter, retomber.
 * Pas de React ni de dessin ici : les mêmes règles servent pour mon dino
 * et pour celui de l'autre joueur.
 */

export const DINO_SIZE = 24; // taille de l'image du dino (pixels)
export const RUN_SPEED = 0.07; // vitesse vers la droite (pixels par ms)
export const JUMP_SPEED = 0.34; // vitesse verticale au moment du saut
export const GRAVITY = 0.001; // ce qui ramène le dino au sol

export interface Dino {
  /** Distance parcourue dans le monde (pixels). */
  x: number;
  /** Hauteur au-dessus du sol (0 = posé, positif = en l'air). */
  height: number;
  /** Vitesse verticale (positive = monte). */
  vy: number;
  onGround: boolean;
}

export function createDino(): Dino {
  return { x: 0, height: 0, vy: 0, onGround: true };
}

/** Saute, seulement si le dino touche le sol. Renvoie true si le saut a eu lieu. */
export function jump(d: Dino): boolean {
  if (!d.onGround) return false;
  d.vy = JUMP_SPEED;
  d.onGround = false;
  return true;
}

/** Fait avancer le dino de `dt` millisecondes. */
export function stepDino(d: Dino, dt: number): void {
  d.x += RUN_SPEED * dt;
  if (!d.onGround) {
    d.vy -= GRAVITY * dt;
    d.height += d.vy * dt;
    if (d.height <= 0) {
      d.height = 0;
      d.vy = 0;
      d.onGround = true;
    }
  }
}
