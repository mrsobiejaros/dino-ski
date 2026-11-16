/**
 * DINO SKI
 *
 *   - le dino (une image) avance tout seul vers la droite ;
 *   - le bouton A le fait sauter ;
 *   - à 2 joueurs, l'écran est coupé en deux : un joueur en haut, l'autre en bas.
 *
 * Multijoueur : chaque appareil fait avancer SON dino et envoie son état
 * aux autres. Le dino de l'autre joueur suit les mêmes règles (dino.ts),
 * et il est recalé à chaque message reçu.
 *
 * Pause : en salle, la console laisse la partie continuer pour les autres.
 * Un joueur en pause a son dino figé (sa distance ne bouge plus), et il
 * prévient les autres pour que son dino soit figé chez eux aussi.
 *
 * Fin de partie (match.ts) : premier à 600 M, ou le plus loin après 2.5 minutes.
 * En salle, c'est l'hôte qui décide de la fin et l'envoie à tout le monde :
 * ainsi les deux joueurs voient exactement le même écran de fin.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  defineGame,
  defineTexts,
  drawText,
  formatTime,
  PALETTE,
  PLAYER_COLORS,
  useButton,
  useCanvas,
  useGameLoop,
  useMessages,
  useRoomPlayers,
  type GameProps,
} from '@gamebovh/sdk';
import dinoUrl from './assets/dino.jpg';
import { createDino, DINO_SIZE, jump, stepDino, type Dino } from './dino.ts';
import {
  checkEnd,
  formatClock,
  MAX_DURATION_MS,
  toMeters,
  WIN_DISTANCE,
  type MatchResult,
  type Racer,
} from './match.ts';

/* ---------- Le fond : UNE seule image (ciel + décor + sol) ---------- */
// Pour changer de fond, remplacez simplement cette ligne par votre image.
// L'image est répétée horizontalement et défile avec le dino :
// son bord gauche doit raccorder avec son bord droit.
import BACKGROUND from './assets/fond.jpg';
// Hauteur du sol dans l'image, de 0 (tout en haut) à 1 (tout en bas) :
// c'est là que le dino pose ses skis. Pour fond.svg : 88 px sur 108 = 0.815.
const GROUND_LINE = 88 / 108;

/* ---------- Réglages ---------- */
const DINO_SCREEN_X = 48; // position horizontale du dino dans sa moitié d'écran
const SEND_EVERY_MS = 80; // envoi de mon état environ 12 fois par seconde
const SOLO_ID = 'solo'; // identifiant du joueur quand on joue seul

/* ---------- Messages échangés entre les joueurs ---------- */
type DinoMsg =
  | { type: 'jump' } // envoyé tout de suite, pour que le saut se voie sans attendre
  | {
      type: 'state';
      x: number;
      height: number;
      vy: number;
      onGround: boolean;
      paused: boolean;
      thrown: number;
      dodged: number;
    }
  | { type: 'pause'; paused: boolean } // envoyé dès qu'on met en pause ou qu'on reprend
  | { type: 'end'; result: MatchResult }; // envoyé par l'hôte : la partie est finie

/* ---------- Textes, en français et en anglais ---------- */
const TEXTS = defineTexts({
  fr: {
    distance: (m: number) => `${m}/${WIN_DISTANCE} M`,
    hint: 'A : SAUTER',
    you: 'TOI',
    paused: 'EN PAUSE',
    endTitle: 'FIN DE PARTIE',
    reasonDistance: `${WIN_DISTANCE} M ATTEINTS !`,
    reasonTime: 'TEMPS ÉCOULÉ !',
    winner: (name: string) => `GAGNANT : ${name}`,
    draw: 'ÉGALITÉ !',
    duration: (time: string) => `DURÉE ${time}`,
    meters: (m: number) => `${m} M`,
    thrown: (n: number) => `PIÈGES JETÉS : ${n}`,
    dodged: (n: number) => `PIÈGES ESQUIVÉS : ${n}`,
    continue: 'A : CONTINUER',
  },
  en: {
    distance: (m: number) => `${m}/${WIN_DISTANCE} M`,
    hint: 'A: JUMP',
    you: 'YOU',
    paused: 'PAUSED',
    endTitle: 'GAME OVER',
    reasonDistance: `${WIN_DISTANCE} M REACHED!`,
    reasonTime: "TIME'S UP!",
    winner: (name: string) => `WINNER: ${name}`,
    draw: 'DRAW!',
    duration: (time: string) => `TIME ${time}`,
    meters: (m: number) => `${m} M`,
    thrown: (n: number) => `TRAPS THROWN: ${n}`,
    dodged: (n: number) => `TRAPS DODGED: ${n}`,
    continue: 'A: CONTINUE',
  },
});

/** Pièges jetés et esquivés par un joueur (à incrémenter quand les pièges existeront). */
interface TrapStats {
  thrown: number;
  dodged: number;
}

/** Une moitié (ou la totalité) de l'écran, avec le dino qu'elle suit. */
interface Lane {
  id: string;
  dino: Dino;
  stats: TrapStats;
  name: string;
  color: string;
  isMe: boolean;
  paused: boolean;
}

function DinoSki({ ctx }: GameProps<DinoMsg>) {
  const { width, height } = ctx.screen;
  const { canvasProps, get2d } = useCanvas(ctx);
  const t = TEXTS[ctx.lang];
  const players = useRoomPlayers(ctx);

  const dinoImg = useMemo(() => loadImage(dinoUrl), []);
  const backgroundImg = useMemo(() => loadImage(BACKGROUND), []);

  const state = useRef({
    me: createDino(),
    myStats: { thrown: 0, dodged: 0 } as TrapStats,
    others: new Map<string, Dino>(), // dinos des autres joueurs, par identifiant
    otherStats: new Map<string, TrapStats>(),
    pausedOthers: new Set<string>(), // identifiants des autres joueurs en pause
    sendIn: 0,
    elapsed: 0, // durée de la partie (ms)
    result: null as MatchResult | null, // rempli quand la partie est finie
    finished: false, // gameOver déjà appelé ?
  }).current;

  // La liste des joueurs, lue dans la boucle de jeu.
  const playersRef = useRef(players);
  playersRef.current = players;

  /** Mon identifiant : celui de la salle, ou SOLO_ID quand on joue seul. */
  const myId = () => ctx.multiplayer.me?.id ?? SOLO_ID;

  /* ----- Pause : on prévient tout de suite les autres joueurs ----- */
  useEffect(() => {
    const tell = (paused: boolean) => {
      if (ctx.multiplayer.room) ctx.multiplayer.send({ type: 'pause', paused });
    };
    const offPause = ctx.lifecycle.onPause(() => tell(true));
    const offResume = ctx.lifecycle.onResume(() => tell(false));
    return () => {
      offPause();
      offResume();
    };
  }, [ctx]);

  /* ----- Fin de partie ----- */
  /** Fige la partie et affiche l'écran de fin (chez l'hôte et chez les autres). */
  function endMatch(result: MatchResult) {
    if (state.result) return;
    state.result = result;
    const won = result.winnerId === myId();
    ctx.audio.play(won || !ctx.multiplayer.room ? 'win' : 'lose');
  }

  /** Après l'écran de fin : on donne le score à la console (une seule fois). */
  function finish() {
    const result = state.result;
    if (!result || state.finished) return;
    state.finished = true;
    const me = result.racers.find((r) => r.id === myId());
    const distance = me?.distance ?? toMeters(state.me.x);
    let outcome: 'win' | 'lose' | 'draw' | undefined;
    if (ctx.multiplayer.room) {
      outcome = result.winnerId === null ? 'draw' : result.winnerId === myId() ? 'win' : 'lose';
    }
    void ctx.lifecycle.gameOver({ score: distance, display: t.meters(distance), outcome });
  }

  /* ----- Bouton A : saut, ou "continuer" sur l'écran de fin ----- */
  useButton(ctx, 'a', {
    onPress: () => {
      if (ctx.lifecycle.paused) return; // rien pendant la pause
      if (state.result) {
        finish();
        return;
      }
      if (!jump(state.me)) return;
      ctx.audio.play('blip');
      if (ctx.multiplayer.room) ctx.multiplayer.send({ type: 'jump' });
    },
  });

  /* ----- Messages des autres joueurs ----- */
  useMessages(ctx, (msg, from) => {
    if (msg.type === 'end') {
      endMatch(msg.result);
      return;
    }
    let other = state.others.get(from.id);
    if (!other) {
      other = createDino();
      state.others.set(from.id, other);
    }
    const setPaused = (paused: boolean) => {
      if (paused) state.pausedOthers.add(from.id);
      else state.pausedOthers.delete(from.id);
    };
    if (msg.type === 'jump') {
      jump(other);
    } else if (msg.type === 'pause') {
      setPaused(msg.paused);
    } else if (msg.type === 'state') {
      other.x = msg.x;
      other.height = msg.height;
      other.vy = msg.vy;
      other.onGround = msg.onGround;
      state.otherStats.set(from.id, { thrown: msg.thrown, dodged: msg.dodged });
      setPaused(msg.paused);
    }
  });

  /** Les moitiés d'écran : une par joueur, rangées par place (slot). */
  function buildLanes(iAmPaused: boolean): Lane[] {
    const room = playersRef.current;
    if (room.length === 0) {
      return [
        {
          id: SOLO_ID,
          dino: state.me,
          stats: state.myStats,
          name: t.you,
          color: PLAYER_COLORS[0],
          isMe: true,
          paused: iAmPaused,
        },
      ];
    }
    const lanes: Lane[] = [];
    for (const p of [...room].sort((a, b) => a.slot - b.slot).slice(0, 2)) {
      let dino = p.isMe ? state.me : state.others.get(p.id);
      if (!dino) {
        // Pas encore de message reçu : l'autre dino part de zéro, comme nous.
        dino = createDino();
        state.others.set(p.id, dino);
      }
      lanes.push({
        id: p.id,
        dino,
        stats: p.isMe ? state.myStats : (state.otherStats.get(p.id) ?? { thrown: 0, dodged: 0 }),
        name: p.isMe ? t.you : p.nickname.toUpperCase(),
        color: PLAYER_COLORS[p.slot],
        isMe: p.isMe,
        paused: p.isMe ? iAmPaused : state.pausedOthers.has(p.id),
      });
    }
    return lanes;
  }

  // `runWhilePaused` : en salle, la boucle continue pendant MA pause,
  // pour que le dino de l'autre joueur continue d'avancer chez moi.
  useGameLoop(
    ctx,
    (dt) => {
      const iAmPaused = ctx.lifecycle.paused;
      const inRoom = ctx.multiplayer.room !== null;

      if (!state.result) {
        /* 1. Mise à jour : mon dino (sauf en pause), puis ceux des autres (sauf s'ils sont en pause). */
        if (!iAmPaused) stepDino(state.me, dt);
        for (const [id, other] of state.others) {
          if (!state.pausedOthers.has(id)) stepDino(other, dt);
        }

        // Le chrono : en solo il s'arrête pendant la pause, en salle il continue.
        if (inRoom || !iAmPaused) state.elapsed += dt;

        /* 2. Envoi de mon état aux autres, régulièrement (même en pause). */
        state.sendIn -= dt;
        if (state.sendIn <= 0 && inRoom) {
          state.sendIn = SEND_EVERY_MS;
          const d = state.me;
          ctx.multiplayer.send({
            type: 'state',
            x: d.x,
            height: d.height,
            vy: d.vy,
            onGround: d.onGround,
            paused: iAmPaused,
            thrown: state.myStats.thrown,
            dodged: state.myStats.dodged,
          });
        }
      }

      const lanes = buildLanes(iAmPaused);

      /* 3. Fin de partie ? En salle, seul l'hôte décide (puis prévient les autres). */
      const amHost = !inRoom || playersRef.current.find((p) => p.isMe)?.isHost === true;
      if (!state.result && amHost) {
        const racers: Racer[] = lanes.map((l) => ({
          id: l.id,
          distance: toMeters(l.dino.x),
          thrown: l.stats.thrown,
          dodged: l.stats.dodged,
        }));
        const result = checkEnd(racers, state.elapsed);
        if (result) {
          if (inRoom) ctx.multiplayer.send({ type: 'end', result });
          endMatch(result);
        }
      }

      /* 4. Dessin : chaque moitié a sa propre "caméra" qui suit son dino. */
      const g = get2d();
      if (!g) return;
      const laneH = Math.floor(height / Math.max(1, lanes.length));
      lanes.forEach((lane, i) => drawLane(g, lane, i * laneH, laneH));

      // Ligne de séparation entre le haut et le bas
      if (lanes.length > 1) {
        g.fillStyle = PALETTE.gold;
        g.fillRect(0, laneH - 1, width, 2);
      }

      // Temps restant, en haut au centre
      if (!state.result) {
        drawText(g, formatClock(MAX_DURATION_MS - state.elapsed), width / 2, 6, {
          color: PALETTE.snow,
          align: 'center',
        });
      }

      if (state.result) drawEndScreen(g, state.result, lanes);
    },
    { runWhilePaused: true },
  );

  /** Dessine une moitié d'écran (fond, dino, textes). */
  function drawLane(g: CanvasRenderingContext2D, lane: Lane, top: number, h: number) {
    const groundY = top + Math.round(h * GROUND_LINE);
    const camX = lane.dino.x - DINO_SCREEN_X;

    // On ne dessine que dans cette moitié de l'écran.
    g.save();
    g.beginPath();
    g.rect(0, top, width, h);
    g.clip();

    // Le fond : l'image est mise à la hauteur de la moitié d'écran,
    // puis répétée côte à côte et décalée avec la caméra (elle défile).
    if (backgroundImg.complete && backgroundImg.naturalWidth > 0) {
      const tileW = Math.round((backgroundImg.naturalWidth * h) / backgroundImg.naturalHeight);
      // (le "+ tileW) % tileW" garde le décalage positif, même quand camX < 0 au départ)
      const offset = ((Math.floor(camX) % tileW) + tileW) % tileW;
      for (let bx = -offset; bx < width; bx += tileW) {
        g.drawImage(backgroundImg, bx, top, tileW, h);
      }
    } else {
      g.fillStyle = PALETTE.night; // en attendant que l'image soit chargée
      g.fillRect(0, top, width, h);
    }

    // Le dino
    const dx = DINO_SCREEN_X;
    const dy = Math.round(groundY - DINO_SIZE - lane.dino.height);
    if (dinoImg.complete && dinoImg.naturalWidth > 0) {
      g.drawImage(dinoImg, dx, dy, DINO_SIZE, DINO_SIZE);
    } else {
      g.fillStyle = PALETTE.pine;
      g.fillRect(dx, dy, DINO_SIZE, DINO_SIZE);
    }

    // Textes : nom du joueur (à sa couleur), distance, aide
    drawText(g, lane.name, 6, top + 6, { color: lane.color });
    drawText(g, t.distance(toMeters(lane.dino.x)), 6, top + 18);
    if (lane.isMe) drawText(g, t.hint, width - 6, top + 6, { color: PALETTE.gold, align: 'right' });

    // Joueur en pause : on assombrit sa moitié et on l'écrit au milieu.
    if (lane.paused && !state.result) {
      g.fillStyle = 'rgba(11, 30, 63, 0.6)';
      g.fillRect(0, top, width, h);
      drawText(g, t.paused, width / 2, top + h / 2 - 4, { color: PALETTE.gold, align: 'center' });
    }

    g.restore();
  }

  /** L'écran de fin : raison, gagnant, durée, puis les chiffres de chaque joueur. */
  function drawEndScreen(g: CanvasRenderingContext2D, result: MatchResult, lanes: Lane[]) {
    g.fillStyle = 'rgba(11, 30, 63, 0.92)';
    g.fillRect(0, 0, width, height);

    const center = width / 2;
    drawText(g, t.endTitle, center, 12, { color: PALETTE.gold, align: 'center' });
    drawText(g, result.reason === 'distance' ? t.reasonDistance : t.reasonTime, center, 28, {
      color: PALETTE.snow,
      align: 'center',
    });

    // Le gagnant (seulement à plusieurs)
    if (result.racers.length > 1) {
      const winner = lanes.find((l) => l.id === result.winnerId);
      if (winner) drawText(g, t.winner(winner.name), center, 44, { color: winner.color, align: 'center' });
      else drawText(g, t.draw, center, 44, { color: PALETTE.gold, align: 'center' });
    }

    drawText(g, t.duration(formatTime(result.durationMs)), center, 60, { color: PALETTE.ice, align: 'center' });

    // Un bloc par joueur, dans l'ordre des moitiés d'écran
    let y = 82;
    for (const racer of result.racers) {
      const lane = lanes.find((l) => l.id === racer.id);
      const name = lane?.name ?? '?';
      const color = lane?.color ?? PALETTE.snow;
      drawText(g, name, 14, y, { color });
      drawText(g, t.meters(racer.distance), width - 14, y, { color: PALETTE.snow, align: 'right' });
      drawText(g, t.thrown(racer.thrown), 22, y + 12, { color: PALETTE.ice });
      drawText(g, t.dodged(racer.dodged), 22, y + 22, { color: PALETTE.ice });
      y += 44;
    }

    drawText(g, t.continue, center, height - 18, { color: PALETTE.gold, align: 'center' });
  }

  return <canvas {...canvasProps} />;
}

/** Charge une image une fois ; on vérifie `complete` avant de la dessiner. */
function loadImage(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  return img;
}

export default defineGame<DinoMsg>({
  component: DinoSki,
  scoreOrder: 'desc',
  howToPlay: {
    fr: ['Le dino avance seul. A : sauter.', `Le premier à ${WIN_DISTANCE} M gagne !`, 'Après 2:30, le plus loin gagne.'],
    en: ['The dino moves alone. A: jump.', `First to ${WIN_DISTANCE} M wins!`, 'After 2:30, the furthest wins.'],
  },
});
