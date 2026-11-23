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
// Saut : ~52 px de haut (le dino ne sort pas de sa moitié d'écran) et ~0,8 s en l'air,
// assez long pour passer chaque obstacle sans toucher la croix.
export const JUMP_SPEED = 0.26; // vitesse verticale au moment du saut
export const GRAVITY = 0.00065; // ce qui ramène le dino au sol
export const SLOW_DURATION_MS = 1500; // durée du ralentissement après un choc (ms)
export const SLOW_FACTOR = 0.45; // vitesse réduite à 45 % pendant le choc
export const FREEZE_DURATION_MS = 2000; // durée de la paralysie (projectile bleu)

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
  /** Temps restant de paralysie (en ms, 0 = libre). Gelé : n'avance plus, ne bouge plus, ne saute plus. */
  frozenTimer: number;
}

export function createDino(): Dino {
  return { x: 0, offsetX: 0, height: 0, vy: 0, onGround: true, facingLeft: false, slowTimer: 0, frozenTimer: 0 };
}

/** Saute, seulement si le dino touche le sol. Renvoie true si le saut a eu lieu. */
export function jump(d: Dino): boolean {
  if (!d.onGround || d.frozenTimer > 0) return false;
  d.vy = JUMP_SPEED;
  d.onGround = false;
  return true;
}

/** Déplace le dino de gauche (-1) à droite (1) sur l'écran. */
export function moveHorizontal(d: Dino, dir: -1 | 0 | 1, dt: number): void {
  if (dir === 0 || d.frozenTimer > 0) return; // sans bouton (ou gelé), le dino garde la direction où il regardait
  d.facingLeft = dir === -1;
  d.offsetX += dir * MOVE_SPEED * dt;
  d.offsetX = Math.max(MAX_OFFSET_LEFT, Math.min(MAX_OFFSET_RIGHT, d.offsetX));
}

/** Applique un ralentissement suite à un obstacle touché. */
export function slowDown(d: Dino): void {
  d.slowTimer = SLOW_DURATION_MS;
}

/** Projectile bleu : le dino est paralysé quelques secondes. */
export function freeze(d: Dino): void {
  d.frozenTimer = FREEZE_DURATION_MS;
}

/** Boule de neige : le dino est projeté en l'air, même s'il ne touchait pas le sol. */
export function forceJump(d: Dino): void {
  d.vy = JUMP_SPEED;
  d.onGround = false;
}

/* ---------- Accélération : tous les 100 m, le dino va plus vite ---------- */
export const SPEED_UP_EVERY_M = 100; // un palier tous les 100 m
export const SPEED_UP_LAST_M = 1500; // après 1500 m, la vitesse ne bouge plus

/** Réglage de l'accélération : `first` au 1er palier, puis `decay` de moins à chaque palier. */
export interface SpeedUp {
  first: number;
  decay: number;
}
/** Solo : +20 %, puis +19 %, +18 %... (x3 à 700 m, puis ça continue jusqu'à 1500 m : x6,2). */
export const SPEED_UP_SOLO: SpeedUp = { first: 0.2, decay: 0.01 };
/** À deux : +10 % à chaque palier (la course s'arrête à 600 m : x1,77). */
export const SPEED_UP_MULTI: SpeedUp = { first: 0.1, decay: 0 };
let speedUp = SPEED_UP_SOLO;

/** Choisit l'accélération (le jeu l'appelle selon le mode : solo ou multi). */
export function setSpeedUp(config: SpeedUp): void {
  speedUp = config;
}

/**
 * Multiplicateur de vitesse après `meters` mètres : les paliers se cumulent,
 * chacun un peu plus petit que le précédent, jusqu'à SPEED_UP_LAST_M (ensuite, plus d'accélération).
 * Solo : x1,20 à 100 m, x1,97 à 400 m, x3 à 700 m, x4,21 à 1000 m, x6,19 à 1500 m (maximum).
 */
export function speedMultiplierAt(meters: number, config: SpeedUp = speedUp): number {
  const steps = Math.floor(Math.min(Math.max(0, meters), SPEED_UP_LAST_M) / SPEED_UP_EVERY_M);
  let factor = 1;
  for (let k = 0; k < steps; k++) {
    factor *= 1 + Math.max(0, config.first - config.decay * k);
  }
  return factor;
}

/** Multiplicateur de vitesse de ce dino, selon la distance qu'il a parcourue. */
export function speedMultiplier(d: Dino): number {
  return speedMultiplierAt((d.x + d.offsetX) / 10); // 10 px = 1 m
}

/** Vitesse actuelle vers la droite (pixels par ms) : 0 si gelé, réduite après un choc. */
export function currentSpeed(d: Dino): number {
  if (d.frozenTimer > 0) return 0;
  const base = RUN_SPEED * speedMultiplier(d);
  return d.slowTimer > 0 ? base * SLOW_FACTOR : base;
}

/** Fait avancer le dino de `dt` millisecondes. */
export function stepDino(d: Dino, dt: number): void {
  const speed = currentSpeed(d); // vitesse au début de l'image
  if (d.slowTimer > 0) d.slowTimer = Math.max(0, d.slowTimer - dt);
  if (d.frozenTimer > 0) d.frozenTimer = Math.max(0, d.frozenTimer - dt);
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