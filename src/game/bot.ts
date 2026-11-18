import { ARMORS, CARDS, PIECES, RULES, canClassBeUsedBy, type PieceKind } from './config';
import { applyAction, flagCarrier, flagHex, legalActions, selectableUnits, summonHexes } from './engine';
import { DIAGONALS, DIRECTIONS, KNIGHT_JUMPS, hex, hexDistance, hexEq, inBoard, type Hex } from './hex';
import type { Action, GameState, Unit } from './types';

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

/** Score a position from player `me`'s point of view. */
export function evaluate(s: GameState, me: number): number {
  if (s.winner !== null) return s.winner === me ? 1e6 : -1e6;
  const meP = s.players[me];
  if (!meP.alive) return -1e6;
  const enemies = s.players.filter((p) => p.alive && p.index !== me);
  const share = 1 / Math.max(1, enemies.length);
  let v = 0;

  // Flag race
  const carrier = flagCarrier(s);
  if (carrier) {
    const home = s.players[carrier.owner].base;
    const d = turnsTo(carrier.kind, carrier.pos, home) * 1.5;
    const val = 400 + (20 - d) * 35;
    v += carrier.owner === me ? val : -val;
    if (carrier.owner === me) {
      // carriers want escorts and fear nearby enemies
      const threats = s.pieces.filter((p) => p.owner !== me && hexDistance(p.pos, carrier.pos) <= 3).length;
      v -= threats * 25;
      // Clear the way home: our own pieces on the base hex block the carrier.
      const blocker = s.pieces.find((p) => p.owner === me && p.id !== carrier.id && hexEq(p.pos, home));
      // (Constant while we carry, so it never discourages the carrier from approaching.)
      if (blocker) v -= 150;
      v -= s.pieces.filter((p) => p.owner === me && p.id !== carrier.id && hexDistance(p.pos, home) === 1).length * 40;
    } else {
      // chase the enemy carrier
      const mine = s.pieces.filter((p) => p.owner === me);
      if (mine.length) v -= Math.min(...mine.map((p) => hexDistance(p.pos, carrier.pos) / 2)) * 20;
    }
  } else {
    const f = flagHex(s)!;
    const turns = (owner: number) => {
      const ps = s.pieces.filter((p) => p.owner === owner);
      return ps.length ? Math.min(...ps.map((p) => turnsTo(p.kind, p.pos, f))) : 15;
    };
    const mine = turns(me);
    // Nudge the whole army forward a little.
    for (const p of s.pieces) if (p.owner === me) v -= Math.min(turnsTo(p.kind, p.pos, f), 8) * 2;
    const theirs = Math.min(...enemies.map((e) => turns(e.index)), 15);
    v += (theirs - mine) * 30 - mine * 10;
  }

  // Material
  for (const p of s.pieces) {
    const w = WORTH[p.kind] + p.hp * 2 + p.shield + p.bonusDamage + (p.armor ? (ARMORS[p.armor].pool ? (p.armorPool ?? 0) : (ARMORS[p.armor].reduce ?? 0) * 3) : 0);
    v += p.owner === me ? w : -w * share;
  }
  // Bases
  v += meP.baseHp * 5;
  const garrison = s.pieces.find((p) => p.owner === me && hexEq(p.pos, meP.base));
  if (garrison) v += 15;
  for (const e of enemies) v -= e.baseHp * 2 * share;
  v += (s.players.length - 1 - enemies.length) * 150;
  // Keep a summoning hex free so the base stays useful.
  if (!summonHexes(s, me).length) v -= 30;
  // Cards in hand are options
  v += meP.hand.length * 3;
  return v;
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

/** Take the action that most improves the evaluation, or end the turn. */
function greedyStep(s: GameState, me: number, salt: number): Action {
  if (s.mustDiscard > 0) return bestDiscard(s);
  const base = evaluate(s, me);
  let best: Action = { type: 'endTurn' };
  let bestV = base + 0.5;
  let i = 0;
  for (const a of unitActions(s)) {
    let v = 0;
    const samples = a.type === 'attack' || a.type === 'playCard' ? 2 : 1;
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

function chooseUnit(s: GameState): Unit | null {
  const me = s.current;
  let best: Unit | null = null;
  let bestV = -Infinity;
  selectableUnits(s).forEach((u, i) => {
    const c = clone(s, 1000 + i);
    applyAction(c, { type: 'selectUnit', unit: u });
    for (let step = 0; step < 12 && c.winner === null && c.current === me; step++) {
      const a = greedyStep(c, me, i * 31 + step);
      if (a.type === 'endTurn') break;
      applyAction(c, a);
    }
    const v = evaluate(c, me);
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

