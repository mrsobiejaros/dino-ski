/**
 * Les règles de fin de partie (sans React ni dessin).
 *
 *   - le premier joueur qui atteint WIN_DISTANCE mètres gagne ;
 *   - si la partie dure MAX_DURATION_MS (2 min 30), le plus loin gagne.
 */

export const WIN_DISTANCE = 600; // en mètres
export const MAX_DURATION_MS = (2 * 60 + 30) * 1000; // 2 minutes 30

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
export function checkEnd(racers: Racer[], elapsedMs: number): MatchResult | null {
  const reached = racers.some((r) => r.distance >= WIN_DISTANCE);
  const timeUp = elapsedMs >= MAX_DURATION_MS;
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
