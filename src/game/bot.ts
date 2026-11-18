import { ARMORS, CARDS, PIECES, RULES, canClassBeUsedBy, type PieceKind } from './config';
import { applyAction, flagCarrier, flagHex, legalActions, reachableHexes, selectableUnits, summonHexes } from './engine';
import { nextRandom } from './rng';
import { DIAGONALS, DIRECTIONS, KNIGHT_JUMPS, hex, hexDistance, hexEq, inBoard, type Hex } from './hex';
import type { Action, GameState, Piece, Unit } from './types';

/**
 * Greedy capture-the-flag bot for the one-unit-per-turn rules.
 *  1. If it must discard, it drops the card it can least use.
 *  2. It picks its unit (base or one piece) by playing out each option on a copy of the game
 *     (with re-seeded dice, so it can't peek at real rolls) and scoring the result.
 *  3. With the unit chosen it repeatedly takes the single action that most improves the score.
 * It is a sparring partner / rules sanity check, not a strong player.
 */
export function chooseBotAction(s: GameState): Action {
  if (s.mustDiscard > 0) return bestDiscard(s);
  if (!s.active && !s.turnActed) {
    const unit = chooseUnit(s);
    return unit ? { type: 'selectUnit', unit } : { type: 'endTurn' };
  }
  // Easy: sometimes forgets to finish what it started.
  if (effDiff(s, s.current) === 'easy' && s.turnActed && chance(0.35)) return { type: 'endTurn' };
  if (effDiff(s, s.current) === 'hard') return hardStep(s, s.current, 7 + s.round);
  return greedyStep(s, s.current, 7);
}

/** Turns a piece of `kind` needs to LAND on `to` from `from` on an empty board (BFS, cached per target). */
const turnCache = new Map<string, Map<string, number>>();
export function turnsTo(kind: PieceKind, from: Hex, to: Hex): number {
  const key = `${kind}|${to.q},${to.r}`;
  let dist = turnCache.get(key);
  if (!dist) {
    dist = new Map();
    const rule = PIECES[kind].move;
    const steps: Hex[] = [];
    for (const d of DIRECTIONS) for (let k = 1; k <= rule.straight; k++) steps.push(hex(d.q * k, d.r * k));
    for (const d of DIAGONALS) for (let k = 1; k <= rule.diagonal; k++) steps.push(hex(d.q * k, d.r * k));
    if (rule.knightJump) steps.push(...KNIGHT_JUMPS);
    dist.set(`${to.q},${to.r}`, 0);
    let frontier = [to];
    for (let t = 1; frontier.length; t++) {
      const next: Hex[] = [];
      for (const h of frontier) for (const st of steps) {
        const n = hex(h.q - st.q, h.r - st.r);
        const nk = `${n.q},${n.r}`;
        if (!inBoard(n, RULES.boardRadius) || dist.has(nk)) continue;
        dist.set(nk, t);
        next.push(n);
      }
      frontier = next;
    }
    turnCache.set(key, dist);
  }
  return dist.get(`${from.q},${from.r}`) ?? 20;
}
const WORTH: Record<PieceKind, number> = { pawn: 6, knight: 12, bishop: 15, rook: 18, queen: 24, king: 30 };

type Relation = 'self' | 'ally' | 'enemy';

/** How `me` sees player `other`. In Dogpile the AIs are a team against the humans. */
export function relation(s: GameState, me: number, other: number): Relation {
  if (me === other) return 'self';
  if (s.mode === 'dogpile' && s.players[me].isBot) return s.players[other].isBot ? 'ally' : 'enemy';
  return 'enemy';
}

const pieceWorth = (p: Piece) =>
  WORTH[p.kind] + p.hp * 2 + p.shield + p.bonusDamage + (p.shackles ? 6 : 0) + (p.armor ? (ARMORS[p.armor].pool ? (p.armorPool ?? 0) : (ARMORS[p.armor].reduce ?? 0) * 3) : 0);

/** Score a position from player `me`'s point of view. */
export function evaluate(s: GameState, me: number): number {
  const rel = (o: number) => relation(s, me, o);
  const dogpileAI = s.mode === 'dogpile' && s.players[me].isBot;
  if (s.winner !== null) return s.winner === me ? 1e6 : rel(s.winner) === 'ally' ? 6e5 : -1e6;
  const meP = s.players[me];
  if (!meP.alive) return -1e6;
  const enemies = s.players.filter((p) => p.alive && rel(p.index) === 'enemy');
  const team = (o: number) => o === me || (dogpileAI && rel(o) === 'ally');
  const share = 1 / Math.max(1, enemies.length);
  let v = 0;

  // Flag race
  const carrier = flagCarrier(s);
  if (carrier) {
    const home = s.players[carrier.owner].base;
    const d = turnsTo(carrier.kind, carrier.pos, home) * 1.5;
    // A carrier heading for a ruined base can't score yet: worth much less.
    const val = (400 + (20 - d) * 35) * (s.players[carrier.owner].ruined ? 0.3 : 1);
    const r = rel(carrier.owner);
    v += r === 'self' ? val : r === 'ally' ? val * 0.4 : -val * (dogpileAI ? 1.5 : 1);
    if (r === 'self') {
      // carriers want escorts and fear nearby enemies
      const threats = s.pieces.filter((p) => rel(p.owner) === 'enemy' && hexDistance(p.pos, carrier.pos) <= 3).length;
      v -= threats * 25;
      // Clear the way home: our own pieces on the base hex block the carrier.
      const blocker = s.pieces.find((p) => p.owner === me && p.id !== carrier.id && hexEq(p.pos, home));
      // (Constant while we carry, so it never discourages the carrier from approaching.)
      if (blocker) v -= 150;
      v -= s.pieces.filter((p) => p.owner === me && p.id !== carrier.id && hexDistance(p.pos, home) === 1).length * 40;
    } else if (r === 'enemy') {
      // chase the enemy carrier
      const mine = s.pieces.filter((p) => p.owner === me);
      if (mine.length) v -= Math.min(...mine.map((p) => hexDistance(p.pos, carrier.pos) / 2)) * (dogpileAI ? 30 : 20);
    }
  } else {
    const f = flagHex(s)!;
    const turns = (pred: (o: number) => boolean) => {
      const ps = s.pieces.filter((p) => pred(p.owner));
      return ps.length ? Math.min(...ps.map((p) => turnsTo(p.kind, p.pos, f))) : 15;
    };
    const mine = turns((o) => o === me);
    const ours = turns(team);
    // Nudge the whole army forward a little.
    for (const p of s.pieces) if (p.owner === me) v -= Math.min(turnsTo(p.kind, p.pos, f), 8) * (dogpileAI ? 1 : 2);
    const theirs = enemies.length ? Math.min(...enemies.map((e) => turns((o) => o === e.index)), 15) : 15;
    v += (theirs - ours) * 30 - mine * (dogpileAI ? 4 : 10);
  }

  // Material
  for (const p of s.pieces) {
    const w = pieceWorth(p);
    const r = rel(p.owner);
    v += r === 'self' ? w : r === 'ally' ? w * 0.3 : -w * share * (dogpileAI ? 1.5 : 1);
  }
  // Bases
  v += meP.baseHp * 5;
  if (meP.ruined) {
    // Get a King/Rook home and rebuild; losing the last one knocks us out.
    const builders = s.pieces.filter((p) => p.owner === me && (p.kind === 'king' || p.kind === 'rook'));
    v -= 250;
    if (builders.length) v -= Math.min(...builders.map((b) => turnsTo(b.kind, b.pos, meP.base))) * 25;
  }
  for (const e of enemies) if (e.ruined) v += 120 * share;
  const garrison = s.pieces.find((p) => p.owner === me && hexEq(p.pos, meP.base));
  if (garrison) v += 15;
  for (const e of enemies) v -= e.baseHp * 2 * share * (dogpileAI ? 4 : 1);
  v += s.players.filter((p) => !p.alive && rel(p.index) === 'enemy').length * 150;
  if (dogpileAI) {
    // Hunt the humans: every AI piece wants to be near a human piece or base.
    const targets = [...s.pieces.filter((p) => rel(p.owner) === 'enemy').map((p) => p.pos), ...enemies.map((e) => e.base)];
    if (targets.length) {
      for (const p of s.pieces) if (p.owner === me) v -= Math.min(...targets.map((t) => hexDistance(t, p.pos)), 12) * 3;
    }
  }
  // Keep a summoning hex free so the base stays useful.
  if (!summonHexes(s, me).length) v -= 30;
  // Cards in hand are options
  v += meP.hand.length * 3;
  return v;
}

/**
 * Hard bots also look one enemy turn ahead: what is the worst single attack an enemy piece
 * could land on one of ours (each opponent only gets one unit per turn)?
 */
function threatPenalty(s: GameState, me: number): number {
  const mine = s.pieces.filter((p) => p.owner === me);
  if (!mine.length) return 0;
  const losses: number[] = [];
  const enemyOwners = s.players.filter((pl) => pl.alive && relation(s, me, pl.index) === 'enemy').map((pl) => pl.index);
  const soakOf = (p: Piece) => p.shield + (p.armor ? (ARMORS[p.armor].pool ? (p.armorPool ?? 0) : (ARMORS[p.armor].reduce ?? 0)) : 0);
  /** Chance that one d`die` + bonus gets through `soak` and kills `hp`. */
  const pKill = (die: number, bonus: number, soak: number, hp: number) => {
    let k = 0;
    for (let r = 1; r <= die; r++) if (r + bonus - soak >= hp) k++;
    return k / die;
  };
  const lossOf = (p: Piece, pk: number, dmg: number) => {
    const carrying = s.flag.carrier === p.id;
    return pk * (pieceWorth(p) + (carrying ? 600 : 0)) + (1 - pk) * (Math.min(dmg, p.hp) * 2 + (carrying ? Math.min(dmg, p.hp) * 15 : 0));
  };
  for (const owner of enemyOwners) {
    const opp = s.players[owner];
    // Hidden hands: Hard guesses from energy and how common the card is (~hand size × copies / deck).
    const guess = (copies: number) => Math.min(0.9, (opp.hand.length * copies) / 66);
    let worst = 0;
    for (const e of s.pieces.filter((p) => p.owner === owner)) {
      const from = [e.pos, ...reachableHexes(s, e)];
      const die = PIECES[e.kind].die;
      for (const p of mine) {
        const soak = soakOf(p);
        const near = (r: number) => from.some((h) => hexDistance(h, p.pos) <= r);
        if (near(1)) {
          const pk = pKill(die, e.bonusDamage, soak, p.hp);
          worst = Math.max(worst, lossOf(p, pk, Math.max(0, (die + 1) / 2 + e.bonusDamage - soak)));
        }
        if (e.shackles && e.hp > p.hp && from.some((h) => hexEq(h, p.pos))) {
          worst = Math.max(worst, lossOf(p, 1, p.hp));
        }
        const knightish = e.kind === 'knight' || e.kind === 'king';
        const bishopish = e.kind === 'bishop' || e.kind === 'queen' || e.kind === 'king';
        // Cordon of Arrows: ~18 damage focused on one piece, range 4.
        if (knightish && opp.energy >= 3 && near(4)) {
          const dmg = Math.max(0, 18 - 4 * Math.min(soak, 4));
          const pk = dmg >= p.hp ? 0.75 : dmg >= p.hp * 0.7 ? 0.35 : 0;
          worst = Math.max(worst, guess(2) * lossOf(p, pk, dmg));
        }
        // Fire Bolt: 2d4 (avg 5), range 3.
        if (bishopish && opp.energy >= 1 && near(3)) {
          const dmg = Math.max(0, 5 - soak);
          const pk = dmg >= p.hp ? 0.6 : dmg + 3 >= p.hp ? 0.25 : 0;
          worst = Math.max(worst, guess(3) * lossOf(p, pk, dmg));
        }
      }
    }
    losses.push(worst);
  }
  return losses.reduce((a, b) => a + b, 0) * 0.5;
}

/** Final score used when comparing whole-turn plans; Hard adds the lookahead. */
function planScore(s: GameState, me: number): number {
  const v = evaluate(s, me);
  return effDiff(s, me) === 'hard' && s.winner === null ? v - threatPenalty(s, me) : v;
}

function clone(s: GameState, salt: number): GameState {
  const c = structuredClone({ ...s, log: [] as string[] });
  c.rngState = (s.rngState ^ 0x5bd1e995) + salt * 7919; // fresh dice: no peeking at real rolls
  return c;
}

/** Actions available to the chosen unit (the engine still allows switching, the bot does not). */
function unitActions(s: GameState): Action[] {
  const u = s.active;
  return legalActions(s).filter((a) => {
    if (a.type === 'endTurn' || a.type === 'discard' || a.type === 'selectUnit') return false;
    if (a.type === 'playCard') {
      const card = s.players[s.current].hand.find((c) => c.uid === a.cardUid)!;
      const def = CARDS[card.id];
      if ((def.cls === 'conjuration') !== (u?.kind === 'base')) return false;
      // Only consider Fireball centred on something worth burning.
      if (def.targeting === 'areaHex' && a.target?.kind === 'hex') {
        const h = a.target.hex;
        return s.pieces.some((p) => p.owner !== s.current && hexEq(p.pos, h)) || s.players.some((p) => p.alive && p.index !== s.current && hexEq(p.base, h));
      }
      return true;
    }
    return u?.kind === 'piece' && a.pieceId === u.id;
  });
}

/**
 * Hard: look further than one action. Shortlist the best-looking next actions, play each one
 * out to the end of this unit's turn (twice, with different dice) and keep the best plan.
 */
function hardStep(s: GameState, me: number, salt: number): Action {
  if (s.mustDiscard > 0) return bestDiscard(s);
  const scored: { a: Action; v: number }[] = [];
  let i = 0;
  for (const a of unitActions(s)) {
    const c = clone(s, salt * 131 + i++ * 17);
    try {
      applyAction(c, a);
    } catch {
      continue;
    }
    scored.push({ a, v: evaluate(c, me) });
  }
  scored.sort((x, y) => y.v - x.v);
  const finalScore = (c: GameState) => (c.winner === null ? evaluate(c, me) - threatPenalty(c, me) : evaluate(c, me));
  let best: Action = { type: 'endTurn' };
  let bestV = finalScore(s) + 0.5;
  inLookahead = true;
  try {
    scored.slice(0, 6).forEach(({ a }, j) => {
      let total = 0;
      const samples = 2;
      for (let k = 0; k < samples; k++) {
        const c = clone(s, salt * 977 + j * 31 + k * 7);
        applyAction(c, a);
        for (let step = 0; step < 8 && c.winner === null && c.current === me && c.active; step++) {
          const b = greedyStep(c, me, salt + j * 13 + step * 3 + k);
          if (b.type === 'endTurn') break;
          applyAction(c, b);
        }
        total += finalScore(c);
      }
      const v = total / samples;
      if (v > bestV) {
        bestV = v;
        best = a;
      }
    });
  } finally {
    inLookahead = false;
  }
  return best;
}

/** Take the action that most improves the evaluation, or end the turn. */
function greedyStep(s: GameState, me: number, salt: number): Action {
  if (s.mustDiscard > 0) return bestDiscard(s);
  const base = evaluate(s, me);
  let best: Action = { type: 'endTurn' };
  let bestV = base + 0.5;
  let i = 0;
  for (const a of unitActions(s)) {
    let v = 0;
    const diff = effDiff(s, me);
    const samples = a.type === 'attack' || a.type === 'playCard' ? (diff === 'hard' ? 3 : diff === 'easy' ? 1 : 2) : 1;
    for (let k = 0; k < samples; k++) {
      const c = clone(s, salt * 131 + i++ * 17 + k);
      try {
        applyAction(c, a);
      } catch {
        v = -Infinity;
        break;
      }
      v += evaluate(c, me) / samples;
    }
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return best;
}

// Easy bots use their own little RNG for mistakes so the game's dice stream is untouched.
const mistakeRng = { rngState: 0x1234567 };
const chance = (p: number) => nextRandom(mistakeRng) < p;

/** True while a Hard bot plays out a plan on a copy (the copy's moves are Normal strength). */
let inLookahead = false;
const effDiff = (s: GameState, who: number) => (inLookahead ? 'normal' : s.players[who].difficulty);

function chooseUnit(s: GameState): Unit | null {
  const me = s.current;
  const diff = effDiff(s, me);
  const units = selectableUnits(s);
  if (!units.length) return null;
  // Easy: sometimes just grabs a random unit.
  if (diff === 'easy' && chance(0.35)) return units[Math.floor(nextRandom(mistakeRng) * units.length)];
  const rollouts = diff === 'hard' ? 2 : 1;
  let best: Unit | null = null;
  let bestV = -Infinity;
  units.forEach((u, i) => {
    let total = 0;
    for (let r = 0; r < rollouts; r++) {
      const c = clone(s, 1000 + i * 7 + r * 3331);
      applyAction(c, { type: 'selectUnit', unit: u });
      for (let step = 0; step < 12 && c.winner === null && c.current === me; step++) {
        const a = greedyStep(c, me, i * 31 + step + r * 977);
        if (a.type === 'endTurn') break;
        applyAction(c, a);
      }
      total += diff === 'hard' ? planScore(c, me) : evaluate(c, me);
    }
    let v = total / rollouts;
    if (diff === 'easy') v += (nextRandom(mistakeRng) - 0.5) * 240; // fuzzy judgement
    if (v > bestV) {
      bestV = v;
      best = u;
    }
  });
  return best;
}

/** Discard the card this player can least use. */
export function bestDiscard(s: GameState): Action {
  const me = s.players[s.current];
  const kinds = new Set(s.pieces.filter((p) => p.owner === me.index).map((p) => p.kind));
  const keep = (id: keyof typeof CARDS): number => {
    const def = CARDS[id];
    if (def.cls === 'conjuration') return 10 + def.cost * 2;
    const usable = [...kinds].some((k) => canClassBeUsedBy(def.cls, k));
    return (usable ? 12 : 0) + def.cost;
  };
  const card = [...me.hand].sort((a, b) => keep(a.id) - keep(b.id))[0];
  return { type: 'discard', cardUid: card.uid };
}

/** Play out the current player's whole turn with the bot. */
export function runBotTurn(s: GameState, apply: (a: Action) => void, maxActions = 60): void {
  const who = s.current;
  for (let i = 0; i < maxActions && s.winner === null && s.current === who; i++) apply(chooseBotAction(s));
  if (s.winner === null && s.current === who) {
    while (s.mustDiscard > 0) apply(bestDiscard(s));
    apply({ type: 'endTurn' });
  }
}

