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
 * Pièges (traps.ts, à deux seulement) : toutes les 15 s, chacun reçoit un piège
 * au hasard (dans le cercle en haut à droite de sa moitié) et le lance avec B.
 * Le projectile est envoyé à l'autre joueur : c'est SON appareil qui le fait
 * avancer et qui décide s'il touche (gel / saut) ou s'il est esquivé.
 * Chez le lanceur, une copie avance dans la moitié de l'autre, juste pour l'affichage.
 *
 * Fin de partie (match.ts) : premier à l'objectif (1000 M solo, 600 M à deux), ou le plus loin
 * quand le temps est écoulé (3:00 en solo, 2:30 à deux).
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
// Les skins du dino (32 x 24). En solo : le rouge. À deux : rouge en haut, bleu en bas.
import dinoRouge from './assets/dino-rouge.png';
import dinoBleu from './assets/dino-bleu.png';
const DINO_SKINS = [dinoRouge, dinoBleu]; // index 0 = moitié du haut (ou solo), 1 = moitié du bas

// Les sprites des obstacles (0 = tas de neige, 1 = bonhomme de neige)
import tasNeigeUrl from './assets/obstacles/Tas_neige.png';
import snowmanUrl from './assets/obstacles/Snowman.png';
import oiseauUrl from './assets/obstacles/Oiseau.png';
import glaceUrl from './assets/pieges/glace.png';
import bouleNeigeUrl from './assets/pieges/boule-neige.png';
// Image de chaque piège qu'on peut lancer.
const TRAP_SKINS: Record<TrapKind, string> = { freeze: glaceUrl, snowball: bouleNeigeUrl };
const OBSTACLE_SKINS = [tasNeigeUrl, snowmanUrl, oiseauUrl]; // 2 = l'oiseau volant
import {
  createDino,
  DINO_HEIGHT,
  DINO_WIDTH,
  forceJump,
  freeze,
  jump,
  setSpeedUp,
  SPEED_UP_EVERY_M,
  SPEED_UP_LAST_M,
  speedMultiplierAt,
  SPEED_UP_MULTI,
  SPEED_UP_SOLO,
  moveHorizontal,
  slowDown,
  stepDino,
  type Dino,
} from './dino.ts';
import { applyRemoteState, createRemote, remoteJump, stepRemote, type RemoteDino } from './remote.ts';
import { checkObstacles, generateObstacles, type Obstacle } from './obstacles.ts';
import {
  PROJECTILE_SHAPES,
  randomTrap,
  spawnProjectile,
  stepProjectiles,
  TRAP_EVERY_MS,
  TRAP_KINDS,
  TRAP_SPIN_MS,
  type Projectile,
  type TrapKind,
} from './traps.ts';
import {
  checkEnd,
  formatClock,
  maxDuration,
  MAX_DURATION_MULTI_MS,
  MAX_DURATION_SOLO_MS,
  toMeters,
  WIN_DISTANCE_MULTI,
  winDistance,
  type MatchResult,
  type Racer,
} from './match.ts';

/* ---------- Le fond : plusieurs calques superposés (parallaxe) ---------- */
// Chaque calque est une image de 240 x 108 à fond transparent, répétée
// horizontalement. Ils sont dessinés dans l'ordre de la liste : le premier
// tout au fond, le dernier devant. Ensemble, ils donnent l'image complète.
import ciel from './assets/fond/1-ciel.png';
import lune from './assets/fond/2-lune.png';
import montagne from './assets/fond/3-montagne.png';
import nuages from './assets/fond/4-nuages.png';
import sapinsLoin from './assets/fond/5-sapins-loin.png';
import sapinsProches from './assets/fond/6-sapins-proches.png';
import rochers from './assets/fond/7-rochers.png';
import herbe from './assets/fond/8-herbe.png';
import ligne from './assets/fond/9-ligne.png';
// Les décors des biomes (mêmes dimensions que les calques : 240 x 108, fond transparent).
import observatoire from './assets/biomes/observatoire.png';
import barriere from './assets/biomes/barriere.png';
import buissons from './assets/biomes/buissons.png';
import musique from './assets/sons/musique.mp3';

// `speed` : vitesse de défilement du calque par rapport au dino.
//   0   = ne bouge pas (très loin : le ciel)
//   0.5 = défile deux fois moins vite que le dino
//   1   = défile avec le sol, à la vitesse du dino
// Plus un calque est loin, plus il est lent : c'est ce qui donne la profondeur.
// `moon: true` : ce calque ne défile pas, il suit la progression de la partie
// (voir drawMoon).
//
// Les BIOMES : les 3 couches du décor (loin, milieu, près) changent d'image au fil de la course.
//   biome 1 : montagne     / grands sapins     / petits sapins
//   biome 2 : observatoire / barrière en bois  / buissons
// puis on recommence au biome 1. Une couche "biomes" donne une image par biome (dans cet ordre).
interface BackgroundLayer {
  url?: string;
  biomes?: string[];
  speed: number;
  moon?: boolean;
  smooth?: boolean;
}
const BACKGROUND_LAYERS: BackgroundLayer[] = [
  { url: ciel, speed: 0 },
  { url: lune, speed: 0, moon: true },
  // Couche lointaine. `smooth: true` : très lente, déplacée au sous-pixel (voir drawSubPixel).
  { biomes: [montagne, observatoire], speed: 0.1, smooth: true },
  { url: nuages, speed: 0.2 },
  { biomes: [sapinsLoin, barriere], speed: 0.4 }, // couche du milieu
  { biomes: [sapinsProches, buissons], speed: 0.6 }, // couche proche
  { url: rochers, speed: 1 },
  { url: herbe, speed: 1 },
  { url: ligne, speed: 1 },
];
// C'est la couche lointaine (la 1re couche à biomes) qui décide : ses images défilent l'une
// après l'autre (montagne, observatoire, observatoire...). Les couches du milieu et proche
// montrent, dans chaque tranche verticale de l'écran, le biome de l'image lointaine juste
// au-dessus. À la jonction entre deux images lointaines, elles s'effacent en douceur
// (BIOME_FADE) : les arbres disparaissent et réapparaissent en fondu, sans coupure nette.
// Où se trouve la lune dans 2-lune.png (en pixels de l'image de 240 x 108) :
// de x = 213 à x = 230. Si vous changez l'image de la lune, mettez ces valeurs à jour.
const MOON_LEFT = 213;
// Largeur du fondu de chaque côté d'une jonction de biomes, en fraction de la hauteur de la piste.
const BIOME_FADE = 0.12;
const MOON_RIGHT = 230;
const MOON_MARGIN = 10; // écart avec le bord de l'écran, au départ et à l'arrivée
// Hauteur du sol dans les images, de 0 (tout en haut) à 1 (tout en bas) :
// c'est là que le dino pose sa luge : sur la bande de neige (9-ligne.png,
// de 83 à 85 px sur 108), juste au-dessus de l'herbe.
const GROUND_LINE = 83 / 108;
/** Le décor (hors sol) ne défile jamais plus vite que 1,5 fois la vitesse de départ. */
const BG_MAX_FACTOR = 1.5; // le bas de la luge touche le haut de la neige

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
      offsetX: number;
      height: number;
      vy: number;
      onGround: boolean;
      facingLeft: boolean;
      slowTimer: number;
      frozenTimer: number; // pour voir l'autre dino gelé chez soi
      trap: TrapKind | null; // le piège dans son cercle (null = vide)
      dir: -1 | 0 | 1; // direction gauche/droite appuyée, pour prévoir le mouvement entre deux messages
      paused: boolean;
      thrown: number;
      dodged: number;
    }
  | { type: 'pause'; paused: boolean } // envoyé dès qu'on met en pause ou qu'on reprend
  | { type: 'throw'; kind: TrapKind } // je lance un piège sur l'autre joueur
  | { type: 'end'; result: MatchResult }; // envoyé par l'hôte : la partie est finie

/* ---------- Textes, en français et en anglais ---------- */
const TEXTS = defineTexts({
  fr: {
    distance: (m: number, goal: number | null) => (goal === null ? `${m} M` : `${m}/${goal} M`),
    hint: 'A : SAUTER',
    throwHint: 'B : LANCER',
    you: 'TOI',
    paused: 'EN PAUSE',
    endTitle: 'FIN DE PARTIE',
    reasonDistance: (goal: number) => `${goal} M ATTEINTS !`,
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
    distance: (m: number, goal: number | null) => (goal === null ? `${m} M` : `${m}/${goal} M`),
    hint: 'A: JUMP',
    throwHint: 'B: THROW',
    you: 'YOU',
    paused: 'PAUSED',
    endTitle: 'GAME OVER',
    reasonDistance: (goal: number) => `${goal} M REACHED!`,
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

/** Pièges jetés et esquivés par un joueur. */
interface TrapStats {
  thrown: number;
  dodged: number;
}

/** Une moitié (ou la totalité) de l'écran, avec le dino qu'elle suit. */
interface Lane {
  id: string;
  dino: Dino;
  obstacles: Obstacle[];
  stats: TrapStats;
  name: string;
  color: string;
  isMe: boolean;
  paused: boolean;
  /** Numéro du skin dans DINO_SKINS (0 = rouge, 1 = bleu). */
  skin: number;
  /** Projectiles qui foncent sur ce dino. */
  projectiles: Projectile[];
  /** Le piège dans le cercle (null = vide). */
  trap: TrapKind | null;
  /** Le cercle "tourne" encore (le piège vient d'arriver, pas encore lançable). */
  spinning: boolean;
}

function DinoSki({ ctx }: GameProps<DinoMsg>) {
  const { width, height } = ctx.screen;
  const { canvasProps, get2d } = useCanvas(ctx);
  const t = TEXTS[ctx.lang];
  const players = useRoomPlayers(ctx);

  const dinoImgs = useMemo(() => DINO_SKINS.map(loadImage), []);
  const obstacleImgs = useMemo(() => OBSTACLE_SKINS.map(loadImage), []);
  const trapImgs = useMemo(
    () => ({ freeze: loadImage(TRAP_SKINS.freeze), snowball: loadImage(TRAP_SKINS.snowball) }),
    [],
  );
  const backgroundLayers = useMemo(() => {
    // Une seule image par fichier : l'observatoire, utilisé par deux biomes, est le même objet.
    const loaded = new Map<string, HTMLImageElement>();
    const load = (url: string) => {
      let img = loaded.get(url);
      if (!img) {
        img = loadImage(url);
        loaded.set(url, img);
      }
      return img;
    };
    return BACKGROUND_LAYERS.map((layer) => ({
        imgs: (layer.biomes ?? [layer.url ?? '']).map(load),
        speed: layer.speed,
        moon: layer.moon === true,
        smooth: layer.smooth === true,
      }));
  }, []);

  /** Accélération tous les 100 m : +20 % puis de moins en moins en solo (jusqu'à 1500 m), +10 % à deux. */
  /** Distance à atteindre pour gagner : 600 M à deux, aucune en solo (null). */
  const goal = () => winDistance(ctx.multiplayer.room !== null);
  /** Temps maximum : 3:00 en solo, 2:30 à deux. */
  const timeLimit = () => maxDuration(ctx.multiplayer.room !== null);
  const speedUpRate = () => (ctx.multiplayer.room ? SPEED_UP_MULTI : SPEED_UP_SOLO);

  const state = useRef({
    me: createDino(),
    myStats: { thrown: 0, dodged: 0 } as TrapStats,
    myDir: 0 as -1 | 0 | 1, // direction gauche/droite que j'appuie
    others: new Map<string, RemoteDino>(), // dinos des autres joueurs, par identifiant (voir remote.ts)
    otherStats: new Map<string, TrapStats>(),
    pausedOthers: new Set<string>(), // identifiants des autres joueurs en pause
    sendIn: 0,
    elapsed: 0, // durée de la partie (ms)
    result: null as MatchResult | null, // rempli quand la partie est finie
    finished: false, // gameOver déjà appelé ?
    myObstacles: generateObstacles(ctx.seed ?? 0, speedUpRate()),
    otherObstacles: new Map<string, Obstacle[]>(),
    // Pièges
    myTrap: null as TrapKind | null, // mon piège (dans le cercle), null = vide
    trapIn: TRAP_EVERY_MS, // temps avant le prochain piège (ms)
    trapSpin: 0, // > 0 : la roulette tourne encore (ms)
    incoming: [] as Projectile[], // projectiles lancés sur MOI (c'est moi qui décide s'ils touchent)
    outgoing: new Map<string, Projectile[]>(), // copies de mes projectiles chez l'autre (affichage)
    otherTraps: new Map<string, TrapKind | null>(), // le piège dans le cercle de l'autre
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

  /* ----- Musique de fond ----- */
  // En boucle et pas trop fort. Elle ne joue que si le son de la console est activé,
  // se met en pause pendant la pause, s'arrête à l'écran de fin, et quand on quitte le jeu.
  const music = useMemo(() => {
    const audio = new Audio(musique);
    audio.loop = true;
    audio.volume = 0.25;
    return audio;
  }, []);
  useEffect(() => () => music.pause(), [music]);
  useGameLoop(
    ctx,
    () => {
      const shouldPlay = !ctx.audio.muted && !ctx.lifecycle.paused && !state.result;
      if (shouldPlay && music.paused) void music.play().catch(() => {});
      else if (!shouldPlay && !music.paused) music.pause();
    },
    { runWhilePaused: true },
  );

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
    const distance = me?.distance ?? toMeters(state.me.x + state.me.offsetX);
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

  /* ----- Bouton B : lancer mon piège sur l'autre joueur (à deux seulement) ----- */
  useButton(ctx, 'b', {
    onPress: () => {
      if (ctx.lifecycle.paused || state.result) return;
      if (!state.myTrap || state.trapSpin > 0 || !ctx.multiplayer.room) return;
      const kind = state.myTrap;
      state.myTrap = null;
      state.myStats.thrown++;
      ctx.multiplayer.send({ type: 'throw', kind });
      ctx.audio.play('throw');
      // Copie pour l'affichage, dans la moitié de chaque autre joueur.
      for (const [id, other] of state.others) {
        const list = state.outgoing.get(id) ?? [];
        list.push(spawnProjectile(kind, other.shown));
        state.outgoing.set(id, list);
      }
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
      other = createRemote();
      state.others.set(from.id, other);
    }
    const setPaused = (paused: boolean) => {
      if (paused) state.pausedOthers.add(from.id);
      else state.pausedOthers.delete(from.id);
    };
    if (msg.type === 'throw') {
      // Un piège arrive sur moi : il apparaît à droite de mon écran.
      if (state.result) return;
      state.incoming.push(spawnProjectile(msg.kind, state.me));
      ctx.audio.play('whoosh');
    } else if (msg.type === 'jump') {
      remoteJump(other);
    } else if (msg.type === 'pause') {
      setPaused(msg.paused);
    } else if (msg.type === 'state') {
      applyRemoteState(
        other,
        {
          x: msg.x,
          offsetX: msg.offsetX,
          height: msg.height,
          vy: msg.vy,
          onGround: msg.onGround,
          facingLeft: msg.facingLeft,
          slowTimer: msg.slowTimer,
          frozenTimer: msg.frozenTimer,
        },
        msg.dir,
      );
      state.otherTraps.set(from.id, msg.trap);
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
          obstacles: state.myObstacles,
          stats: state.myStats,
          name: t.you,
          color: PLAYER_COLORS[0],
          isMe: true,
          skin: 0, // solo : le dino rouge
          paused: iAmPaused,
          projectiles: [], // pas de pièges en solo
          trap: null,
          spinning: false,
        },
      ];
    }
    const lanes: Lane[] = [];
    for (const p of [...room].sort((a, b) => a.slot - b.slot).slice(0, 2)) {
      let dino: Dino;
      let obstacles: Obstacle[];
      if (p.isMe) {
        dino = state.me;
        obstacles = state.myObstacles;
      } else {
        let other = state.others.get(p.id);
        if (!other) {
          // Pas encore de message reçu : l'autre dino part de zéro, comme nous.
          other = createRemote();
          state.others.set(p.id, other);
        }
        dino = other.shown; // on dessine la version lissée
        let obs = state.otherObstacles.get(p.id);
        if (!obs) {
          obs = generateObstacles(ctx.seed ?? 0, speedUpRate());
          state.otherObstacles.set(p.id, obs);
        }
        obstacles = obs;
      }
      lanes.push({
        id: p.id,
        dino,
        obstacles,
        stats: p.isMe ? state.myStats : (state.otherStats.get(p.id) ?? { thrown: 0, dodged: 0 }),
        name: p.isMe ? t.you : p.nickname.toUpperCase(),
        color: PLAYER_COLORS[p.slot],
        isMe: p.isMe,
        paused: p.isMe ? iAmPaused : state.pausedOthers.has(p.id),
        skin: lanes.length, // 1re moitié (en haut) : rouge, 2e (en bas) : bleu
        projectiles: p.isMe ? state.incoming : (state.outgoing.get(p.id) ?? []),
        trap: p.isMe ? state.myTrap : (state.otherTraps.get(p.id) ?? null),
        spinning: p.isMe && state.trapSpin > 0,
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
      // Accélération tous les 100 m : +20 % puis de moins en moins en solo (jusqu'à 1500 m), +10 % à deux.
      setSpeedUp(speedUpRate());
      // Les pièges n'existent qu'à deux (jamais en solo).
      const withTraps = inRoom && playersRef.current.length >= 2;

      if (!state.result) {
        /* 1. Mise à jour : mon dino (sauf en pause), puis ceux des autres (sauf s'ils sont en pause). */
        if (!iAmPaused) {
          stepDino(state.me, dt);
          const dir = (ctx.input.isDown('right') ? 1 : 0) - (ctx.input.isDown('left') ? 1 : 0);
          state.myDir = dir as -1 | 0 | 1;
          moveHorizontal(state.me, state.myDir, dt);

          const { hits, dodged } = checkObstacles(state.me, state.myObstacles);
          if (hits > 0) {
            slowDown(state.me);
            ctx.audio.play('hit');
            ctx.audio.vibrate(100);
          }
          if (dodged > 0) {
            state.myStats.dodged += dodged;
          }

          if (withTraps) {
            // Un nouveau piège toutes les 15 s (seulement si le cercle est vide).
            state.trapIn -= dt;
            if (state.trapIn <= 0) {
              state.trapIn += TRAP_EVERY_MS;
              if (!state.myTrap) {
                state.myTrap = randomTrap();
                state.trapSpin = TRAP_SPIN_MS;
                ctx.audio.play('select');
              }
            }
            if (state.trapSpin > 0) {
              state.trapSpin -= dt;
              if (state.trapSpin <= 0) ctx.audio.play('coin'); // la roulette s'arrête : prêt à lancer
            }

            // Les projectiles lancés sur moi : touché ou esquivé ?
            const trapRes = stepProjectiles(state.incoming, state.me, dt);
            for (const kind of trapRes.hits) {
              if (kind === 'freeze') {
                freeze(state.me);
              } else {
                forceJump(state.me);
                if (inRoom) ctx.multiplayer.send({ type: 'jump' });
              }
              state.sendIn = 0; // on prévient l'autre tout de suite
              ctx.audio.play('splat');
              ctx.audio.vibrate(150);
            }
            state.myStats.dodged += trapRes.dodged;
          }
        } else {
          state.myDir = 0;
        }
        for (const [id, other] of state.others) {
          if (!state.pausedOthers.has(id)) {
            stepRemote(other, dt);
            const obs = state.otherObstacles.get(id);
            if (obs) checkObstacles(other.shown, obs);
            // Copies de mes projectiles : pour l'affichage seulement (l'effet arrive par ses messages).
            const mine = state.outgoing.get(id);
            if (mine) stepProjectiles(mine, other.shown, dt);
          }
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
            offsetX: d.offsetX,
            height: d.height,
            vy: d.vy,
            onGround: d.onGround,
            facingLeft: d.facingLeft,
            slowTimer: d.slowTimer,
            frozenTimer: d.frozenTimer,
            trap: state.trapSpin > 0 ? null : state.myTrap,
            dir: state.myDir,
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
          distance: toMeters(l.dino.x + l.dino.offsetX),
          thrown: l.stats.thrown,
          dodged: l.stats.dodged,
        }));
        const result = checkEnd(racers, state.elapsed, goal(), timeLimit());
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
        drawText(g, formatClock(timeLimit() - state.elapsed), width / 2, 6, {
          color: PALETTE.snow,
          align: 'center',
        });
      }

      if (state.result) drawEndScreen(g, state.result, lanes);
    },
    { runWhilePaused: true },
  );

  /**
   * Où en est ce joueur dans la partie, de 0 (départ) à 1 (fin).
   * La partie finit à l'objectif (goal) OU quand le temps est écoulé (timeLimit) :
   * on prend celle des deux qui est la plus avancée.
   */
  function laneProgress(lane: Lane): number {
    if (state.result) return 1; // partie finie : la lune est arrivée à gauche
    const target = goal();
    const byDistance = target === null ? 0 : toMeters(lane.dino.x + lane.dino.offsetX) / target;
    const byTime = state.elapsed / timeLimit();
    return Math.min(1, Math.max(byDistance, byTime));
  }

  /**
   * Dessine la lune : elle part à droite de l'écran (progress = 0)
   * et arrive à gauche (progress = 1). Elle garde sa hauteur dans l'image.
   */
  function drawMoon(g: CanvasRenderingContext2D, img: HTMLImageElement, progress: number, top: number, h: number) {
    const scaled = scaledImage(img, h); // l'image mise à la hauteur de la zone de jeu, pixels nets
    if (!scaled) return;
    const scale = h / img.naturalHeight;
    const moonW = (MOON_RIGHT - MOON_LEFT) * scale;
    const margin = MOON_MARGIN * scale;
    const startX = width - margin - moonW; // tout à droite
    const endX = margin; // tout à gauche
    const moonX = startX + (endX - startX) * progress;
    // On décale toute l'image pour que la lune tombe à moonX (au sous-pixel : pas d'à-coups).
    drawSubPixel(g, true, () => g.drawImage(scaled, moonX - MOON_LEFT * scale, top));
  }

  /**
   * Dessine le dino, avec une petite animation faite par le code
   * (le sprite Aseprite n'a qu'une seule image) :
   *   - au sol : la luge tressaute d'1 pixel et de la neige gicle derrière ;
   *   - en l'air : le dino se penche (nez en haut en montant, en bas en descendant).
   * L'animation suit la distance parcourue (`dino.x`) : elle s'arrête en pause.
   */
  function drawDino(g: CanvasRenderingContext2D, dino: Dino, dinoImg: HTMLImageElement, dx: number, groundY: number) {
    // Clignotement pendant le ralentissement après un choc
    if ((dino.slowTimer ?? 0) > 0 && Math.floor((dino.slowTimer ?? 0) / 80) % 2 === 0) return;

    const bob = dino.onGround && Math.floor(dino.x / 10) % 2 === 0 ? -1 : 0; // tressautement
    const dy = Math.round(groundY - DINO_HEIGHT - dino.height) + bob;
    const back = dino.facingLeft ? 1 : -1; // côté arrière de la luge (+1 = à droite)

    // Neige qui gicle derrière la luge (seulement au sol)
    if (dino.onGround) {
      g.fillStyle = PALETTE.snow;
      const rearX = dino.facingLeft ? dx + DINO_WIDTH : dx;
      for (let i = 0; i < 4; i++) {
        const p = (dino.x * 0.6 + i * 5) % 20; // 0 -> 20 : la particule s'éloigne puis renaît
        const px = rearX + back * (2 + p);
        const py = groundY - 2 - Math.round(Math.sin((p / 20) * Math.PI) * 5);
        const size = p < 10 ? 2 : 1; // les particules rapetissent en s'éloignant
        g.fillRect(Math.round(px), py, size, size);
      }
    }

    if (!dinoImg.complete || dinoImg.naturalWidth === 0) {
      g.fillStyle = PALETTE.pine; // en attendant que l'image soit chargée
      g.fillRect(dx, dy, DINO_WIDTH, DINO_HEIGHT);
      return;
    }

    // Inclinaison pendant le saut : proportionnelle à la vitesse verticale.
    const tilt = dino.onGround ? 0 : Math.max(-0.35, Math.min(0.35, -dino.vy * 0.9));

    g.save();
    // On place le repère au centre du dino, on le penche, puis on le retourne s'il recule.
    g.translate(dx + DINO_WIDTH / 2, dy + DINO_HEIGHT / 2);
    if (dino.facingLeft) g.scale(-1, 1);
    g.rotate(tilt);
    g.drawImage(dinoImg, -DINO_WIDTH / 2, -DINO_HEIGHT / 2, DINO_WIDTH, DINO_HEIGHT);
    g.restore();

    // Gelé par un projectile bleu : un bloc de glace par-dessus.
    if (dino.frozenTimer > 0) {
      g.fillStyle = 'rgba(140, 210, 255, 0.45)';
      g.fillRect(dx - 2, dy - 2, DINO_WIDTH + 4, DINO_HEIGHT + 4);
      g.strokeStyle = PALETTE.ice;
      g.lineWidth = 1;
      g.strokeRect(dx - 1.5, dy - 1.5, DINO_WIDTH + 3, DINO_HEIGHT + 3);
      g.fillStyle = PALETTE.snow; // reflets
      g.fillRect(dx + 2, dy, 4, 1);
      g.fillRect(dx, dy + 2, 1, 4);
    }
  }

  /**
   * Dessine l'image d'un piège, son coin haut-gauche en (x, y).
   * `maxW` : si l'image est plus large, on la réduit (pour la faire tenir dans le cercle).
   */
  function drawProjectile(g: CanvasRenderingContext2D, kind: TrapKind, x: number, y: number, maxW = Infinity) {
    const img = trapImgs[kind];
    if (!img.complete || img.naturalWidth === 0) return;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    g.drawImage(img, Math.round(x), Math.round(y), w, h);
  }

  /** Dessine l'image d'un piège centrée en (cx, cy), à au plus 14 px de large (dans le cercle). */
  function drawTrapIcon(g: CanvasRenderingContext2D, kind: TrapKind, cx: number, cy: number) {
    const shape = PROJECTILE_SHAPES[kind];
    const scale = Math.min(1, 14 / shape.width);
    drawProjectile(g, kind, cx - (shape.width * scale) / 2, cy - (shape.height * scale) / 2, 14);
  }

  /** Le cercle "à la Mario Kart" en haut à droite : vide, en roulette, ou avec le piège. */
  function drawTrapBox(g: CanvasRenderingContext2D, lane: Lane, cx: number, cy: number) {
    const r = 9;
    g.fillStyle = 'rgba(11, 30, 63, 0.75)';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = PALETTE.gold;
    g.lineWidth = 2;
    g.stroke();
    if (lane.spinning) {
      // La roulette : les pièges défilent très vite.
      const kind = TRAP_KINDS[Math.floor(state.trapSpin / 90) % TRAP_KINDS.length];
      drawTrapIcon(g, kind, cx, cy);
    } else if (lane.trap) {
      drawTrapIcon(g, lane.trap, cx, cy);
    }
  }

  /** Dessine une moitié d'écran (fond, dino, textes). */
  function drawLane(g: CanvasRenderingContext2D, lane: Lane, top: number, h: number) {
    const groundY = top + Math.round(h * GROUND_LINE);
    const camX = lane.dino.x - DINO_SCREEN_X;
    // Caméra du décor lointain : elle suit le dino, mais sans dépasser BG_MAX_FACTOR fois
    // la vitesse de départ (sinon, avec les accélérations, le fond défilerait trop vite).
    const bgCamX = backgroundDistance(lane.dino.x) - DINO_SCREEN_X;

    // On ne dessine que dans cette moitié de l'écran.
    g.save();
    g.beginPath();
    g.rect(0, top, width, h);
    g.clip();

    // Le fond : une couleur unie au cas où une image ne serait pas encore chargée,
    // puis chaque calque, du plus lointain au plus proche.
    g.fillStyle = PALETTE.night;
    g.fillRect(0, top, width, h);
    const progress = laneProgress(lane);
    // La couche lointaine (1re couche à biomes) : sa vitesse et la largeur de ses images.
    let far: FarBiomes | null = null;
    for (const layer of backgroundLayers) {
      if (layer.moon) drawMoon(g, layer.imgs[0], progress, top, h);
      else {
        // Le sol (vitesse 1) suit exactement le dino, sinon les obstacles glisseraient dessus.
        const cam = layer.speed >= 1 ? camX : bgCamX;
        if (layer.imgs.length > 1) {
          if (far === null) {
            const tileW = scaledImage(layer.imgs[0], h)?.width;
            if (!tileW) continue;
            far = { speed: layer.speed, tileW, count: layer.imgs.length };
          }
          drawBiomeLayer(g, layer.imgs, cam, layer.speed, far, top, h, layer.smooth);
        } else drawLayer(g, layer.imgs[0], cam * layer.speed, top, h, layer.smooth);
      }
    }

    // Les obstacles sur la piste
    // Les obstacles sur la piste
    for (const obs of lane.obstacles) {
      const ox = Math.round(obs.x - camX);
      if (ox + obs.width < 0 || ox > width) continue;
      // Un obstacle volant monte et descend d'un pixel, comme s'il battait des ailes.
      const flap = obs.fly > 0 && Math.floor(obs.x / 7 + camX / 20) % 2 === 0 ? -1 : 0;
      const oy = Math.round(groundY - obs.fly - obs.height) + flap;
      const img = obstacleImgs[obs.kind];
      if (img && img.complete && img.naturalWidth > 0) {
        g.drawImage(img, ox, oy, obs.width, obs.height);
      } else {
        g.fillStyle = obs.resolved ? PALETTE.wood : PALETTE.red;
        g.fillRect(ox, oy, obs.width, obs.height);
      }
    }

    // Les projectiles qui foncent sur ce dino
    for (const p of lane.projectiles) {
      const px = p.x - camX;
      const shape = PROJECTILE_SHAPES[p.kind];
      if (px + shape.width < 0 || px > width) continue;
      drawProjectile(g, p.kind, px, groundY - shape.fly - shape.height);
    }

    // Le dino
    drawDino(g, lane.dino, dinoImgs[lane.skin], Math.round(DINO_SCREEN_X + lane.dino.offsetX), groundY);

    // Textes : nom du joueur (à sa couleur), distance, aide
    drawText(g, lane.name, 6, top + 6, { color: lane.color });
    drawText(g, t.distance(toMeters(lane.dino.x + lane.dino.offsetX), goal()), 6, top + 18);
    // À deux : le cercle du piège en haut à droite, et l'aide juste en dessous
    // (à côté du cercle, elle cacherait le chrono : la police fait 8 px par lettre).
    const withTraps = ctx.multiplayer.room !== null && playersRef.current.length >= 2;
    const hintY = withTraps ? top + 28 : top + 6;
    if (withTraps) drawTrapBox(g, lane, width - 16, top + 15);
    if (lane.isMe) {
      drawText(g, t.hint, width - 6, hintY, { color: PALETTE.gold, align: 'right' });
      if (lane.trap && !lane.spinning) {
        drawText(g, t.throwHint, width - 6, hintY + 10, { color: PALETTE.ice, align: 'right' });
      }
    }

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
    drawText(g, result.reason === 'distance' ? t.reasonDistance(goal() ?? WIN_DISTANCE_MULTI) : t.reasonTime, center, 28, {
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
      if (result.racers.length > 1) {
        // À deux : pièges jetés + esquivés. En solo, on ne peut rien jeter : on n'affiche que les esquives.
        drawText(g, t.thrown(racer.thrown), 22, y + 12, { color: PALETTE.ice });
        drawText(g, t.dodged(racer.dodged), 22, y + 22, { color: PALETTE.ice });
      } else {
        drawText(g, t.dodged(racer.dodged), 22, y + 12, { color: PALETTE.ice });
      }
      y += 44;
    }

    drawText(g, t.continue, center, height - 18, { color: PALETTE.gold, align: 'center' });
  }

  return <canvas {...canvasProps} />;
}

/**
 * Dessine un calque du fond : l'image est mise à la hauteur `h`, répétée côte à côte
 * et décalée de `scrollX` pixels vers la gauche (c'est ce qui la fait défiler).
 */
function drawLayer(
  g: CanvasRenderingContext2D,
  img: HTMLImageElement,
  scrollX: number,
  top: number,
  h: number,
  smooth = false,
) {
  const scaled = scaledImage(img, h);
  if (!scaled) return;
  const screenW = g.canvas.width;
  const tileW = scaled.width;
  // Calque lissé : on garde les décimales (sous-pixel). Sinon : arrondi au pixel, net.
  const scroll = smooth ? scrollX : Math.floor(scrollX);
  // (le "+ tileW) % tileW" garde le décalage positif, même quand scrollX < 0 au départ)
  const offset = ((scroll % tileW) + tileW) % tileW;
  drawSubPixel(g, smooth, () => {
    for (let x = -offset; x < screenW; x += tileW) g.drawImage(scaled, x, top);
  });
}

/** La couche lointaine, qui décide des biomes : sa vitesse, la largeur de ses images, nb de biomes. */
interface FarBiomes {
  speed: number;
  tileW: number;
  count: number;
}

/**
 * Biome de l'image lointaine n°k (k = 1, 2, 3... en partant de la droite de l'écran au départ) :
 * (k - 1) modulo le nombre de biomes. k <= 0 : les images déjà à l'écran au départ (biome 1).
 */
function farBiome(k: number, far: FarBiomes): number {
  return k <= 0 ? 0 : (k - 1) % far.count;
}

let biomeCanvas: HTMLCanvasElement | null = null; // canvas hors écran, jamais ajouté à la page

/**
 * Dessine une couche à biomes.
 * - La couche lointaine : ses images entières, l'une après l'autre.
 * - Les autres : dans la tranche de chaque image lointaine, l'image de son biome (répétée).
 * Autour d'une jonction entre deux biomes différents, chaque couche s'efface en fondu.
 */
function drawBiomeLayer(
  g: CanvasRenderingContext2D,
  imgs: HTMLImageElement[],
  cam: number,
  speed: number,
  far: FarBiomes,
  top: number,
  h: number,
  smooth: boolean,
) {
  const screenW = g.canvas.width;
  const farScroll = cam * far.speed;
  const first = Math.floor(farScroll / far.tileW);
  const isFar = speed <= far.speed;

  // On dessine la couche sur un canvas à part (une piste de haut), puis on y "gomme" les jonctions.
  if (!biomeCanvas) biomeCanvas = document.createElement('canvas');
  if (biomeCanvas.width !== screenW || biomeCanvas.height !== h) {
    biomeCanvas.width = screenW;
    biomeCanvas.height = h;
  }
  const off = biomeCanvas.getContext('2d');
  if (!off) return;
  off.imageSmoothingEnabled = false;
  off.globalCompositeOperation = 'source-over';
  off.clearRect(0, 0, screenW, h);

  const fade = Math.round(h * BIOME_FADE);
  for (let k = first; k * far.tileW - farScroll < screenW; k++) {
    const x0 = Math.round(k * far.tileW - farScroll);
    const x1 = Math.round((k + 1) * far.tileW - farScroll);
    const img = imgs[farBiome(k, far)];
    if (!img) continue;
    if (isFar) {
      // La couche lointaine : une image entière par tranche.
      const tile = scaledImage(img, h);
      if (tile) drawSubPixel(off, smooth, () => off.drawImage(tile, k * far.tileW - farScroll, 0));
      continue;
    }
    off.save();
    off.beginPath();
    off.rect(x0, 0, x1 - x0, h);
    off.clip();
    drawLayer(off, img, cam * speed, 0, h, smooth);
    off.restore();
  }
  // Puis, à chaque jonction entre deux biomes différents, on gomme la couche en fondu.
  for (let k = first; k * far.tileW - farScroll < screenW; k++) {
    const x1 = Math.round((k + 1) * far.tileW - farScroll);
    if (farBiome(k + 1, far) !== farBiome(k, far) && x1 - fade < screenW && x1 + fade > 0) {
      const grad = off.createLinearGradient(x1 - fade, 0, x1 + fade, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      off.globalCompositeOperation = 'destination-out';
      off.fillStyle = grad;
      off.fillRect(x1 - fade, 0, fade * 2, h);
      off.globalCompositeOperation = 'source-over';
    }
  }
  g.drawImage(biomeCanvas, 0, top);
}

/**
 * Distance "vue par le décor" quand le dino a parcouru `x` pixels.
 * Tant que le dino va moins vite que BG_MAX_FACTOR fois sa vitesse de départ, c'est `x`.
 * Au-delà, le décor (hors sol) avance comme si le dino restait à BG_MAX_FACTOR :
 * les accélérations se voient au sol et aux obstacles, sans que le fond file à toute allure.
 */
function backgroundDistance(x: number): number {
  if (x <= 0) return x;
  const stepPx = SPEED_UP_EVERY_M * 10; // un palier = 100 m = 1000 px
  const lastStep = SPEED_UP_LAST_M / SPEED_UP_EVERY_M; // ensuite, la vitesse ne change plus
  let total = 0;
  let k = 0;
  for (; k < lastStep && (k + 1) * stepPx <= x; k++) {
    total += stepPx * Math.min(1, BG_MAX_FACTOR / speedMultiplierAt(k * SPEED_UP_EVERY_M));
  }
  // Le reste, au rythme du palier où se trouve le dino.
  return total + (x - k * stepPx) * Math.min(1, BG_MAX_FACTOR / speedMultiplierAt(k * SPEED_UP_EVERY_M));
}

/**
 * Dessine avec ou sans lissage.
 *
 * Pourquoi : l'écran ne fait que 240 pixels de large. Un calque très lent
 * (montagne, lune) ne peut bouger que d'un pixel entier à la fois : on voit
 * des à-coups. Avec le lissage, une position comme x = 10,4 mélange un peu
 * les pixels voisins, et le mouvement paraît continu. On ne l'utilise que
 * pour la montagne et la lune : sur les sapins, très détaillés, ça fait flou.
 */
function drawSubPixel(g: CanvasRenderingContext2D, smooth: boolean, draw: () => void) {
  if (!smooth) {
    draw();
    return;
  }
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  draw();
  g.restore();
}

/**
 * L'image agrandie à la hauteur `h`, en gardant des pixels nets.
 * Préparée une seule fois par taille, puis réutilisée : ensuite elle n'est
 * plus que décalée, jamais réagrandie, donc le lissage ne la rend pas floue.
 */
const scaledCache = new WeakMap<HTMLImageElement, Map<number, HTMLCanvasElement>>();
function scaledImage(img: HTMLImageElement, h: number): HTMLCanvasElement | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  let bySize = scaledCache.get(img);
  if (!bySize) {
    bySize = new Map();
    scaledCache.set(img, bySize);
  }
  let canvas = bySize.get(h);
  if (!canvas) {
    canvas = document.createElement('canvas'); // canvas hors écran, jamais ajouté à la page
    canvas.width = Math.round((img.naturalWidth * h) / img.naturalHeight);
    canvas.height = h;
    const c = canvas.getContext('2d');
    if (!c) return null;
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    bySize.set(h, canvas);
  }
  return canvas;
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
    fr: [
      `A : sauter. Solo : va le plus loin en ${formatClock(MAX_DURATION_SOLO_MS)}.`,
      `À deux : premier à ${WIN_DISTANCE_MULTI} M (${formatClock(MAX_DURATION_MULTI_MS)} max). B : lancer un piège.`,
      'Piège toutes les 15 s. Bleu : paralyse. Neige : fait sauter.',
    ],
    en: [
      `A: jump. Solo: go as far as you can in ${formatClock(MAX_DURATION_SOLO_MS)}.`,
      `With two: first to ${WIN_DISTANCE_MULTI} M (${formatClock(MAX_DURATION_MULTI_MS)} max). B: throw a trap.`,
      'Trap every 15 s. Blue: freezes. Snowball: makes you jump.',
    ],
  },
});