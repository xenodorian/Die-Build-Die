# Die Build Die

A hex-board strategy game that mixes **chess pieces**, **a deck of cards**, and **dice**.
2–6 players start in the corners of a radius-10 hex board and play capture the flag: grab the flag from the centre hex and carry it home, summoning chess pieces from their hand and rolling dice to fight.

**▶ Play:** https://xenodorian.github.io/Die-Build-Die/
**📜 Rules:** [RULES.md](RULES.md)

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run simulate   # headless greedy-bot games: npm run simulate -- 200 4  (add --random for random play, informational)
npm run build      # production build in dist/ (base path /Die-Build-Die/)
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Layout

| Path | What |
|---|---|
| `src/game/config.ts` | **All tunable rules, pieces and cards** — edit balance here |
| `src/game/hex.ts` | Hex math (axial/cube coordinates, distances, board, corners) |
| `src/game/engine.ts` | Pure rules engine: setup, legal moves/attacks, cards, combat, turns, win checks |
| `src/game/bot.ts` | Simple greedy bot (sparring partner + simulation) |
| `src/main.ts`, `src/ui/` | Browser UI: SVG board, card hand, animated dice, log |
| `tests/` | Vitest unit tests |
| `scripts/simulate.ts` | Headless simulation to check games finish |
