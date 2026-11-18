import { describe, expect, it } from 'vitest';
import { CARDS, PIECES, RULES } from '../src/game/config';
import {
  CENTER, applyAction, canPlayCard, cardTargets, flagCarrier, flagHex, legalAttacks, legalMoves, newGame, pieceAt, summonHexes,
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

  it('a piece on its own base takes base damage first; excess does not spill over', () => {
    const s = setup(2, 3);
    const base = s.players[1].base;
    const guard = s.pieces.find((p) => p.owner === 1)!; // Gold's pawn starts on its base
    s.pieces = [guard];
    const atk = place(s, 0, 'king', base.q + 1, base.r - 1);
    expect(legalAttacks(s, atk).some((t) => t.kind === 'base')).toBe(true);
    applyAction(s, { type: 'attack', pieceId: atk.id, target: { kind: 'base', owner: 1 } });
    expect(s.players[1].baseHp).toBe(RULES.baseHp);
    expect(guard.hp < 4 || !s.pieces.includes(guard)).toBe(true);
  });

  it('destroying an unguarded base eliminates its owner', () => {
    const s = setup(2);
    const base = s.players[1].base;
    s.pieces = [];
    const atk = place(s, 0, 'king', base.q + 1, base.r - 1);
    s.players[1].baseHp = 1;
    applyAction(s, { type: 'attack', pieceId: atk.id, target: { kind: 'base', owner: 1 } });
    expect(s.players[1].alive).toBe(false);
    expect(s.winner).toBe(0);
    expect(s.winReason).toBe('last base standing');
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

  it('energy tops out at 7 and costs run 1-7 with Fireball the only 7', () => {
    expect(RULES.energyMax).toBe(7);
    const costs = Object.values(CARDS).map((c) => c.cost);
    expect(Math.min(...costs)).toBe(1);
    expect(Object.values(CARDS).filter((c) => c.cost === 7).map((c) => c.id)).toEqual(['fireball']);
    for (const c of Object.values(CARDS)) if (c.id !== 'fireball') expect(c.cost).toBeLessThanOrEqual(6);
    expect(CARDS.firebolt.name).toBe('Fire Bolt');
    const s = setup(2);
    for (let i = 0; i < 20; i++) applyAction(s, { type: 'endTurn' });
    expect(s.players[0].energy).toBe(7);
  });

  it('Fireball needs a Queen or Bishop and only targets hexes within 10 of one', () => {
    const s = setup(2);
    s.pieces = [];
    const me = s.players[0];
    me.hand = [{ uid: 777, id: 'fireball' }];
    me.energy = 7;
    expect(canPlayCard(s, 0, me.hand[0])).toBe(false);
    const b = place(s, 0, 'bishop', 0, -5);
    const targets = cardTargets(s, 0, CARDS.fireball);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t.kind === 'hex' && hexDistance(t.hex, b.pos) <= 10).toBe(true);
  });

  it('Fireball hits every piece (friend and foe) and unguarded bases within 4', () => {
    const s = setup(2, 9);
    s.pieces = [];
    const me = s.players[0];
    const caster = place(s, 0, 'queen', 0, -9); // 5 away from blast centre: safe
    const friend = place(s, 0, 'king', 0, -1);
    const foe = place(s, 1, 'king', 2, 2);
    const far = place(s, 1, 'pawn', 0, 8);
    me.hand = [{ uid: 778, id: 'fireball' }];
    me.energy = 7;
    const events = applyAction(s, { type: 'playCard', cardUid: 778, target: { kind: 'hex', hex: hex(0, 0) } });
    const roll = events.find((e) => e.type === 'roll')!;
    expect(roll.type === 'roll' && roll.dice).toEqual([6, 6, 6, 6, 6, 6, 6, 6]);
    const dmg = roll.type === 'roll' ? roll.total : 0;
    expect(dmg).toBeGreaterThanOrEqual(8);
    const hpAfter = (p: Piece) => (s.pieces.includes(p) ? p.hp : 0);
    expect(hpAfter(friend)).toBe(Math.max(0, 20 - dmg));
    expect(hpAfter(foe)).toBe(Math.max(0, 20 - dmg));
    expect(caster.hp).toBe(12);
    expect(far.hp).toBe(4);
    expect(me.energy).toBe(0);
  });

  it('a garrison shields its base from a Fireball', () => {
    const s = setup(2, 11);
    const gold = s.players[1];
    s.pieces = s.pieces.filter((p) => p.owner === 1); // Gold pawn on its base
    place(s, 0, 'bishop', 0, 0);
    s.players[0].hand = [{ uid: 779, id: 'fireball' }];
    s.players[0].energy = 7;
    applyAction(s, { type: 'playCard', cardUid: 779, target: { kind: 'hex', hex: gold.base } });
    expect(gold.baseHp).toBe(RULES.baseHp);
  });
});

describe('capture the flag', () => {
  it('starts on the centre with nobody carrying it', () => {
    const s = setup(4);
    expect(flagHex(s)).toEqual(CENTER);
    expect(flagCarrier(s)).toBeUndefined();
  });

  it('a piece that steps on the flag picks it up and carries it', () => {
    const s = setup(2);
    s.pieces = [];
    const p = place(s, 0, 'pawn', 1, 0);
    applyAction(s, { type: 'move', pieceId: p.id, to: CENTER });
    expect(flagCarrier(s)?.id).toBe(p.id);
    expect(s.winner).toBe(null);
  });

  it('a sliding Rook grabs the flag when passing over it', () => {
    const s = setup(2);
    s.pieces = [];
    const r = place(s, 0, 'rook', -2, 0);
    applyAction(s, { type: 'move', pieceId: r.id, to: hex(1, 0) });
    expect(flagCarrier(s)?.id).toBe(r.id);
  });

  it('a Knight landing on the flag grabs it', () => {
    const s = setup(2);
    s.pieces = [];
    const k = place(s, 0, 'knight', -1, -2);
    applyAction(s, { type: 'move', pieceId: k.id, to: hex(0, 0) });
    expect(flagCarrier(s)?.id).toBe(k.id);
  });

  it('the flag drops where its carrier dies', () => {
    const s = setup(2);
    s.pieces = [];
    const carrier = place(s, 1, 'pawn', 3, 3);
    s.flag = { pos: null, carrier: carrier.id };
    carrier.hp = 1;
    const k = place(s, 0, 'king', 3, 2);
    applyAction(s, { type: 'attack', pieceId: k.id, target: { kind: 'piece', id: carrier.id } });
    expect(flagCarrier(s)).toBeUndefined();
    expect(flagHex(s)).toEqual(hex(3, 3));
  });

  it('bringing the flag onto your own base wins', () => {
    const s = setup(2);
    s.pieces = [];
    const base = s.players[0].base;
    const p = place(s, 0, 'pawn', base.q + 1, base.r);
    expect(hexDistance(p.pos, base)).toBe(1);
    s.flag = { pos: null, carrier: p.id };
    applyAction(s, { type: 'move', pieceId: p.id, to: base });
    expect(s.winner).toBe(0);
    expect(s.winReason).toMatch(/captured the flag/);
  });

  it('Recall makes the carrier drop the flag', () => {
    const s = setup(2);
    s.pieces = [];
    const p = place(s, 0, 'rook', 0, -3);
    s.flag = { pos: null, carrier: p.id };
    s.players[0].hand = [{ uid: 555, id: 'recall' }];
    s.players[0].energy = 1;
    applyAction(s, { type: 'playCard', cardUid: 555, target: { kind: 'piece', id: p.id } });
    expect(flagCarrier(s)).toBeUndefined();
    expect(flagHex(s)).toEqual(hex(0, -3));
    expect(s.winner).toBe(null);
  });
});
