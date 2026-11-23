/**
 * Le dino d'un AUTRE joueur, affiché sans saccade.
 *
 * On reçoit son état environ 12 fois par seconde. Si on le recopiait tel quel,
 * il "sauterait" à chaque message. À la place, on garde deux dinos :
 *   - `target` : là où il devrait être, d'après le dernier message, puis simulé
 *     avec les mêmes règles que le nôtre (dino.ts) jusqu'au message suivant ;
 *   - `shown`  : celui qu'on dessine. Il avance tout seul et se rapproche
 *     doucement de `target` : les petites erreurs sont rattrapées en douceur.
 */
import { createDino, currentSpeed, jump, moveHorizontal, stepDino, type Dino } from './dino.ts';

/** Temps (ms) pour rattraper environ 63 % de l'écart avec `target`. Plus petit = plus réactif. */
const SMOOTH_MS = 100;
/** Au-delà de cet écart (pixels), on recale d'un coup (ex. : retour de pause). */
const SNAP_DISTANCE = 120;

export interface RemoteDino {
  target: Dino;
  shown: Dino;
  /** Direction gauche/droite que l'autre joueur appuie (-1, 0 ou 1). */
  dir: -1 | 0 | 1;
}

export function createRemote(): RemoteDino {
  return { target: createDino(), shown: createDino(), dir: 0 };
}

/** L'autre joueur a sauté : on lance le saut tout de suite. */
export function remoteJump(r: RemoteDino): void {
  jump(r.target);
}

/** Un message d'état est arrivé : il devient la nouvelle cible. */
export function applyRemoteState(r: RemoteDino, s: Dino, dir: -1 | 0 | 1): void {
  Object.assign(r.target, s);
  r.dir = dir;
}

/** Fait avancer le dino distant de `dt` ms (seulement s'il n'est pas en pause). */
export function stepRemote(r: RemoteDino, dt: number): void {
  const { target, shown } = r;

  // 1. La cible suit les règles du jeu, comme si on recevait un message à chaque image.
  const speed = currentSpeed(target); // gelé = 0, ralenti = moins vite
  stepDino(target, dt);
  moveHorizontal(target, r.dir, dt);

  // 2. Le dino affiché avance à la même vitesse (et est gelé / ralenti en même temps)...
  shown.slowTimer = target.slowTimer;
  shown.frozenTimer = target.frozenTimer;
  shown.x += speed * dt;
  moveHorizontal(shown, r.dir, dt);

  // 3. ... puis se rapproche en douceur de la cible.
  const k = 1 - Math.exp(-dt / SMOOTH_MS);
  if (Math.abs(target.x - shown.x) > SNAP_DISTANCE) shown.x = target.x;
  else shown.x += (target.x - shown.x) * k;
  shown.offsetX += (target.offsetX - shown.offsetX) * k;

  // Le saut est simulé image par image dans `target` : il est déjà fluide, on le recopie.
  shown.height = target.height;
  shown.vy = target.vy;
  shown.onGround = target.onGround;
  shown.facingLeft = target.facingLeft;
}
