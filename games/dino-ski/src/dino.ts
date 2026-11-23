/**
 * La physique d'un dino : avancer, sauter, retomber, bouger latéralement.
 * Pas de React ni de dessin ici : les mêmes règles servent pour mon dino
 * et pour celui de l'autre joueur.
 */

export const DINO_WIDTH = 32; // largeur de l'image du dino (pixels)
export const DINO_HEIGHT = 24; // hauteur de l'image du dino (pixels)
export const RUN_SPEED = 0.07; // vitesse vers la droite (pixels par ms)
export const MOVE_SPEED = 0.12; // vitesse de déplacement gauche/droite à l'écran (pixels par ms)
export const MAX_OFFSET_LEFT = -36; // limite gauche (48 - 36 = 12 px du bord gauche)
export const MAX_OFFSET_RIGHT = 140; // limite droite (48 + 140 + 24 = 212 px sur 240)
export const JUMP_SPEED = 0.34; // vitesse verticale au moment du saut
export const GRAVITY = 0.001; // ce qui ramène le dino au sol
export const SLOW_DURATION_MS = 1500; // durée du ralentissement après un choc (ms)
export const SLOW_FACTOR = 0.45; // vitesse réduite à 45 % pendant le choc

export interface Dino {
  /** Distance parcourue dans le monde (pixels). */
  x: number;
  /** Décalage horizontal à l'écran par rapport à sa position de base (pixels). */
  offsetX: number;
  /** Hauteur au-dessus du sol (0 = posé, positif = en l'air). */
  height: number;
  /** Vitesse verticale (positive = monte). */
  vy: number;
  onGround: boolean;
  /** true quand le dino regarde vers la gauche (il recule) : l'image est retournée. */
  facingLeft: boolean;
  /** Temps restant de ralentissement (en ms, 0 = vitesse normale). */
  slowTimer: number;
}

export function createDino(): Dino {
  return { x: 0, offsetX: 0, height: 0, vy: 0, onGround: true, facingLeft: false, slowTimer: 0 };
}

/** Saute, seulement si le dino touche le sol. Renvoie true si le saut a eu lieu. */
export function jump(d: Dino): boolean {
  if (!d.onGround) return false;
  d.vy = JUMP_SPEED;
  d.onGround = false;
  return true;
}

/** Déplace le dino de gauche (-1) à droite (1) sur l'écran. */
export function moveHorizontal(d: Dino, dir: -1 | 0 | 1, dt: number): void {
  if (dir === 0) return; // sans bouton, le dino garde la direction où il regardait
  d.facingLeft = dir === -1;
  d.offsetX += dir * MOVE_SPEED * dt;
  d.offsetX = Math.max(MAX_OFFSET_LEFT, Math.min(MAX_OFFSET_RIGHT, d.offsetX));
}

/** Applique un ralentissement suite à un obstacle touché. */
export function slowDown(d: Dino): void {
  d.slowTimer = SLOW_DURATION_MS;
}

/** Fait avancer le dino de `dt` millisecondes. */
export function stepDino(d: Dino, dt: number): void {
  if (d.slowTimer > 0) {
    d.slowTimer = Math.max(0, d.slowTimer - dt);
  }
  const speed = d.slowTimer > 0 ? RUN_SPEED * SLOW_FACTOR : RUN_SPEED;
  d.x += speed * dt;

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