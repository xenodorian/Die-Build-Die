/**
 * Difficulty & Dogpile sanity checks.
 * Usage: npx tsx scripts/difficulty.ts <suite> [games]
 *   suite = h2h        2-player head-to-heads between difficulties (seats alternate)
 *         | ffa3       3-player FFA with one Easy, one Normal, one Hard (seats rotate)
 *         | dogpile N  the "human" seat (played by the Normal bot) vs N Normal AIs, Dogpile vs FFA
 */
import { applyAction, newGame } from '../src/game/engine';
import { runBotTurn } from '../src/game/bot';
import type { Difficulty, GameMode, GameState, PlayerSetup } from '../src/game/types';

const suite = process.argv[2] ?? 'h2h';
const games = Number(process.argv[3] ?? 40);
const MAX_ROUNDS = 300;

function play(setups: PlayerSetup[], seed: number, mode: GameMode = 'ffa'): GameState {
  const { state } = newGame(setups, seed, mode);
  while (state.winner === null && state.round <= MAX_ROUNDS) runBotTurn(state, (a) => applyAction(state, a));
  return state;
}

const bot = (difficulty: Difficulty): PlayerSetup => ({ isBot: true, difficulty });

if (suite === 'h2h') {
  const pairs: [Difficulty, Difficulty][] = [['hard', 'normal'], ['normal', 'easy'], ['hard', 'easy']];
  for (const [a, b] of pairs) {
    let aw = 0, bw = 0, draws = 0, rounds = 0;
    for (let g = 0; g < games; g++) {
      const aFirst = g % 2 === 0;
      const s = play(aFirst ? [bot(a), bot(b)] : [bot(b), bot(a)], 5000 + g);
      rounds += s.round;
      if (s.winner === null) draws++;
      else if (s.players[s.winner].difficulty === a) aw++;
      else bw++;
    }
    console.log(`${a} vs ${b}: ${a} won ${aw}/${games} (${Math.round((100 * aw) / games)}%), ${b} won ${bw}, unfinished ${draws}, avg rounds ${(rounds / games).toFixed(1)}`);
  }
} else if (suite === 'ffa3') {
  const wins: Record<string, number> = { easy: 0, normal: 0, hard: 0, none: 0 };
  const order: Difficulty[] = ['easy', 'normal', 'hard'];
  for (let g = 0; g < games; g++) {
    const seats = order.map((_, i) => order[(i + g) % 3]);
    const s = play(seats.map(bot), 7000 + g);
    wins[s.winner === null ? 'none' : s.players[s.winner].difficulty]++;
  }
  console.log(`3-player FFA (Easy/Normal/Hard, seats rotated), ${games} games: ${JSON.stringify(wins)}`);
} else if (suite === 'dogpile') {
  const ais = Number(process.argv[4] ?? 3);
  for (const mode of ['ffa', 'dogpile'] as GameMode[]) {
    let humanWins = 0, humanOut = 0, rounds = 0, unfinished = 0, survivedRounds = 0;
    const reasons: Record<string, number> = {};
    for (let g = 0; g < games; g++) {
      // Seat 0 is the "human" (isBot false), driven by the Normal bot for the simulation.
      const s = play([{ isBot: false, difficulty: 'normal' }, ...Array.from({ length: ais }, () => bot('normal'))], 9000 + g, mode);
      rounds += s.round;
      if (s.winner === null) unfinished++;
      else if (s.winner === 0) humanWins++;
      if (!s.players[0].alive) humanOut++;
      survivedRounds += s.round;
      const r = (s.winReason ?? 'unfinished').replace(/with a \w+/, '').trim();
      reasons[r] = (reasons[r] ?? 0) + 1;
    }
    console.log(`${mode.toUpperCase()} — human(Normal bot) vs ${ais} Normal AIs, ${games} games: human won ${humanWins} (${Math.round((100 * humanWins) / games)}%), human base destroyed in ${humanOut}, avg rounds ${(rounds / games).toFixed(1)}, unfinished ${unfinished}, endings ${JSON.stringify(reasons)}`);
  }
}
