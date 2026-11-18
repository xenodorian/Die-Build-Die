import { describe, expect, it } from 'vitest';
import { applyAction, newGame } from '../src/game/engine';
import { runBotTurn } from '../src/game/bot';

describe('bot games', () => {
  it.each([2, 3, 4, 5, 6])('%i-player bot games always finish', (n) => {
    for (let g = 0; g < 10; g++) {
      const { state } = newGame(Array.from({ length: n }, () => ({ isBot: true })), 500 + g);
      while (state.winner === null && state.round < 300) runBotTurn(state, (a) => applyAction(state, a));
      expect(state.winner).not.toBeNull();
    }
  });
});
