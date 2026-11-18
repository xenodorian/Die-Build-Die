import { describe, expect, it } from 'vitest';
import { newGame } from '../src/game/engine';
import { relation } from '../src/game/bot';

describe('bot relations', () => {
  it('Dogpile AIs treat each other as allies and the human as the enemy', () => {
    const s = newGame([{ isBot: false }, { isBot: true }, { isBot: true }], 1, 'dogpile').state;
    expect(relation(s, 1, 2)).toBe('ally');
    expect(relation(s, 1, 0)).toBe('enemy');
    // the human (or a bot standing in for one) still sees everybody as an enemy
    expect(relation(s, 0, 1)).toBe('enemy');
  });
  it('Free for All: everybody is an enemy', () => {
    const s = newGame([{ isBot: false }, { isBot: true }, { isBot: true }], 1, 'ffa').state;
    expect(relation(s, 1, 2)).toBe('enemy');
  });
});
