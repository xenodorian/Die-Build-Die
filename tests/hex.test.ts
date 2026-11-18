import { describe, expect, it } from 'vitest';
import { DIAGONALS, KNIGHT_JUMPS, corners, hex, hexDistance, hexagonBoard } from '../src/game/hex';
import { RULES } from '../src/game/config';

describe('hex board', () => {
  it('has 3R(R+1)+1 hexes', () => {
    const R = RULES.boardRadius;
    expect(hexagonBoard(R).length).toBe(3 * R * (R + 1) + 1);
    expect(hexagonBoard(10).length).toBe(331);
  });

  it('the game board is radius 5: 91 hexes, corners 5 from the centre flag', () => {
    expect(RULES.boardRadius).toBe(5);
    expect(hexagonBoard(RULES.boardRadius).length).toBe(91);
    for (const c of corners(RULES.boardRadius)) expect(hexDistance(c, hex(0, 0))).toBe(5);
  });

  it('every corner is exactly 10 hexes from the centre', () => {
    const cs = corners(10);
    expect(cs).toHaveLength(6);
    for (const c of cs) expect(hexDistance(c, hex(0, 0))).toBe(10);
    // corners are distinct and adjacent corners are 10 apart, opposite ones 20
    expect(new Set(cs.map((c) => `${c.q},${c.r}`)).size).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(hexDistance(cs[i], cs[(i + 1) % 6])).toBe(10);
      expect(hexDistance(cs[i], cs[(i + 3) % 6])).toBe(20);
    }
  });

  it('corners are on the board and have only 3 on-board neighbours', () => {
    const board = new Set(hexagonBoard(10).map((h) => `${h.q},${h.r}`));
    for (const c of corners(10)) expect(board.has(`${c.q},${c.r}`)).toBe(true);
  });

  it('diagonals are distance 2, knight jumps are 12 hexes at distance 3', () => {
    for (const d of DIAGONALS) expect(hexDistance(d, hex(0, 0))).toBe(2);
    expect(KNIGHT_JUMPS).toHaveLength(12);
    for (const j of KNIGHT_JUMPS) expect(hexDistance(j, hex(0, 0))).toBe(3);
  });
});
