import { CARDS, PIECES, RULES, type CardId } from './config';
import { areaVictims, flagCarrier, flagHex, garrisonOf, legalActions, movePath, pieceById } from './engine';
import { hexDistance, hexEq, type Hex } from './hex';
import { nextRandom } from './rng';
import type { Action, GameState, Piece, Target } from './types';

/**
 * A simple greedy capture-the-flag bot. It is meant for sanity-checking rules and as a sparring
 * partner, not as a strong opponent. It picks one action at a time; call it until it returns endTurn.
 */
export function chooseBotAction(s: GameState): Action {
  const actions = legalActions(s);
  const me = s.current;
  let best: Action = { type: 'endTurn' };
  let bestScore = 0; // only act if score > 0
  for (const a of actions) {
    const base = scoreAction(s, a, me);
    if (base <= 0) continue;
    const score = base + nextRandom({ rngState: hashAction(s, a) }) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

// Deterministic jitter without consuming the game's RNG stream.
function hashAction(s: GameState, a: Action): number {
  return (s.nextId * 7919 + s.round * 104729 + JSON.stringify(a).length * 31 + s.log.length * 17) | 0;
}

function targetHp(s: GameState, t: Target): number {
  if (t.kind === 'piece') return pieceById(s, t.id)?.hp ?? 0;
  if (t.kind === 'base') {
    const pl = s.players[t.owner];
    return garrisonOf(s, pl)?.hp ?? pl.baseHp;
  }
  return 0;
}

const isEnemyCarrier = (s: GameState, id: number, me: number) => {
  const c = flagCarrier(s);
  return !!c && c.id === id && c.owner !== me;
};

/** Where a piece wants to go. */
function goalFor(s: GameState, p: Piece): Hex {
  const carrier = flagCarrier(s);
  if (carrier?.id === p.id) return s.players[p.owner].base;
  const flag = flagHex(s);
  if (flag && (!carrier || carrier.owner !== p.owner)) return flag; // chase the flag or its carrier
  // A friend carries it: intercept the enemy nearest to our carrier.
  const enemies = s.pieces.filter((x) => x.owner !== p.owner);
  if (!enemies.length || !carrier) return flag ?? p.pos;
  enemies.sort((a, b) => hexDistance(a.pos, carrier.pos) - hexDistance(b.pos, carrier.pos));
  return enemies[0].pos;
}

function scoreAction(s: GameState, a: Action, me: number): number {
  switch (a.type) {
    case 'endTurn':
    case 'discard':
      return 0;
    case 'attack': {
      const p = pieceById(s, a.pieceId)!;
      const avg = (PIECES[p.kind].die + 1) / 2 + p.bonusDamage;
      const hp = targetHp(s, a.target);
      let score = 50 + avg * 2;
      if (avg >= hp) score += 30; // likely kill
      if (a.target.kind === 'piece' && isEnemyCarrier(s, a.target.id, me)) score += 80;
      if (a.target.kind === 'base') score += 10;
      return score;
    }
    case 'move': {
      const p = pieceById(s, a.pieceId)!;
      const goal = goalFor(s, p);
      const before = hexDistance(p.pos, goal);
      const after = hexDistance(a.to, goal);
      const carrying = flagCarrier(s)?.id === p.id;
      const flag = s.flag.pos;
      if (flag && movePath(p.pos, a.to).some((h) => hexEq(h, flag))) return 300; // grab the flag
      if (carrying && hexEq(a.to, s.players[me].base)) return 1000; // win
      // Keep one piece home as a garrison (it soaks damage aimed at the base),
      // but step aside when our own flag carrier is coming home.
      if (!carrying && hexEq(p.pos, s.players[me].base)) {
        const c = flagCarrier(s);
        return c && c.owner === me && hexDistance(c.pos, p.pos) <= 4 ? 60 : 0;
      }
      if (after >= before) return 0;
      return 10 + (before - after) * (carrying ? 8 : 3);
    }
    case 'playCard': {
      const card = s.players[me].hand.find((c) => c.uid === a.cardUid)!;
      const def = CARDS[card.id];
      const t = a.target;
      if (def.category === 'piece') {
        if (t?.kind !== 'hex') return 0;
        const flag = flagHex(s) ?? t.hex;
        return 40 + def.cost * 4 - hexDistance(t.hex, flag) * 0.5;
      }
      const piece = t?.kind === 'piece' ? pieceById(s, t.id) : undefined;
      const carrying = !!piece && flagCarrier(s)?.id === piece.id;
      switch (def.id) {
        case 'fireball': {
          if (t?.kind !== 'hex') return 0;
          const { pieces, bases } = areaVictims(s, t.hex, def.radius!);
          const dmg = 28;
          let value = 0;
          for (const v of pieces) {
            const worth = Math.min(v.hp + v.shield, dmg) + (v.hp + v.shield <= dmg ? v.maxHp : 0);
            const carrierBonus = flagCarrier(s)?.id === v.id ? 60 : 0;
            value += v.owner === me ? -(worth + carrierBonus) * 1.5 : worth + carrierBonus;
          }
          for (const pl of bases) {
            if (garrisonOf(s, pl)) continue;
            value += pl.index === me ? -500 : pl.baseHp <= dmg ? 120 : 20;
          }
          return value > 30 ? 40 + value / 2 : 0;
        }
        case 'firebolt': {
          const hp = t ? targetHp(s, t) : 99;
          let sc = 35 + (hp <= 5 ? 25 : 0);
          if (t?.kind === 'piece' && isEnemyCarrier(s, t.id, me)) sc += 60;
          return sc;
        }
        case 'heal':
          return piece && piece.maxHp - piece.hp >= 3 ? 30 + (carrying ? 20 : 0) : 0;
        case 'fortify':
          return s.players[me].baseHp <= 14 ? 30 : 0;
        case 'shield':
          return piece && (carrying || hasAdjacentEnemy(s, piece.pos, me)) ? 28 + piece.maxHp : 0;
        case 'sharpen':
        case 'frenzy':
          return piece && piece.attacksLeft > 0 && hasAdjacentEnemy(s, piece.pos, me) ? 32 : 0;
        case 'haste':
          return piece && piece.movesLeft === 0 && piece.attacksLeft > 0 && hexDistance(piece.pos, goalFor(s, piece)) > 1
            ? 15 + (carrying ? 40 : piece.maxHp / 4)
            : 0;
        case 'promote':
          return 25;
        case 'rally':
          return s.players[me].hand.length <= 4 ? 20 : 0;
        case 'recall':
          return piece && piece.hp <= 2 && !carrying ? 12 : 0;
        default:
          return 0;
      }
    }
  }
}

function hasAdjacentEnemy(s: GameState, pos: Hex, me: number): boolean {
  return (
    s.pieces.some((p) => p.owner !== me && hexDistance(p.pos, pos) === 1) ||
    s.players.some((pl) => pl.alive && pl.index !== me && hexDistance(pl.base, pos) === 1)
  );
}

/** Before ending the turn, dump a card that can't be played if the hand is full (so draws aren't burned). */
export function botDiscard(s: GameState): Action | null {
  const me = s.players[s.current];
  if (me.hand.length < RULES.handLimit) return null;
  const pieceCount = s.pieces.filter((p) => p.owner === me.index).length;
  const junk = [...me.hand].sort((a, b) => junkScore(b.id, pieceCount) - junkScore(a.id, pieceCount))[0];
  return junk ? { type: 'discard', cardUid: junk.uid } : null;
}
function junkScore(id: CardId, pieceCount: number): number {
  const def = CARDS[id];
  if (def.category === 'piece') return 0;
  if (def.targeting !== 'none' && def.targeting !== 'summonHex' && pieceCount === 0) return 10;
  return 5 - def.cost;
}

/** Play out the current player's whole turn with the bot. */
export function runBotTurn(s: GameState, apply: (a: Action) => void, maxActions = 200): void {
  const who = s.current;
  for (let i = 0; i < maxActions && s.winner === null && s.current === who; i++) {
    let a = chooseBotAction(s);
    if (a.type === 'endTurn') a = botDiscard(s) ?? a;
    apply(a);
  }
  if (s.winner === null && s.current === who) apply({ type: 'endTurn' });
}
