/**
 * Les pièges (multijoueur seulement) : on en reçoit un toutes les 15 secondes,
 * puis on le lance sur l'autre joueur avec B.
 *
 *   - projectile bleu ('freeze')    : paralyse le dino touché (voir freeze dans dino.ts) ;
 *   - boule de neige ('snowball')   : fait sauter le dino touché (voir forceJump).
 *
 * Le projectile arrive par la droite de l'écran de la cible, au ras du sol,
 * et fonce vers son dino : pour l'esquiver, il faut sauter par-dessus.
 * Pas de React ni de dessin ici.
 */
import { DINO_WIDTH, type Dino } from './dino.ts';

export type TrapKind = 'freeze' | 'snowball';
export const TRAP_KINDS: TrapKind[] = ['freeze', 'snowball'];

export const TRAP_EVERY_MS = 15000; // un nouveau piège toutes les 15 s
export const TRAP_SPIN_MS = 900; // durée de la "roulette" dans le cercle avant de pouvoir lancer
/**
 * Taille de chaque projectile (celle de son image, en pixels), hauteur de son bas au-dessus
 * du sol, et marge retirée de chaque côté pour la hitbox (les bords pâles ne touchent pas).
 *   - 'freeze'   : assets/pieges/glace.png, une traînée de glace qui glisse au ras du sol ;
 *   - 'snowball' : assets/pieges/boule-neige.png.
 */
export const PROJECTILE_SHAPES: Record<TrapKind, { width: number; height: number; fly: number; margin: number }> = {
  freeze: { width: 31, height: 9, fly: 0, margin: 4 },
  snowball: { width: 8, height: 8, fly: 3, margin: 1 },
};
const PROJECTILE_SPEED = 0.05; // vitesse du projectile vers la gauche (pixels par ms)
const SPAWN_AHEAD = 196; // il apparaît juste après le bord droit de l'écran de la cible
const FORGET_BEHIND = 120; // une fois loin derrière le dino, on l'oublie

export interface Projectile {
  kind: TrapKind;
  /** Position dans le monde (bord gauche, en pixels, comme dino.x). */
  x: number;
  /** Déjà esquivé ? (il continue sa route, mais ne peut plus toucher). */
  dodged: boolean;
}

/** Un piège au hasard. */
export function randomTrap(): TrapKind {
  return TRAP_KINDS[Math.floor(Math.random() * TRAP_KINDS.length)];
}

/** Crée un projectile qui arrive par la droite de l'écran du dino visé. */
export function spawnProjectile(kind: TrapKind, target: Dino): Projectile {
  return { kind, x: target.x + SPAWN_AHEAD, dodged: false };
}

/**
 * Fait avancer les projectiles d'une piste et teste chacun contre le dino.
 * Les projectiles qui touchent sont retirés de la liste.
 * Renvoie ceux qui ont touché et le nombre de nouvelles esquives.
 */
export function stepProjectiles(
  list: Projectile[],
  dino: Dino,
  dt: number,
): { hits: TrapKind[]; dodged: number } {
  const hits: TrapKind[] = [];
  let dodged = 0;
  // Même hitbox que pour les obstacles (3 px de tolérance de chaque côté).
  const dinoLeft = dino.x + dino.offsetX + 3;
  const dinoRight = dino.x + dino.offsetX + DINO_WIDTH - 3;

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.x -= PROJECTILE_SPEED * dt;
    const shape = PROJECTILE_SHAPES[p.kind];
    const pLeft = p.x + shape.margin;
    const pRight = p.x + shape.width - shape.margin;

    if (!p.dodged) {
      const overlapX = pRight > dinoLeft && pLeft < dinoRight;
      const overlapY = dino.height < shape.fly + shape.height - 2;
      if (overlapX && overlapY) {
        hits.push(p.kind);
        list.splice(i, 1);
        continue;
      }
      if (pRight < dinoLeft) {
        p.dodged = true; // passé derrière sans toucher : esquivé !
        dodged++;
      }
    }
    if (p.x < dino.x - FORGET_BEHIND) list.splice(i, 1);
  }
  return { hits, dodged };
}
