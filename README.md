# Die Build Die

A hex-board strategy game that mixes **chess pieces**, **a deck of cards**, and **dice**.
2–6 players start in the corners of a radius-5 hex board (91 hexes) and play capture the flag: grab the flag from the centre hex and carry it home. Each turn you act with ONE unit — your base (conjure chess pieces) or a single piece (move, play one class card, attack) — and roll dice to fight.

Play solo against 1–5 AI opponents (Easy / Normal / Hard) in **Free for All** or **Dogpile** (every AI hunts you), or add pass-and-play humans. v0.4 adds Shackles (capture prisoners), six promotion cards, skulls and Necromancy, and ruined bases that a King or Rook can rebuild. Movement is hex-native: Rook and Bishop slide up to 4 hexes in any of the 6 directions, the Queen slides any distance (values in `src/game/config.ts`). See [RULES.md](RULES.md).

**▶ Play:** https://xenodorian.github.io/Die-Build-Die/
**📜 Rules:** [RULES.md](RULES.md)

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run simulate   # headless greedy-bot games: npm run simulate -- 200 4  (add --random for random play, informational)
npx tsx scripts/difficulty.ts h2h 100        # Easy/Normal/Hard head-to-heads
npx tsx scripts/difficulty.ts ffa3 90        # 3-player FFA, one bot of each difficulty
npx tsx scripts/difficulty.ts dogpile 60 3   # 'human' seat (Normal bot) vs 3 AIs: Dogpile vs FFA
node scripts/ui-smoke.mjs http://localhost:4173/Die-Build-Die/   # real-click UI test: move/attack/card in all 6 orders (needs playwright + Chrome)
node scripts/ui-smoke-fresh.mjs http://localhost:4173/Die-Build-Die/ [shot.png]   # fresh game: pawn select/move, card-click feedback, Base button, all 6 promotions
npm run build      # production build in dist/ (base path /Die-Build-Die/)
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Layout

| Path | What |
|---|---|
| `src/game/config.ts` | **All tunable rules, pieces and cards** — edit balance here |
| `src/game/hex.ts` | Hex math (axial/cube coordinates, distances, board, corners) |
| `src/game/engine.ts` | Pure rules engine: setup, legal moves/attacks, cards, combat, turns, win checks |
| `src/game/bot.ts` | AI: Easy / Normal / Hard, Free for All & Dogpile team play |
| `src/main.ts`, `src/ui/` | Browser UI: SVG board, card hand, animated dice, log |
| `tests/` | Vitest unit tests |
| `scripts/simulate.ts` | Headless simulation to check games finish |
| `scripts/difficulty.ts` | Difficulty and Dogpile win-rate simulations |
