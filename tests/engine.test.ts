import { describe, expect, it } from 'vitest';
import { CARDS, PIECES, RULES } from '../src/game/config';
import {
  CENTER, applyAction, canPlayCard, legalAttacks, legalMoves, newGame, pieceAt, summonHexes,
} from '../src/game/engine';
import { corners, hex, hexDistance, hexEq } from '../src/game/hex';
import type { GameState, Piece } from '../src/game/types';

const setup = (n: number, seed = 42) => newGame(Array.from({ length: n }, () => ({})), seed).state;

function place(s: GameState, owner: number, kind: Piece['kind'], q: number, r: number): Piece {
  const p: Piece = {
    id: s.nextId++, owner, kind, pos: hex(q, r), hp: PIECES[kind].hp, maxHp: PIECES[kind].hp,
    movesLeft: 1, attacksLeft: 1, shield: 0, bonusDamage: 0,
  };
  s.pieces.push(p);
  return p;
}

describe('setup', () => {
  it.each([2, 3, 4, 5, 6])('%i players start in distinct corners with a base and one pawn on it', (n) => {
    const s = setup(n);
    expect(s.players).toHaveLength(n);
    const cs = corners(RULES.boardRadius);
    const used = new Set<number>();
    for (const p of s.players) {
      expect(hexEq(p.base, cs[p.corner])).toBe(true);
      expect(hexDistance(p.base, CENTER)).toBe(10);
      expect(p.baseHp).toBe(RULES.baseHp);
      used.add(p.corner);
      const pawns = s.pieces.filter((x) => x.owner === p.index);
      expect(pawns).toHaveLength(1);
      expect(pawns[0].kind).toBe('pawn');
      expect(pawns[0].hp).toBe(4);
      expect(hexEq(pawns[0].pos, p.base)).toBe(true);
    }
    expect(used.size).toBe(n);
  });

  it('rejects 1 or 7 players', () => {
    expect(() => setup(1)).toThrow();
    expect(() => setup(7)).toThrow();
  });
});

describe('drawing', () => {
  it('draws 7 on your first turn, then 1 per turn', () => {
    const s = setup(3);
    expect(s.players[0].hand).toHaveLength(7);
    expect(s.players[1].hand).toHaveLength(0);
    applyAction(s, { type: 'endTurn' });
    expect(s.players[1].hand).toHaveLength(7);
    applyAction(s, { type: 'endTurn' });
    applyAction(s, { type: 'endTurn' });
    expect(s.players[0].hand).toHaveLength(8);
    expect(s.round).toBe(2);
  });

  it('burns draws past the hand limit', () => {
    const s = setup(2);
    for (let i = 0; i < 2 * (RULES.handLimit - RULES.openingHand + 3); i++) applyAction(s, { type: 'endTurn' });
    expect(s.players[0].hand.length).toBe(RULES.handLimit);
    expect(s.players[0].discard.length).toBeGreaterThan(0);
  });
});

describe('movement', () => {
  it('pawn moves exactly 1 hex in any direction', () => {
    const s = setup(2);
    s.pieces = [];
    const p = place(s, 0, 'pawn', 0, 0);
    const moves = legalMoves(s, p);
    expect(moves).toHaveLength(6);
    for (const m of moves) expect(hexDistance(m, p.pos)).toBe(1);
  });

  it('pawn in its corner base has 3 moves', () => {
    const s = setup(2);
    const pawn = s.pieces.find((p) => p.owner === 0)!;
    expect(legalMoves(s, pawn)).toHaveLength(3);
  });

  it('rook slides up to 3 and is blocked by pieces', () => {
    const s = setup(2);
    s.pieces = [];
    const r = place(s, 0, 'rook', 0, 0);
    expect(legalMoves(s, r)).toHaveLength(18);
    place(s, 1, 'pawn', 2, 0);
    expect(legalMoves(s, r)).toHaveLength(16); // (1,0) still OK, (2,0) and (3,0) blocked
  });

  it('knight jumps over blockers', () => {
    const s = setup(2);
    s.pieces = [];
    const k = place(s, 0, 'knight', 0, 0);
    for (const d of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) place(s, 1, 'pawn', d[0], d[1]);
    expect(legalMoves(s, k)).toHaveLength(12);
  });

  it('cannot move onto an enemy base', () => {
    const s = setup(2);
    s.pieces = [];
    const enemyBase = s.players[1].base;
    const p = place(s, 0, 'pawn', enemyBase.q + 1, enemyBase.r - 1);
    expect(hexDistance(p.pos, enemyBase)).toBe(1);
    expect(legalMoves(s, p).some((h) => hexEq(h, enemyBase))).toBe(false);
  });

  it('a piece moves once per turn', () => {
    const s = setup(2);
    const pawn = s.pieces.find((p) => p.owner === 0)!;
    applyAction(s, { type: 'move', pieceId: pawn.id, to: legalMoves(s, pawn)[0] });
    expect(legalMoves(s, pawn)).toHaveLength(0);
  });
});

describe('combat', () => {
  it('pawn deals 1-4 damage and attacking ends movement', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = setup(2, seed);
      s.pieces = [];
      const a = place(s, 0, 'pawn', 0, 0);
      const b = place(s, 1, 'rook', 1, 0);
      const events = applyAction(s, { type: 'attack', pieceId: a.id, target: { kind: 'piece', id: b.id } });
      const roll = events.find((e) => e.type === 'roll');
      expect(roll && roll.type === 'roll' && roll.dice).toEqual([4]);
      const dmg = 10 - b.hp;
      expect(dmg).toBeGreaterThanOrEqual(1);
      expect(dmg).toBeLessThanOrEqual(4);
      expect(a.movesLeft).toBe(0);
      expect(legalAttacks(s, a)).toHaveLength(0);
    }
  });

  it('pieces die at 0 HP and shields absorb', () => {
    const s = setup(2);
    s.pieces = [];
    const a = place(s, 0, 'king', 0, 0);
    const b = place(s, 1, 'pawn', 1, 0);
    b.hp = 1;
    applyAction(s, { type: 'attack', pieceId: a.id, target: { kind: 'piece', id: b.id } });
    expect(pieceAt(s, hex(1, 0))).toBeUndefined();
  });

  it('only adjacent enemies can be attacked', () => {
    const s = setup(2);
    s.pieces = [];
    const a = place(s, 0, 'queen', 0, 0);
    place(s, 1, 'pawn', 2, 0);
    expect(legalAttacks(s, a)).toHaveLength(0);
  });

  it('a garrisoned base cannot be attacked; destroying a base eliminates its owner', () => {
    const s = setup(2);
    const base = s.players[1].base;
    s.pieces = s.pieces.filter((p) => p.owner === 1);
    const atk = place(s, 0, 'king', base.q + 1, base.r - 1);
    expect(legalAttacks(s, atk).some((t) => t.kind === 'base')).toBe(false);
    s.pieces = s.pieces.filter((p) => p.owner === 0);
    expect(legalAttacks(s, atk).some((t) => t.kind === 'base')).toBe(true);
    s.players[1].baseHp = 1;
    applyAction(s, { type: 'attack', pieceId: atk.id, target: { kind: 'base', owner: 1 } });
    expect(s.players[1].alive).toBe(false);
    expect(s.winner).toBe(0);
  });
});

describe('cards and winning', () => {
  it('summoning costs energy and places a sick piece next to base', () => {
    const s = setup(2);
    const me = s.players[0];
    me.hand = [{ uid: 9999, id: 'summon_knight' }];
    me.energy = 2;
    expect(canPlayCard(s, 0, me.hand[0])).toBe(true);
    const spot = summonHexes(s, 0)[0];
    applyAction(s, { type: 'playCard', cardUid: 9999, target: { kind: 'hex', hex: spot } });
    expect(me.energy).toBe(0);
    const k = pieceAt(s, spot)!;
    expect(k.kind).toBe('knight');
    expect(legalMoves(s, k)).toHaveLength(0);
    expect(CARDS.summon_knight.cost).toBe(2);
  });

  it('holding the centre for a round wins', () => {
    const s = setup(2);
    s.pieces = [];
    const p = place(s, 0, 'pawn', 1, 0);
    applyAction(s, { type: 'move', pieceId: p.id, to: CENTER });
    expect(s.winner).toBe(null);
    applyAction(s, { type: 'endTurn' });
    applyAction(s, { type: 'endTurn' });
    expect(s.winner).toBe(0);
  });
});
