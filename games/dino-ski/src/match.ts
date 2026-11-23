/**
 * Les règles de fin de partie (sans React ni dessin).
 *
 *   - à deux : le premier qui atteint WIN_DISTANCE_MULTI (600 m) gagne ;
 *   - en solo : pas d'objectif de distance, on va le plus loin possible avant la fin du temps ;
 *   - quand le temps est écoulé (3:00 en solo, 2:30 à deux), le plus loin gagne.
 */

export const WIN_DISTANCE_MULTI = 600; // objectif à deux (mètres)
/**
 * Longueur de la piste générée (mètres). En solo, il n'y a pas de ligne d'arrivée :
 * sans aucun choc, on fait environ 5 400 m en 3 minutes (vitesse max x6,2 après 1500 m).
 */
export const TRACK_LENGTH_M = 6000;

/** L'objectif de distance selon le mode de jeu (null = pas d'objectif, en solo). */
export function winDistance(multi: boolean): number | null {
  return multi ? WIN_DISTANCE_MULTI : null;
}
export const MAX_DURATION_SOLO_MS = 3 * 60 * 1000; // 3 minutes en solo
export const MAX_DURATION_MULTI_MS = (2 * 60 + 30) * 1000; // 2 minutes 30 à deux

/** Le temps maximum selon le mode de jeu. */
export function maxDuration(multi: boolean): number {
  return multi ? MAX_DURATION_MULTI_MS : MAX_DURATION_SOLO_MS;
}

/** Pixels parcourus -> mètres affichés (10 pixels = 1 mètre). */
export function toMeters(x: number): number {
  return Math.floor(x / 10);
}

/** Les chiffres d'un joueur, affichés sur l'écran de fin. */
export interface Racer {
  id: string;
  distance: number; // mètres
  thrown: number; // pièges jetés
  dodged: number; // pièges esquivés
}

export interface MatchResult {
  /** Pourquoi la partie s'est arrêtée. */
  reason: 'distance' | 'time';
  durationMs: number;
  /** null = égalité. */
  winnerId: string | null;
  racers: Racer[];
}

/** Renvoie le résultat si la partie est finie, sinon null. */
export function checkEnd(racers: Racer[], elapsedMs: number, goal: number | null, maxMs: number): MatchResult | null {
  const reached = goal !== null && racers.some((r) => r.distance >= goal);
  const timeUp = elapsedMs >= maxMs;
  if (!reached && !timeUp) return null;
  return {
    reason: reached ? 'distance' : 'time',
    durationMs: Math.round(elapsedMs),
    winnerId: leader(racers),
    racers,
  };
}

/** Le joueur le plus loin, ou null en cas d'égalité. */
function leader(racers: Racer[]): string | null {
  const sorted = [...racers].sort((a, b) => b.distance - a.distance);
  if (sorted.length === 0) return null;
  if (sorted.length > 1 && sorted[0].distance === sorted[1].distance) return null;
  return sorted[0].id;
}

/** 83500 ms -> "1:23" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
