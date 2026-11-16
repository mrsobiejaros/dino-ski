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
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  defineGame,
  defineTexts,
  drawText,
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

/* ---------- Messages échangés entre les joueurs ---------- */
type DinoMsg =
  | { type: 'jump' } // envoyé tout de suite, pour que le saut se voie sans attendre
  | { type: 'state'; x: number; height: number; vy: number; onGround: boolean; paused: boolean }
  | { type: 'pause'; paused: boolean }; // envoyé dès qu'on met en pause ou qu'on reprend

/* ---------- Textes, en français et en anglais ---------- */
const TEXTS = defineTexts({
  fr: {
    distance: (m: number) => `${m} M`,
    hint: 'A : SAUTER',
    you: 'TOI',
    paused: 'EN PAUSE',
  },
  en: {
    distance: (m: number) => `${m} M`,
    hint: 'A: JUMP',
    you: 'YOU',
    paused: 'PAUSED',
  },
});

/** Une moitié (ou la totalité) de l'écran, avec le dino qu'elle suit. */
interface Lane {
  dino: Dino;
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
    others: new Map<string, Dino>(), // dinos des autres joueurs, par identifiant
    pausedOthers: new Set<string>(), // identifiants des autres joueurs en pause
    sendIn: 0,
  }).current;

  // La liste des joueurs, lue dans la boucle de jeu.
  const playersRef = useRef(players);
  playersRef.current = players;

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

  /* ----- Bouton A : saut ----- */
  useButton(ctx, 'a', {
    onPress: () => {
      if (ctx.lifecycle.paused) return; // pas de saut pendant la pause
      if (!jump(state.me)) return;
      ctx.audio.play('blip');
      if (ctx.multiplayer.room) ctx.multiplayer.send({ type: 'jump' });
    },
  });

  /* ----- Messages des autres joueurs ----- */
  useMessages(ctx, (msg, from) => {
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
      setPaused(msg.paused);
    }
  });

  // `runWhilePaused` : en salle, la boucle continue pendant MA pause,
  // pour que le dino de l'autre joueur continue d'avancer chez moi.
  useGameLoop(
    ctx,
    (dt) => {
      const iAmPaused = ctx.lifecycle.paused;

      /* 1. Mise à jour : mon dino (sauf en pause), puis ceux des autres (sauf s'ils sont en pause). */
      if (!iAmPaused) stepDino(state.me, dt);
      for (const [id, other] of state.others) {
        if (!state.pausedOthers.has(id)) stepDino(other, dt);
      }

      /* 2. Envoi de mon état aux autres, régulièrement (même en pause). */
      state.sendIn -= dt;
      if (state.sendIn <= 0 && ctx.multiplayer.room) {
        state.sendIn = SEND_EVERY_MS;
        const d = state.me;
        ctx.multiplayer.send({
          type: 'state',
          x: d.x,
          height: d.height,
          vy: d.vy,
          onGround: d.onGround,
          paused: iAmPaused,
        });
      }

      /* 3. Les moitiés d'écran : une par joueur, rangées par place (slot). */
      const lanes: Lane[] = [];
      const room = playersRef.current;
      if (room.length === 0) {
        lanes.push({ dino: state.me, name: t.you, color: PLAYER_COLORS[0], isMe: true, paused: iAmPaused });
      } else {
        for (const p of [...room].sort((a, b) => a.slot - b.slot).slice(0, 2)) {
          const dino = p.isMe ? state.me : state.others.get(p.id);
          if (!dino) {
            // Pas encore de message reçu : l'autre dino part de zéro, comme nous.
            state.others.set(p.id, createDino());
            continue;
          }
          lanes.push({
            dino,
            name: p.isMe ? t.you : p.nickname.toUpperCase(),
            color: PLAYER_COLORS[p.slot],
            isMe: p.isMe,
            paused: p.isMe ? iAmPaused : state.pausedOthers.has(p.id),
          });
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
    drawText(g, t.distance(Math.floor(lane.dino.x / 10)), 6, top + 18);
    if (lane.isMe) drawText(g, t.hint, width - 6, top + 6, { color: PALETTE.gold, align: 'right' });

    // Joueur en pause : on assombrit sa moitié et on l'écrit au milieu.
    if (lane.paused) {
      g.fillStyle = 'rgba(11, 30, 63, 0.6)';
      g.fillRect(0, top, width, h);
      drawText(g, t.paused, width / 2, top + h / 2 - 4, { color: PALETTE.gold, align: 'center' });
    }

    g.restore();
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
    fr: ['Le dino avance tout seul.', 'Appuie sur A pour sauter.', 'À deux : un en haut, un en bas !'],
    en: ['The dino moves on its own.', 'Press A to jump.', 'Two players: one on top, one below!'],
  },
});
