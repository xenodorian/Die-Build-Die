/**
 * Headless bot simulation: plays many full games and reports how they end.
 * Usage: npm run simulate -- [games=200] [players=all] [--random]
 *   default   greedy bot (src/game/bot.ts)
 *   --random  every player picks uniformly random legal actions (ends turn 25% of the time).
 *             Informational only: random walkers rarely carry the flag home, so stalls are expected.
 */
import { applyAction, newGame } from '../src/game/engine';
import { runBotTurn } from '../src/game/bot';
import { RULES } from '../src/game/config';
import { legalActions } from '../src/game/engine';
import { nextRandom } from '../src/game/rng';
import type { GameState } from '../src/game/types';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const randomMode = process.argv.includes('--random');
const rngBox = { rngState: 12345 };
function randomTurn(state: GameState) {
  const who = state.current;
  for (let i = 0; i < 500 && state.winner === null && state.current === who; i++) {
    const acts = legalActions(state).filter((a) => a.type !== 'endTurn');
    if (!acts.length || nextRandom(rngBox) < 0.25) applyAction(state, { type: 'endTurn' });
    else applyAction(state, acts[Math.floor(nextRandom(rngBox) * acts.length)]);
  }
  if (state.winner === null && state.current === who) applyAction(state, { type: 'endTurn' });
}

const games = Number(args[0] ?? 200);
const onlyPlayers = args[1] ? [Number(args[1])] : [2, 3, 4, 5, 6];
const MAX_ROUNDS_RANDOM = 2000;
const MAX_ROUNDS_GREEDY = 300;
const MAX_ROUNDS = randomMode ? MAX_ROUNDS_RANDOM : MAX_ROUNDS_GREEDY;
let failures = 0;

for (const n of onlyPlayers) {
  const reasons: Record<string, number> = {};
  const rounds: number[] = [];
  const winsBySeat = Array(n).fill(0);
  for (let g = 0; g < games; g++) {
    const { state } = newGame(Array.from({ length: n }, () => ({ isBot: true })), 1000 + g * 7 + n);
    let guard = 0;
    while (state.winner === null && state.round <= MAX_ROUNDS) {
      if (randomMode) randomTurn(state);
      else runBotTurn(state, (a) => applyAction(state, a));
      if (++guard > MAX_ROUNDS * n + 10) break;
    }
    if (state.winner === null) {
      reasons['unfinished'] = (reasons['unfinished'] ?? 0) + 1;
      failures++;
    } else {
      const key = (state.winReason ?? '').replace(/with a \w+/, '');
      reasons[key] = (reasons[key] ?? 0) + 1;
      winsBySeat[state.winner]++;
    }
    rounds.push(state.round);
  }
  rounds.sort((a, b) => a - b);
  const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
  console.log(
    `${n} players | ${games} games | rounds avg ${avg.toFixed(1)}, median ${rounds[rounds.length >> 1]}, max ${rounds[rounds.length - 1]}` +
      ` | endings ${JSON.stringify(reasons)} | wins by seat ${JSON.stringify(winsBySeat)}`,
  );
}
console.log(`mode: ${randomMode ? 'random' : 'greedy'} | energy max ${RULES.energyMax}`);
if (failures && !randomMode) {
  console.error(`${failures} game(s) did not finish within ${MAX_ROUNDS} rounds`);
  process.exit(1);
}
