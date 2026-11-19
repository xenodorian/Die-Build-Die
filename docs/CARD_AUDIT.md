# Card audit (v0.4, fix6)

Every card was checked three ways: the **card text**, what the **engine** actually does (`resolveCard` / `cardTargets` in `src/game/engine.ts`), and the **UI flow** (can you click the card, are targets lit, does the piece stay selected so you can keep acting). Each card has its own engine test in `tests/engine.test.ts` → *"card audit: every card does what its text says"* (a final test fails if a card is added to the deck without an audit test). The UI flows are covered by `scripts/ui-smoke.mjs` and `scripts/ui-smoke-fresh.mjs` (real clicks in Chrome).

## Problems found in the UI (affected every card)

| Problem | Effect for the player | Fix |
|---|---|---|
| Clicking an unplayable card did nothing | "I clicked Promote Pawn → Bishop and nothing happened" | Every card click now gives feedback: it starts targeting with targets lit, switches to the one piece that can play it, asks you to click the piece (if several can), or shows a toast with the exact reason, e.g. *"Only a Queen or King can play this, not a Pawn (and it needs 3 energy, you have 2)"* |
| While a card was waiting for a target, clicking one of your pieces only cancelled the card and the click was swallowed | "I click my pawn and can't move, it wants me to use a card." At turn start the summon cards glow (your base can play them); clicking one and then the pawn left the pawn unselected | A click that isn't a target cancels the card **and** is handled normally, so clicking the pawn selects it with its moves lit. Summon cards no longer glow while a piece is selected. A **🏰 Base** button selects the base. Move hexes are now outlined, not just small dots |
| After Frenzy/Haste the second attack/move was available in the engine but the user expected Frenzy to give a second **move** | "I clicked Frenzy but couldn't move my knight twice" | Text clarified: Frenzy = 2 attacks, Haste = 2 moves. UI test confirms the 2nd attack (Frenzy) and 2nd move (Haste) are lit and work |

## Per card

| Card | Text | Engine / UI before | Fix |
|---|---|---|---|
| Summon Pawn / Knight / Bishop / Rook / Queen / King | Summon the piece on or next to your base | Correct. Pieces arrive with summoning sickness | Card glow no longer hijacks a selected piece (see above) |
| Heal | Heal this piece or an adjacent friend 1d6 | Could be played on a full-HP piece: energy and card wasted for nothing | Now needs a damaged target; if none, the toast says so |
| Sharpen | Next attack +2 | Correct (bonus consumed by the next attack) | — |
| Frenzy | One extra attack this turn | Correct: 2 attacks, no extra move | Text says it does not give an extra move (that is Haste) |
| Haste | One extra move this turn | Correct: 2 moves, no extra attack | Text says it does not give an extra attack (that is Frenzy) |
| Shackles | Equip; move onto a weaker enemy to capture it | Correct | — |
| Cordon of Arrows | 4 arrows, 1d8 each, enemy pieces within 4 | Correct. In arrow mode, clicks on your own pieces were eaten | Only enemy-piece clicks are taken as arrows; others fall through |
| Fire Bolt | 2d4 to an enemy piece/base within 3 | Correct | Esc / clicking elsewhere returns to the piece with everything re-lit |
| Fireball | 8d6 to everything within 2 of a hex within 5 | Correct (enemy bases resolved first) | — |
| Armor Rend | Strip armor and shields, range 4 | Correct | — |
| Necromancy | Raise the newest corpse next to this piece | Correct | Clear reason when no skull is adjacent |
| Recall | Teleport **next to** your base, heal 2 | Put the piece on the base hex itself | Lands on a free neighbouring hex; base hex only if all are full |
| Shield | +4 shield on this or an adjacent friend | Correct | — |
| Fortify | Repair base 6 | Correct | — |
| Gambeson / Breastplate / Plate | Armor (soak 4 / −4 per hit / −6 per hit) | Correct | — |
| Rally | Draw 2 | Correct (hand limit checked at end of turn) | — |
| Promote (all 6) | Queen/King turns a friendly piece within 3 into the next type | Correct, but clicking it with a Pawn selected / no Queen silently did nothing | Clicking now picks the Queen/King automatically (or tells you who can play it and what energy is needed); all 6 verified in Chrome |
