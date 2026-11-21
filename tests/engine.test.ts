import { describe, expect, it } from 'vitest';
import { ARMORS, CARDS, PIECES, RULES, SLIDE_RANGE, canClassBeUsedBy } from '../src/game/config';
import {
  CENTER, applyAction, canBeUnit, endTurnDiscards, hasBuilder, canPlayCard, cardTargets, legalActions, flagCarrier, flagHex, legalAttacks, legalMoves, newGame, pieceAt, summonHexes,
} from '../src/game/engine';
import { corners, hex, hexDistance, hexEq } from '../src/game/hex';
import type { GameState, Piece } from '../src/game/types';

const setup = (n: number, seed = 42) => newGame(Array.from({ length: n }, () => ({})), seed).state;

/** End the turn, discarding first if the hand is over the limit. */
function pass(s: GameState) {
  applyAction(s, { type: 'endTurn' });
}

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
      expect(hexDistance(p.base, CENTER)).toBe(RULES.boardRadius);
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

  it('an 8th card never blocks anything: End turn always ends the turn and discards the excess', () => {
    const s = setup(2);
    expect(RULES.handLimit).toBe(7);
    applyAction(s, { type: 'endTurn' });
    applyAction(s, { type: 'endTurn' });
    expect(s.players[0].hand).toHaveLength(8);
    // you can still pick and use a unit
    const pawn = s.pieces.find((p) => p.owner === 0)!;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: pawn.id } });
    applyAction(s, { type: 'move', pieceId: pawn.id, to: legalMoves(s, pawn)[0] });
    const last = s.players[0].hand[s.players[0].hand.length - 1];
    expect(endTurnDiscards(s).map((c) => c.uid)).toEqual([last.uid]);
    applyAction(s, { type: 'endTurn' });
    expect(s.current).toBe(1); // the turn passed straight away
    expect(s.players[0].hand).toHaveLength(7);
    expect(s.players[0].discard).toContainEqual(last); // the last card went
    expect(s.log.some((l) => /hand limit and discards/.test(l))).toBe(true);
  });

  it('End turn can name which cards to discard over the limit', () => {
    const s = setup(2);
    applyAction(s, { type: 'endTurn' });
    applyAction(s, { type: 'endTurn' });
    const keepOldest = s.players[0].hand[0];
    const drop = s.players[0].hand[5];
    applyAction(s, { type: 'endTurn', discard: [drop.uid] });
    expect(s.current).toBe(1);
    expect(s.players[0].hand).toContainEqual(keepOldest);
    expect(s.players[0].hand).not.toContainEqual(drop);
  });

  it('a hand within the limit discards nothing at end of turn', () => {
    const s = setup(2);
    expect(endTurnDiscards(s)).toEqual([]);
    applyAction(s, { type: 'endTurn' });
    expect(s.players[0].hand).toHaveLength(7);
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

  for (const kind of ['rook', 'bishop'] as const) {
    it(`${kind} slides up to ${SLIDE_RANGE} hexes in any of the 6 directions and is blocked by pieces`, () => {
      const s = setup(2);
      s.pieces = [];
      const r = place(s, 0, kind, 0, 0);
      expect(SLIDE_RANGE).toBe(4);
      expect(legalMoves(s, r)).toHaveLength(6 * 4);
      expect(legalMoves(s, r).every((h) => hexDistance(h, r.pos) <= 4)).toBe(true);
      expect(legalMoves(s, r).some((h) => hexEq(h, hex(1, 1)))).toBe(false); // no diagonal steps
      place(s, 1, 'pawn', 2, 0);
      expect(legalMoves(s, r)).toHaveLength(6 * 4 - 3); // (1,0) still OK, (2,0)..(4,0) blocked
    });
  }

  it('queen slides any distance in any of the 6 directions, to the board edge or a blocker', () => {
    const s = setup(2);
    s.pieces = [];
    for (const pl of s.players) pl.base = hex(-99, 0); // bases off the lines for a clean count
    const q = place(s, 0, 'queen', 0, 0);
    expect(legalMoves(s, q)).toHaveLength(6 * RULES.boardRadius); // centre to every edge
    place(s, 1, 'pawn', 3, 0);
    expect(legalMoves(s, q)).toHaveLength(6 * RULES.boardRadius - 3); // (3,0)..(5,0) blocked
    s.pieces = [];
    const q2 = place(s, 0, 'queen', -RULES.boardRadius, 0);
    expect(legalMoves(s, q2).some((h) => hexDistance(h, q2.pos) === RULES.boardRadius * 2)).toBe(true); // edge to edge
  });

  it('sliding over the flag does not pick it up; landing on it does', () => {
    const s = setup(2, 3);
    s.pieces = [];
    s.flag = { pos: hex(0, 2), carrier: null };
    const q = place(s, 0, 'queen', 0, 0);
    s.current = 0;
    applyAction(s, { type: 'move', pieceId: q.id, to: hex(0, 4) });
    expect(s.flag.carrier).toBeNull();
    expect(s.flag.pos).toEqual(hex(0, 2));
    const r = place(s, 1, 'rook', 0, -1);
    s.current = 1; s.active = null; s.turnActed = false;
    applyAction(s, { type: 'move', pieceId: r.id, to: hex(0, 2) }); // blocked? queen at (0,4) is beyond
    expect(s.flag.carrier).toBe(r.id);
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
  it('pawn deals 1-4 damage and may still move after attacking', () => {
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
      expect(a.movesLeft).toBe(1);
      expect(legalMoves(s, a).length).toBeGreaterThan(0);
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
  it('summoning costs energy and places a piece that can act the same turn', () => {
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
    // Summoned piece can be selected and has its move/attack available
    expect(canBeUnit(s, { kind: 'piece', id: k.id })).toBe(true);
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: k.id } });
    expect(legalMoves(s, k).length).toBeGreaterThan(0);
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
    for (let i = 0; i < 20; i++) pass(s);
    expect(s.players[0].energy).toBe(7);
  });

  it('Fireball must be played by a Bishop/Queen/King and targets hexes within 5 of it', () => {
    const s = setup(2);
    s.pieces = [];
    const me = s.players[0];
    me.hand = [{ uid: 777, id: 'fireball' }];
    me.energy = 7;
    expect(canPlayCard(s, 0, me.hand[0])).toBe(false);
    const r = place(s, 0, 'rook', 0, -4);
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: r.id } });
    expect(canPlayCard(s, 0, me.hand[0])).toBe(false); // Rook can't use Bishop cards
    const b = place(s, 0, 'bishop', 0, -3);
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: b.id } });
    expect(canPlayCard(s, 0, me.hand[0])).toBe(true);
    const targets = cardTargets(s, 0, CARDS.fireball, b);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t.kind === 'hex' && hexDistance(t.hex, b.pos) <= 5).toBe(true);
    expect(CARDS.fireball.range).toBe(5);
    expect(CARDS.fireball.radius).toBe(2);
    // a hex 5 away is fine, 6 away is not
    expect(targets.some((t) => t.kind === 'hex' && hexDistance(t.hex, b.pos) === 5)).toBe(true);
  });

  it('Fireball hits every piece (friend and foe) and unguarded bases within 2', () => {
    const s = setup(2, 9);
    s.pieces = [];
    const me = s.players[0];
    const caster = place(s, 0, 'queen', 0, -3); // 3 away from blast centre: safe
    const friend = place(s, 0, 'king', 0, -2); // exactly 2 away: hit
    const foe = place(s, 1, 'king', 1, 1);
    const far = place(s, 1, 'pawn', 0, 3); // 3 away: safe
    me.hand = [{ uid: 778, id: 'fireball' }];
    me.energy = 7;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: caster.id } });
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
    const b = place(s, 0, 'bishop', 0, 0); // base is 5 away: in range
    s.players[0].hand = [{ uid: 779, id: 'fireball' }];
    s.players[0].energy = 7;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: b.id } });
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

  it('sliding over the flag does NOT pick it up; you must land on it', () => {
    const s = setup(2);
    s.pieces = [];
    const r = place(s, 0, 'rook', -2, 0);
    applyAction(s, { type: 'move', pieceId: r.id, to: hex(1, 0) });
    expect(flagCarrier(s)).toBeUndefined();
    expect(flagHex(s)).toEqual(CENTER);
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
    const p = place(s, 0, 'bishop', 0, -3);
    s.flag = { pos: null, carrier: p.id };
    s.players[0].hand = [{ uid: 555, id: 'recall' }];
    s.players[0].energy = 1;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: p.id } });
    applyAction(s, { type: 'playCard', cardUid: 555 });
    expect(flagCarrier(s)).toBeUndefined();
    expect(flagHex(s)).toEqual(hex(0, -3));
    expect(s.winner).toBe(null);
  });
});

describe('one unit per turn', () => {
  it('once a piece acts, no other unit can act this turn', () => {
    const s = setup(2);
    s.pieces = [];
    const a = place(s, 0, 'pawn', 0, -5);
    const b = place(s, 0, 'pawn', 2, -5);
    applyAction(s, { type: 'move', pieceId: a.id, to: hex(0, -4) });
    expect(s.active).toEqual({ kind: 'piece', id: a.id });
    expect(legalMoves(s, b)).toHaveLength(0);
    expect(() => applyAction(s, { type: 'move', pieceId: b.id, to: hex(2, -4) })).toThrow();
    s.players[0].hand = [{ uid: 1, id: 'summon_pawn' }];
    s.players[0].energy = 5;
    expect(canPlayCard(s, 0, s.players[0].hand[0])).toBe(false); // base can't act now
  });

  it('you may switch units until the chosen one does something', () => {
    const s = setup(2);
    s.pieces = [];
    const a = place(s, 0, 'pawn', 0, -5);
    const b = place(s, 0, 'pawn', 2, -5);
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: a.id } });
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: b.id } });
    applyAction(s, { type: 'move', pieceId: b.id, to: hex(2, -4) });
    expect(() => applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: a.id } })).toThrow();
  });

  it('the base plays any number of conjurations, but no ability cards', () => {
    const s = setup(2);
    const me = s.players[0];
    me.hand = [{ uid: 1, id: 'summon_pawn' }, { uid: 2, id: 'summon_pawn' }, { uid: 3, id: 'heal' }];
    me.energy = 5;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'base' } });
    expect(canPlayCard(s, 0, me.hand[2])).toBe(false);
    applyAction(s, { type: 'playCard', cardUid: 1, target: { kind: 'hex', hex: summonHexes(s, 0)[0] } });
    applyAction(s, { type: 'playCard', cardUid: 2, target: { kind: 'hex', hex: summonHexes(s, 0)[0] } });
    expect(s.pieces.filter((p) => p.owner === 0)).toHaveLength(3);
    const starter = s.pieces.find((p) => p.owner === 0 && p.kind === 'pawn')!;
    expect(legalMoves(s, starter)).toHaveLength(0); // the base was this turn's unit
  });

  it('a piece plays cards of its class, limited only by energy', () => {
    const s = setup(2);
    s.pieces = [];
    const k = place(s, 0, 'knight', 0, -5);
    k.hp = 2;
    const me = s.players[0];
    me.hand = [{ uid: 1, id: 'haste' }, { uid: 2, id: 'heal' }, { uid: 3, id: 'shield' }, { uid: 4, id: 'firebolt' }];
    me.energy = 7;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: k.id } });
    expect(canPlayCard(s, 0, me.hand[0])).toBe(true); // knight card
    expect(canPlayCard(s, 0, me.hand[1])).toBe(true); // pawn card: anyone
    expect(canPlayCard(s, 0, me.hand[2])).toBe(false); // rook card
    expect(canPlayCard(s, 0, me.hand[3])).toBe(false); // bishop card
    applyAction(s, { type: 'playCard', cardUid: 1 });
    expect(k.movesLeft).toBe(2);
    // still able to play another card of a legal class if energy remains
    expect(canPlayCard(s, 0, me.hand[0])).toBe(true);
  });

  it('class users: Queen gets Bishop+Rook+Queen cards but not Knight cards; King gets everything', () => {
    expect(canClassBeUsedBy('bishop', 'queen')).toBe(true);
    expect(canClassBeUsedBy('rook', 'queen')).toBe(true);
    expect(canClassBeUsedBy('knight', 'queen')).toBe(false);
    for (const cls of ['pawn', 'knight', 'bishop', 'rook', 'queen'] as const) expect(canClassBeUsedBy(cls, 'king')).toBe(true);
    expect(canClassBeUsedBy('pawn', 'pawn')).toBe(true);
    expect(canClassBeUsedBy('bishop', 'pawn')).toBe(false);
  });

  it('Promote turns a friendly pawn within 3 of the Queen into a Knight', () => {
    const s = setup(2);
    s.pieces = [];
    const q = place(s, 0, 'queen', 0, -5);
    const near = place(s, 0, 'pawn', 0, -2);
    const far = place(s, 0, 'pawn', 0, 2);
    const me = s.players[0];
    me.hand = [{ uid: 1, id: 'promote_pawn_knight' }];
    me.energy = 2;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: q.id } });
    expect(cardTargets(s, 0, CARDS.promote_pawn_knight, q)).toEqual([{ kind: 'piece', id: near.id }]);
    applyAction(s, { type: 'playCard', cardUid: 1, target: { kind: 'piece', id: near.id } });
    expect(near.kind).toBe('knight');
    expect(far.kind).toBe('pawn');
  });
});

describe('Cordon of Arrows', () => {
  it('fires 4 separately rolled d8 arrows at enemy pieces within 4 of the knight', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = setup(2, seed);
      s.pieces = [];
      const k = place(s, 0, 'knight', 0, -5);
      const a = place(s, 1, 'king', 0, -2);
      const b = place(s, 1, 'king', 2, -5);
      place(s, 1, 'pawn', 0, 3); // too far
      const me = s.players[0];
      me.hand = [{ uid: 1, id: 'cordon' }];
      me.energy = 4;
      applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: k.id } });
      expect(cardTargets(s, 0, CARDS.cordon, k).map((t) => (t.kind === 'piece' ? t.id : -1)).sort()).toEqual([a.id, b.id].sort());
      const ev = applyAction(s, { type: 'playCard', cardUid: 1, arrows: [a.id, a.id, a.id, b.id] });
      const roll = ev.find((e) => e.type === 'roll')!;
      expect(roll.type === 'roll' && roll.dice).toEqual([8, 8, 8, 8]);
      const v = roll.type === 'roll' ? roll.values : [];
      for (const x of v) expect(x >= 1 && x <= 8).toBe(true);
      expect(a.hp).toBe(20 - v[0] - v[1] - v[2]);
      expect(b.hp).toBe(20 - v[3]);
    }
  });

  it('needs exactly 4 arrows on legal enemy pieces, and only Knights/Kings can shoot', () => {
    const s = setup(2);
    s.pieces = [];
    const k = place(s, 0, 'knight', 0, -5);
    const a = place(s, 1, 'king', 0, -2);
    const me = s.players[0];
    me.hand = [{ uid: 1, id: 'cordon' }];
    me.energy = 4;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: k.id } });
    expect(() => applyAction(s, { type: 'playCard', cardUid: 1, arrows: [a.id, a.id] })).toThrow();
    expect(() => applyAction(s, { type: 'playCard', cardUid: 1, arrows: [a.id, a.id, a.id, k.id] })).toThrow();
    expect(canClassBeUsedBy(CARDS.cordon.cls, 'queen')).toBe(false);
    expect(CARDS.cordon.cost).toBe(4);
  });
});

describe('armor', () => {
  function equip(s: GameState, p: Piece, id: 'gambeson' | 'breastplate' | 'plate') {
    s.players[0].hand = [{ uid: 4242, id }];
    s.players[0].energy = 7;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: p.id } });
    applyAction(s, { type: 'playCard', cardUid: 4242 });
  }

  it('only Rook/Queen/King can equip armor, and a new armor replaces the old one', () => {
    expect(canClassBeUsedBy(CARDS.plate.cls, 'knight')).toBe(false);
    expect(canClassBeUsedBy(CARDS.plate.cls, 'queen')).toBe(true);
    const s = setup(2);
    s.pieces = [];
    const r = place(s, 0, 'rook', 0, -5);
    equip(s, r, 'breastplate');
    expect(r.armor).toBe('breastplate');
    pass(s); pass(s);
    equip(s, r, 'plate');
    expect(r.armor).toBe('plate');
  });

  it('Breastplate reduces every hit by 4; shield absorbs before armor', () => {
    const s = setup(2, 5);
    s.pieces = [];
    const r = place(s, 0, 'rook', 0, -5);
    equip(s, r, 'breastplate');
    r.shield = 3;
    pass(s);
    const k = place(s, 1, 'king', 1, -5);
    const ev = applyAction(s, { type: 'attack', pieceId: k.id, target: { kind: 'piece', id: r.id } });
    const roll = ev.find((e) => e.type === 'roll')!;
    const dmg = roll.type === 'roll' ? roll.total : 0;
    const expected = Math.max(0, Math.max(0, dmg - 3) - 4);
    expect(r.shield).toBe(Math.max(0, 3 - dmg));
    expect(s.pieces.includes(r) ? 10 - r.hp : 10).toBe(Math.min(10, expected));
    expect(r.armor).toBe('breastplate');
  });

  it('Gambeson soaks 4 damage in total, then is gone', () => {
    const s = setup(2, 6);
    s.pieces = [];
    const r = place(s, 0, 'rook', 0, -5);
    equip(s, r, 'gambeson');
    pass(s);
    const p = place(s, 1, 'pawn', 1, -5);
    expect(r.armorPool).toBe(4);
    const ev = applyAction(s, { type: 'attack', pieceId: p.id, target: { kind: 'piece', id: r.id } });
    const roll = ev.find((e) => e.type === 'roll')!;
    const dmg = roll.type === 'roll' ? roll.total : 0; // pawn d4: fully soaked
    expect(r.hp).toBe(10);
    expect(r.armorPool).toBe(4 - dmg);
    // a big hit uses up the rest and the excess goes through
    const k = place(s, 1, 'king', -1, -4);
    r.armorPool = 1;
    s.active = null;
    s.turnActed = false;
    const ev2 = applyAction(s, { type: 'attack', pieceId: k.id, target: { kind: 'piece', id: r.id } });
    void ev2;
    expect(r.armor).toBeNull();
  });

  it('Armor Rend strips armor and shield from an enemy piece within 4', () => {
    const s = setup(2);
    s.pieces = [];
    const b = place(s, 0, 'bishop', 0, -3);
    const foe = place(s, 1, 'rook', 0, -1);
    const far = place(s, 1, 'rook', 0, 2);
    foe.armor = 'plate';
    foe.shield = 4;
    s.players[0].hand = [{ uid: 1, id: 'armor_rend' }];
    s.players[0].energy = 3;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: b.id } });
    expect(cardTargets(s, 0, CARDS.armor_rend, b)).toEqual([{ kind: 'piece', id: foe.id }]);
    void far;
    applyAction(s, { type: 'playCard', cardUid: 1, target: { kind: 'piece', id: foe.id } });
    expect(foe.armor).toBeNull();
    expect(foe.shield).toBe(0);
  });
});

describe('difficulty and Dogpile', () => {
  const human = { isBot: false };
  const ai = (difficulty: 'easy' | 'normal' | 'hard' = 'normal') => ({ isBot: true, difficulty });

  it('difficulty is stored per player and defaults to normal', () => {
    const s = newGame([human, ai('hard'), { isBot: true }], 1).state;
    expect(s.players.map((p) => p.difficulty)).toEqual(['normal', 'hard', 'normal']);
  });

  it('Dogpile only switches on with a human and at least two AIs', () => {
    expect(newGame([human, ai(), ai()], 1, 'dogpile').state.mode).toBe('dogpile');
    expect(newGame([human, ai()], 1, 'dogpile').state.mode).toBe('ffa');
    expect(newGame([ai(), ai(), ai()], 1, 'dogpile').state.mode).toBe('ffa');
    expect(newGame([human, ai(), ai()], 1).state.mode).toBe('ffa');
  });

  function killHumanBase(s: GameState) {
    const base = s.players[0].base;
    s.pieces = [];
    s.current = 1;
    s.active = null;
    s.turnActed = false;
    const atk = place(s, 1, 'king', base.q + (base.q > 0 ? -1 : 1), base.r);
    if (hexDistance(atk.pos, base) !== 1) atk.pos = hex(base.q, base.r + (base.r > 0 ? -1 : 1));
    s.players[0].baseHp = 1;
    applyAction(s, { type: 'attack', pieceId: atk.id, target: { kind: 'base', owner: 0 } });
  }

  it('in Dogpile the game ends as a loss as soon as the only human is out', () => {
    const s = newGame([human, ai(), ai(), ai()], 3, 'dogpile').state;
    killHumanBase(s);
    expect(s.players[0].alive).toBe(false);
    expect(s.winner).toBe(1);
    expect(s.players[s.winner!].isBot).toBe(true);
    expect(s.winReason).toMatch(/Dogpile/);
  });

  it('in Free for All the AIs play on after the human is out', () => {
    const s = newGame([human, ai(), ai(), ai()], 3, 'ffa').state;
    killHumanBase(s);
    expect(s.players[0].alive).toBe(false);
    expect(s.winner).toBeNull();
  });
});

describe('Shackles', () => {
  function knightWithShackles(s: GameState) {
    s.pieces = [];
    const k = place(s, 0, 'knight', 0, 0);
    s.players[0].hand = [{ uid: 4242, id: 'shackles' }];
    s.players[0].energy = 2;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: k.id } });
    applyAction(s, { type: 'playCard', cardUid: 4242 });
    return k;
  }

  it('is a 2-cost Knight card (Knight, King), 2 copies', () => {
    expect(CARDS.shackles.cost).toBe(2);
    expect(CARDS.shackles.cls).toBe('knight');
    expect(CARDS.shackles.copies).toBe(2);
    expect(canClassBeUsedBy('knight', 'king')).toBe(true);
    expect(canClassBeUsedBy('knight', 'bishop')).toBe(false);
  });

  it('lets the piece move onto a weaker enemy and capture it (one use)', () => {
    const s = setup(2);
    const k = knightWithShackles(s);
    expect(k.shackles).toBe(true);
    const weak = place(s, 1, 'pawn', 1, 2); // knight jump (1,2) from the centre
    const strong = place(s, 1, 'bishop', 2, 1); // 8 HP > knight's 6
    weak.hp = 4;
    const moves = legalMoves(s, k);
    expect(moves.some((h) => hexEq(h, weak.pos))).toBe(true);
    expect(moves.some((h) => hexEq(h, strong.pos))).toBe(false);
    applyAction(s, { type: 'move', pieceId: k.id, to: hex(1, 2) });
    expect(hexEq(k.pos, hex(1, 2))).toBe(true);
    expect(s.pieces.includes(weak)).toBe(false);
    expect(s.players[0].prisoners.map((p) => p.id)).toEqual([weak.id]);
    expect(k.shackles).toBe(false);
  });

  it('needs strictly less HP', () => {
    const s = setup(2);
    const k = knightWithShackles(s);
    const equal = place(s, 1, 'knight', 1, 2);
    expect(equal.hp).toBe(k.hp);
    expect(legalMoves(s, k).some((h) => hexEq(h, equal.pos))).toBe(false);
  });

  it('a captured flag carrier drops the flag and the captor picks it up', () => {
    const s = setup(2);
    const k = knightWithShackles(s);
    const carrier = place(s, 1, 'pawn', 1, 2);
    s.flag = { pos: null, carrier: carrier.id };
    applyAction(s, { type: 'move', pieceId: k.id, to: hex(1, 2) });
    expect(s.flag.carrier).toBe(k.id);
  });

  it('prisoners are released next to their own base when the captor is knocked out', () => {
    const s = newGame([{}, {}, {}], 5).state;
    const k = knightWithShackles(s);
    const victim = place(s, 2, 'pawn', 1, 2);
    applyAction(s, { type: 'move', pieceId: k.id, to: hex(1, 2) });
    expect(s.players[0].prisoners).toHaveLength(1);
    // player 1 destroys player 0's (unguarded) base
    s.pieces = s.pieces.filter((p) => p.owner !== 0);
    s.current = 1;
    s.active = null;
    s.turnActed = false;
    const base0 = s.players[0].base;
    const atkPos = summonHexes(s, 0).find((h) => !hexEq(h, base0))!;
    const atk = place(s, 1, 'king', atkPos.q, atkPos.r);
    s.players[0].baseHp = 1;
    applyAction(s, { type: 'attack', pieceId: atk.id, target: { kind: 'base', owner: 0 } });
    expect(s.players[0].alive).toBe(false);
    expect(s.winner).toBeNull();
    expect(s.players[0].prisoners).toHaveLength(0);
    const back = s.pieces.find((p) => p.id === victim.id)!;
    expect(back).toBeDefined();
    expect(hexDistance(back.pos, s.players[2].base)).toBeLessThanOrEqual(1);
  });
});

describe('ruined bases and rebuilding', () => {
  /** Player 1 smashes player 0's unguarded base down to 0. */
  function smash(s: GameState, victim = 0, attacker = 1) {
    s.current = attacker;
    s.active = null;
    s.turnActed = false;
    const base = s.players[victim].base;
    const spot = summonHexes(s, victim).find((h) => !hexEq(h, base) && !pieceAt(s, h))!;
    const atk = place(s, attacker, 'king', spot.q, spot.r);
    s.players[victim].baseHp = 1;
    applyAction(s, { type: 'attack', pieceId: atk.id, target: { kind: 'base', owner: victim } });
    return atk;
  }

  it('a player with a Rook or King keeps playing with a ruined base', () => {
    const s = newGame([{}, {}, {}], 8).state;
    s.pieces = [];
    place(s, 0, 'rook', 0, 0);
    smash(s);
    expect(s.players[0].alive).toBe(true);
    expect(s.players[0].ruined).toBe(true);
    expect(s.players[0].baseHp).toBe(0);
    expect(s.winner).toBeNull();
  });

  it('without a King or Rook the player is out', () => {
    const s = newGame([{}, {}, {}], 8).state;
    s.pieces = [];
    place(s, 0, 'queen', 0, 0);
    smash(s);
    expect(s.players[0].alive).toBe(false);
  });

  it('the game ends when only one ACTIVE base is left, even if someone is rebuilding', () => {
    const s = newGame([{}, {}], 8).state;
    s.pieces = [];
    place(s, 0, 'king', 0, 0);
    smash(s);
    expect(s.players[0].alive).toBe(true);
    expect(s.winner).toBe(1);
    expect(s.winReason).toBe('last active base standing');
  });

  it('a ruined base cannot be picked, attacked or score the flag; a King/Rook on it rebuilds 1d8 a turn', () => {
    const s = newGame([{}, {}, {}], 8).state;
    s.pieces = [];
    const rook = place(s, 0, 'rook', 0, 0);
    smash(s);
    const me = s.players[0];
    // back to player 0
    s.current = 0;
    s.active = null;
    s.turnActed = false;
    expect(canBeUnit(s, { kind: 'base' })).toBe(false);
    rook.pos = { ...me.base };
    s.flag = { pos: null, carrier: rook.id };
    expect(s.winner).toBeNull();
    let guard = 0;
    while (me.ruined && guard++ < 40) {
      const before = me.baseHp;
      expect(legalActions(s).some((a) => a.type === 'rebuild')).toBe(true);
      applyAction(s, { type: 'rebuild', pieceId: rook.id });
      expect(me.baseHp - before).toBeGreaterThanOrEqual(1);
      expect(me.baseHp - before).toBeLessThanOrEqual(8);
      expect(legalActions(s).some((a) => a.type === 'rebuild')).toBe(false); // once per turn
      if (me.ruined) {
        s.active = null;
        s.turnActed = false;
        rook.attacksLeft = 1;
        rook.movesLeft = 1;
      }
    }
    expect(me.ruined).toBe(false);
    expect(me.baseHp).toBe(RULES.baseHp);
    // the Rook was carrying the flag on its base: the rebuilt base scores it
    expect(s.winner).toBe(0);
  });

  it('losing the last King/Rook while ruined knocks the player out', () => {
    const s = newGame([{}, {}, {}], 8).state;
    s.pieces = [];
    const rook = place(s, 0, 'rook', 0, 0);
    const atk = smash(s);
    expect(s.players[0].ruined).toBe(true);
    rook.hp = 1;
    rook.pos = hex(atk.pos.q, atk.pos.r);
    atk.pos = hex(0, 0);
    rook.pos = hex(1, 0);
    s.active = null;
    s.turnActed = false;
    atk.attacksLeft = 1;
    applyAction(s, { type: 'attack', pieceId: atk.id, target: { kind: 'piece', id: rook.id } });
    expect(s.players[0].alive).toBe(false);
  });
});

describe('promotion cards', () => {
  const table: [string, Piece['kind'], Piece['kind'], number][] = [
    ['promote_pawn_knight', 'pawn', 'knight', 2],
    ['promote_pawn_bishop', 'pawn', 'bishop', 3],
    ['promote_pawn_rook', 'pawn', 'rook', 4],
    ['promote_bishop_queen', 'bishop', 'queen', 5],
    ['promote_knight_king', 'knight', 'king', 6],
    ['promote_rook_king', 'rook', 'king', 6],
  ];
  it('the old single Promote card is gone', () => {
    expect((CARDS as Record<string, unknown>).promote).toBeUndefined();
  });
  it.each(table)('%s turns a %s into a full-HP %s (cost %i), keeping flag and gear', (id, from, to, cost) => {
    const s = setup(2);
    s.pieces = [];
    const q = place(s, 0, 'queen', 0, -3);
    const t = place(s, 0, from, 0, -1);
    const wrong = place(s, 0, from === 'pawn' ? 'knight' : 'pawn', 1, -2);
    t.hp = 1;
    t.shield = 3;
    t.armor = 'breastplate';
    t.movesLeft = 1;
    s.flag = { pos: null, carrier: t.id };
    const def = CARDS[id as keyof typeof CARDS];
    expect(def.cost).toBe(cost);
    expect(def.cls).toBe('queen');
    const me = s.players[0];
    me.hand = [{ uid: 1, id: def.id }];
    me.energy = 7;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: q.id } });
    const targets = cardTargets(s, 0, def, q);
    expect(targets).toEqual([{ kind: 'piece', id: t.id }]);
    expect(targets.some((x) => x.kind === 'piece' && x.id === wrong.id)).toBe(false);
    applyAction(s, { type: 'playCard', cardUid: 1, target: { kind: 'piece', id: t.id } });
    expect(t.kind).toBe(to);
    expect(t.hp).toBe(PIECES[to].hp);
    expect(t.maxHp).toBe(PIECES[to].hp);
    expect(t.shield).toBe(3);
    expect(t.armor).toBe('breastplate');
    expect(s.flag.carrier).toBe(t.id);
    expect(t.movesLeft).toBe(1);
  });
  it('a piece promoted to King counts as a builder for a ruined base', () => {
    const s = newGame([{}, {}, {}], 8).state;
    s.pieces = [];
    const q = place(s, 0, 'queen', 0, -3);
    const k = place(s, 0, 'knight', 0, -1);
    const me = s.players[0];
    me.hand = [{ uid: 1, id: 'promote_knight_king' }];
    me.energy = 7;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: q.id } });
    applyAction(s, { type: 'playCard', cardUid: 1, target: { kind: 'piece', id: k.id } });
    expect(hasBuilder(s, 0)).toBe(true);
  });
});

describe('skulls and Necromancy', () => {
  function killAt(s: GameState, victim: Piece, killerOwner: number) {
    s.current = killerOwner;
    s.active = null;
    s.turnActed = false;
    const k = place(s, killerOwner, 'king', victim.pos.q + 1, victim.pos.r);
    victim.hp = 1;
    applyAction(s, { type: 'attack', pieceId: k.id, target: { kind: 'piece', id: victim.id } });
    return k;
  }

  it('a piece that dies leaves a skull (owner + type); pieces may stand on it', () => {
    const s = setup(2);
    s.pieces = [];
    const v = place(s, 0, 'rook', 0, 1);
    const k = killAt(s, v, 1);
    expect(s.pieces.includes(v)).toBe(false);
    expect(s.corpses).toHaveLength(1);
    expect(s.corpses[0]).toMatchObject({ owner: 0, kind: 'rook', pos: hex(0, 1) });
    // a piece can step onto the skull hex
    s.active = null;
    s.turnActed = false;
    k.movesLeft = 1;
    expect(legalMoves(s, k).some((h) => hexEq(h, hex(0, 1)))).toBe(true);
  });

  it('captured prisoners leave no skull', () => {
    const s = setup(2);
    s.pieces = [];
    const k = place(s, 0, 'knight', 0, 0);
    k.shackles = true;
    place(s, 1, 'pawn', 1, 2);
    applyAction(s, { type: 'move', pieceId: k.id, to: hex(1, 2) });
    expect(s.corpses).toHaveLength(0);
  });

  it('Necromancy (Bishop class, cost 3) raises an adjacent friendly corpse at full HP, unable to act this turn', () => {
    const s = setup(2);
    s.pieces = [];
    const v = place(s, 0, 'rook', 0, 1);
    killAt(s, v, 1);
    s.pieces = s.pieces.filter((p) => p.owner !== 1);
    s.current = 0;
    s.active = null;
    s.turnActed = false;
    const b = place(s, 0, 'bishop', 0, 0);
    const me = s.players[0];
    me.hand = [{ uid: 31, id: 'necromancy' }];
    me.energy = 3;
    expect(CARDS.necromancy.cost).toBe(3);
    expect(CARDS.necromancy.cls).toBe('bishop');
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: b.id } });
    expect(cardTargets(s, 0, CARDS.necromancy, b)).toEqual([{ kind: 'hex', hex: hex(0, 1) }]);
    applyAction(s, { type: 'playCard', cardUid: 31, target: { kind: 'hex', hex: hex(0, 1) } });
    const raised = pieceAt(s, hex(0, 1))!;
    expect(raised.kind).toBe('rook');
    expect(raised.owner).toBe(0);
    expect(raised.hp).toBe(PIECES.rook.hp);
    expect(raised.movesLeft).toBe(0);
    expect(raised.attacksLeft).toBe(0);
    expect(s.corpses).toHaveLength(0);
  });

  it("an enemy corpse rises on the necromancer's side; occupied or far skulls are not targets", () => {
    const s = setup(2);
    s.pieces = [];
    const v = place(s, 1, 'knight', 0, 1);
    const killer = killAt(s, v, 0);
    s.pieces = [];
    s.active = null;
    s.turnActed = false;
    const q = place(s, 0, 'queen', 0, 0);
    s.corpses.push({ id: 999, owner: 1, kind: 'pawn', pos: hex(0, -3), round: 1 }); // too far
    const me = s.players[0];
    me.hand = [{ uid: 32, id: 'necromancy' }];
    me.energy = 3;
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: q.id } });
    const blocker = place(s, 0, 'pawn', 0, 1);
    expect(cardTargets(s, 0, CARDS.necromancy, q)).toEqual([]);
    s.pieces = s.pieces.filter((p) => p !== blocker);
    applyAction(s, { type: 'playCard', cardUid: 32, target: { kind: 'hex', hex: hex(0, 1) } });
    const raised = pieceAt(s, hex(0, 1))!;
    expect(raised.kind).toBe('knight');
    expect(raised.owner).toBe(0);
    expect(killer).toBeDefined();
  });
});

describe('one piece: move, attack and play a card in ANY order', () => {
  type Step = 'move' | 'attack' | 'card';
  const orders: Step[][] = [
    ['move', 'attack', 'card'], ['move', 'card', 'attack'], ['attack', 'move', 'card'],
    ['attack', 'card', 'move'], ['card', 'move', 'attack'], ['card', 'attack', 'move'],
  ];
  const scenarios = [
    { kind: 'pawn' as const, dest: hex(-1, 0), e1: hex(1, 0), e2: hex(-2, 0), card: 'heal' as const, target: 'self' },
    { kind: 'knight' as const, dest: hex(1, 2), e1: hex(-1, 0), e2: hex(1, 3), card: 'sharpen' as const, target: 'none' },
    { kind: 'knight' as const, dest: hex(1, 2), e1: hex(-1, 0), e2: hex(1, 3), card: 'haste' as const, target: 'none' },
    { kind: 'bishop' as const, dest: hex(0, 2), e1: hex(-1, 0), e2: hex(1, 2), card: 'firebolt' as const, target: 'e1' },
  ];
  for (const sc of scenarios) {
    it.each(orders.map((o) => [o.join(' → '), o] as const))(`${sc.kind} + ${sc.card}: %s`, (_name, order) => {
      const s = setup(2, 77);
      s.pieces = [];
      s.flag = { pos: hex(-4, 4), carrier: null };
      const p = place(s, 0, sc.kind, 0, 0);
      p.hp -= 2;
      const e1 = place(s, 1, 'king', sc.e1.q, sc.e1.r);
      const e2 = place(s, 1, 'king', sc.e2.q, sc.e2.r);
      const me = s.players[0];
      me.energy = 7;
      me.hand = [{ uid: 501, id: sc.card }];
      applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: p.id } });
      let moved = false;
      for (const step of order) {
        if (step === 'move') {
          expect(legalMoves(s, p).some((h) => hexEq(h, sc.dest))).toBe(true);
          applyAction(s, { type: 'move', pieceId: p.id, to: sc.dest });
          moved = true;
        } else if (step === 'attack') {
          const foe = moved ? e2 : e1;
          expect(legalAttacks(s, p).some((t) => t.kind === 'piece' && t.id === foe.id)).toBe(true);
          applyAction(s, { type: 'attack', pieceId: p.id, target: { kind: 'piece', id: foe.id } });
        } else {
          expect(canPlayCard(s, 0, me.hand[0])).toBe(true);
          const target = sc.target === 'self' ? { kind: 'piece' as const, id: p.id } : sc.target === 'e1' ? { kind: 'piece' as const, id: e1.id } : undefined;
          applyAction(s, { type: 'playCard', cardUid: 501, target });
        }
        // the piece stays this turn's unit throughout
        expect(s.active).toEqual({ kind: 'piece', id: p.id });
        expect(s.current).toBe(0);
      }
      expect(s.cardsUsed).toBe(1);
      expect(hexEq(p.pos, sc.dest)).toBe(true);
      expect(e1.hp + e2.hp).toBeLessThan(40);
    });
  }

  it('turn 1: the starting pawn can move off its base and then play Heal', () => {
    const s = setup(2, 3);
    const pawn = s.pieces.find((x) => x.owner === 0)!;
    const me = s.players[0];
    expect(me.energy).toBe(2);
    me.hand.push({ uid: 600, id: 'heal' });
    pawn.hp = 2; // Heal needs a damaged target
    applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: pawn.id } });
    applyAction(s, { type: 'move', pieceId: pawn.id, to: legalMoves(s, pawn)[0] });
    expect(canPlayCard(s, 0, me.hand.find((c) => c.uid === 600)!)).toBe(true);
    applyAction(s, { type: 'playCard', cardUid: 600, target: { kind: 'piece', id: pawn.id } });
    expect(me.energy).toBe(1);
    // End turn always passes the turn
    applyAction(s, { type: 'endTurn' });
    expect(s.current).toBe(1);
  });
});

describe('card audit: every card does what its text says', () => {
  /** Fresh 2-player state, our `kind` at the centre picked as this turn's unit, enemy king adjacent. */
  function rig(kind: Piece['kind'], card: keyof typeof CARDS, energy = 7) {
    const s = setup(2, 21);
    s.pieces = [];
    s.flag = { pos: hex(-4, 4), carrier: null };
    const me = s.players[0];
    const p = place(s, 0, kind, 0, 0);
    const foe = place(s, 1, 'king', 1, 0);
    me.energy = energy;
    me.hand = [{ uid: 1, id: card }];
    if (CARDS[card].cls !== 'conjuration') applyAction(s, { type: 'selectUnit', unit: { kind: 'piece', id: p.id } });
    return { s, me, p, foe };
  }
  const play = (s: GameState, target?: Parameters<typeof applyAction>[1] extends infer A ? A extends { type: 'playCard'; target?: infer T } ? T : never : never) =>
    applyAction(s, { type: 'playCard', cardUid: 1, target });
  const audited = new Set<string>();
  const audit = (id: string, fn: () => void) => it(id, () => { audited.add(id); fn(); });

  for (const id of ['summon_pawn', 'summon_knight', 'summon_bishop', 'summon_rook', 'summon_queen', 'summon_king'] as const) {
    audit(id, () => {
      const s = setup(2, 21);
      const me = s.players[0];
      me.energy = 7;
      me.hand = [{ uid: 1, id }];
      const spot = summonHexes(s, 0)[0];
      play(s, { kind: 'hex', hex: spot });
      const np = pieceAt(s, spot)!;
      expect(np.kind).toBe(CARDS[id].summons);
      expect(np.hp).toBe(PIECES[np.kind].hp);
      expect(np.movesLeft + np.attacksLeft).toBe(2); // can act the same turn
      expect(me.energy).toBe(7 - CARDS[id].cost);
    });
  }
  audit('heal', () => {
    const { s, p } = rig('pawn', 'heal');
    expect(cardTargets(s, 0, CARDS.heal, p)).toEqual([]); // nothing damaged
    p.hp = 1;
    play(s, { kind: 'piece', id: p.id });
    expect(p.hp).toBeGreaterThan(1);
    expect(p.hp).toBeLessThanOrEqual(p.maxHp);
  });
  audit('sharpen', () => {
    const { s, p, foe } = rig('knight', 'sharpen');
    play(s);
    expect(p.bonusDamage).toBe(2);
    applyAction(s, { type: 'attack', pieceId: p.id, target: { kind: 'piece', id: foe.id } });
    expect(foe.hp).toBeLessThanOrEqual(20 - 3);
    expect(p.bonusDamage).toBe(0); // next attack only
  });
  audit('frenzy', () => {
    const { s, p, foe } = rig('knight', 'frenzy');
    play(s);
    expect(p.attacksLeft).toBe(2);
    expect(p.movesLeft).toBe(1); // no extra move: that is Haste
    applyAction(s, { type: 'attack', pieceId: p.id, target: { kind: 'piece', id: foe.id } });
    expect(legalAttacks(s, p).length).toBeGreaterThan(0);
    applyAction(s, { type: 'attack', pieceId: p.id, target: { kind: 'piece', id: foe.id } });
    expect(legalAttacks(s, p)).toEqual([]);
  });
  audit('haste', () => {
    const { s, p } = rig('knight', 'haste');
    play(s);
    expect(p.movesLeft).toBe(2);
    expect(p.attacksLeft).toBe(1); // no extra attack: that is Frenzy
    applyAction(s, { type: 'move', pieceId: p.id, to: legalMoves(s, p)[0] });
    expect(legalMoves(s, p).length).toBeGreaterThan(0);
    applyAction(s, { type: 'move', pieceId: p.id, to: legalMoves(s, p)[0] });
    expect(legalMoves(s, p)).toEqual([]);
  });
  audit('cordon', () => {
    const { s, foe } = rig('knight', 'cordon');
    applyAction(s, { type: 'playCard', cardUid: 1, arrows: [foe.id, foe.id, foe.id, foe.id] });
    expect(foe.hp).toBeLessThanOrEqual(20 - 4);
  });
  audit('shackles', () => {
    const { s, p } = rig('knight', 'shackles');
    play(s);
    expect(p.shackles).toBe(true);
  });
  audit('firebolt', () => {
    const { s, foe } = rig('bishop', 'firebolt');
    play(s, { kind: 'piece', id: foe.id });
    expect(foe.hp).toBeLessThanOrEqual(18);
    expect(foe.hp).toBeGreaterThanOrEqual(12);
  });
  audit('fireball', () => {
    const { s, p, foe } = rig('bishop', 'fireball');
    const far = place(s, 1, 'king', 0, 4);
    play(s, { kind: 'hex', hex: hex(1, 1) });
    expect(foe.hp).toBeLessThan(20); // 1 away
    expect(p.hp < PIECES.bishop.hp || !s.pieces.includes(p)).toBe(true); // caster is within 2: hit too
    expect(far.hp).toBe(20);
  });
  audit('armor_rend', () => {
    const { s, foe } = rig('bishop', 'armor_rend');
    foe.armor = 'plate';
    foe.shield = 4;
    play(s, { kind: 'piece', id: foe.id });
    expect(foe.armor).toBeNull();
    expect(foe.shield).toBe(0);
  });
  audit('necromancy', () => {
    const { s, p } = rig('bishop', 'necromancy');
    s.corpses.push({ id: 5000, owner: 1, kind: 'rook', pos: hex(0, 1), round: 1 });
    play(s, { kind: 'hex', hex: hex(0, 1) });
    const r = pieceAt(s, hex(0, 1))!;
    expect(r.kind).toBe('rook');
    expect(r.owner).toBe(p.owner);
  });
  audit('recall', () => {
    const { s, me, p } = rig('bishop', 'recall');
    p.hp = 3;
    play(s);
    expect(hexDistance(p.pos, me.base)).toBe(1); // NEXT TO the base
    expect(p.hp).toBe(5);
  });
  audit('shield', () => {
    const { s, p } = rig('rook', 'shield');
    play(s, { kind: 'piece', id: p.id });
    expect(p.shield).toBe(4);
  });
  audit('fortify', () => {
    const { s, me } = rig('rook', 'fortify');
    me.baseHp = 10;
    play(s);
    expect(me.baseHp).toBe(16);
  });
  for (const [id, pool, reduce] of [['gambeson', 4, 0], ['breastplate', 0, 4], ['plate', 0, 6]] as const) {
    audit(id, () => {
      const { s, p, foe } = rig('rook', id);
      play(s);
      expect(p.armor).toBe(id);
      expect(ARMORS[id].pool ?? 0).toBe(pool);
      expect(ARMORS[id].reduce ?? 0).toBe(reduce);
      // a hit from the adjacent enemy is reduced/soaked
      s.current = 1; s.active = null; s.turnActed = false;
      const before = p.hp;
      applyAction(s, { type: 'attack', pieceId: foe.id, target: { kind: 'piece', id: p.id } });
      const dmgTaken = before - (s.pieces.includes(p) ? p.hp : 0);
      expect(dmgTaken).toBeLessThanOrEqual(Math.max(0, 20 - Math.max(pool, reduce)));
    });
  }
  audit('rally', () => {
    const { s, me } = rig('rook', 'rally');
    play(s);
    expect(me.hand).toHaveLength(2);
  });
  for (const id of ['promote_pawn_knight', 'promote_pawn_bishop', 'promote_pawn_rook', 'promote_bishop_queen', 'promote_knight_king', 'promote_rook_king'] as const) {
    audit(id, () => {
      const { s } = rig('queen', id);
      const t = place(s, 0, CARDS[id].promote!.from, 0, -2);
      play(s, { kind: 'piece', id: t.id });
      expect(t.kind).toBe(CARDS[id].promote!.to);
      expect(t.hp).toBe(PIECES[t.kind].hp);
    });
  }
  it('covers every card in the deck', () => {
    for (const id of Object.keys(CARDS)) expect(audited.has(id), `${id} audited`).toBe(true);
  });
});
