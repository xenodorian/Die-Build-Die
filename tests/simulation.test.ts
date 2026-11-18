import { describe, expect, it } from 'vitest';
import { applyAction, newGame } from '../src/game/engine';
import { runBotTurn } from '../src/game/bot';

describe('bot games', () => {
  it.each([2, 3, 4, 5, 6])('%i-player bot games always finish', { timeout: 120000 }, (n) => {
    for (let g = 0; g < 3; g++) {
      const { state } = newGame(Array.from({ length: n }, () => ({ isBot: true })), 500 + g);
      while (state.winner === null && state.round < 400) runBotTurn(state, (a) => applyAction(state, a));
      expect(state.winner).not.toBeNull();
    }
  });

  it('Easy, Normal and Hard bots finish a Free for All', { timeout: 120000 }, () => {
    for (let g = 0; g < 2; g++) {
      const { state } = newGame([{ isBot: true, difficulty: 'easy' }, { isBot: true, difficulty: 'normal' }, { isBot: true, difficulty: 'hard' }], 900 + g);
      while (state.winner === null && state.round < 400) runBotTurn(state, (a) => applyAction(state, a));
      expect(state.winner).not.toBeNull();
    }
  });

  it('Dogpile games finish (human seat played by a bot)', { timeout: 120000 }, () => {
    for (let g = 0; g < 2; g++) {
      const { state } = newGame([{ isBot: false }, { isBot: true }, { isBot: true }, { isBot: true, difficulty: 'hard' }], 950 + g, 'dogpile');
      expect(state.mode).toBe('dogpile');
      while (state.winner === null && state.round < 400) runBotTurn(state, (a) => applyAction(state, a));
      expect(state.winner).not.toBeNull();
    }
  });
});
