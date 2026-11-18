import { CARDS, PIECES } from './config';
import { CENTER, legalActions, pieceAt, pieceById } from './engine';
import { hexDistance, type Hex } from './hex';
import { nextRandom } from './rng';
import type { Action, GameState, Target } from './types';

/**
 * A simple greedy bot. It is meant for sanity-checking rules and as a sparring partner,
 * not as a strong opponent. It picks one action at a time; call it until it returns endTurn.
 */
export function chooseBotAction(s: GameState): Action {
  const actions = legalActions(s);
  const me = s.current;
  let best: Action = { type: 'endTurn' };
  let bestScore = 0; // only act if score > 0
  for (const a of actions) {
    const score = scoreAction(s, a, me) + nextRandom({ rngState: hashAction(s, a) }) * 0.5;
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
  if (t.kind === 'base') return s.players[t.owner].baseHp;
  return 0;
}

function goalFor(s: GameState, me: number, pos: Hex): Hex {
  // Head for the centre; if an enemy already sits there, the centre is still the goal (we'll attack it).
  void s; void me; void pos;
  return CENTER;
}

function scoreAction(s: GameState, a: Action, me: number): number {
  switch (a.type) {
    case 'endTurn':
      return 0;
    case 'attack': {
      const p = pieceById(s, a.pieceId)!;
      const avg = (PIECES[p.kind].die + 1) / 2 + p.bonusDamage;
      const hp = targetHp(s, a.target);
      let score = 50 + avg * 2;
      if (avg >= hp) score += 30; // likely kill
      if (a.target.kind === 'piece') {
        const t = pieceById(s, a.target.id)!;
        if (hexDistance(t.pos, CENTER) === 0) score += 60; // knock them off the centre
      }
      if (a.target.kind === 'base') score += 10;
      return score;
    }
    case 'move': {
      const p = pieceById(s, a.pieceId)!;
      const goal = goalFor(s, me, p.pos);
      const before = hexDistance(p.pos, goal);
      const after = hexDistance(a.to, goal);
      if (after >= before) return 0;
      let score = 10 + (before - after) * 3;
      if (after === 0) score += 100;
      // Keep the base garrison home if enemies are near the base.
      return score;
    }
    case 'playCard': {
      const card = s.players[me].hand.find((c) => c.uid === a.cardUid)!;
      const def = CARDS[card.id];
      const t = a.target;
      switch (def.category) {
        case 'piece': {
          if (t?.kind !== 'hex') return 0;
          // Prefer summoning toward the centre; bigger pieces first.
          return 40 + def.cost * 4 - hexDistance(t.hex, CENTER);
        }
        default:
          break;
      }
      const piece = t?.kind === 'piece' ? pieceById(s, t.id) : undefined;
      switch (def.id) {
        case 'fireball': {
          const hp = t ? targetHp(s, t) : 99;
          let sc = 35 + (hp <= 5 ? 25 : 0);
          if (t?.kind === 'piece' && pieceAt(s, CENTER)?.id === t.id) sc += 60;
          return sc;
        }
        case 'heal':
          return piece && piece.maxHp - piece.hp >= 3 ? 30 : 0;
        case 'fortify':
          return s.players[me].baseHp <= 14 ? 30 : 0;
        case 'shield':
          return piece && hexDistance(piece.pos, CENTER) <= 2 ? 28 + piece.maxHp : 0;
        case 'sharpen':
        case 'frenzy':
          return piece && piece.attacksLeft > 0 && hasAdjacentEnemy(s, piece.pos, me) ? 32 : 0;
        case 'haste':
          return piece && piece.movesLeft > 0 && hexDistance(piece.pos, CENTER) > 1 ? 15 + piece.maxHp / 4 : 0;
        case 'promote':
          return 25;
        case 'rally':
          return s.players[me].hand.length <= 4 ? 20 : 0;
        case 'recall':
          return piece && piece.hp <= 2 ? 12 : 0;
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

/** Play out the current player's whole turn with the bot. Returns all events. */
export function runBotTurn(s: GameState, apply: (a: Action) => void, maxActions = 200): void {
  const who = s.current;
  for (let i = 0; i < maxActions && s.winner === null && s.current === who; i++) {
    apply(chooseBotAction(s));
  }
  if (s.winner === null && s.current === who) apply({ type: 'endTurn' });
}
