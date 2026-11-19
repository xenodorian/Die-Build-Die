# UX audit and overhaul (v0.5)

The player reported: *"I can't end my turn or move a piece, this game is fundamentally broken… anti-user."* Their screenshot showed round 3 with 8 cards in hand, the panel saying *"You have 8 cards — click a card in your hand to discard (limit 7)"*, the Bishop already moved, and the base auto-picked earlier in the turn.

## Method
`scripts/ux-audit.mjs` plays the live game as a naive human using **real mouse clicks only**. Each turn it:
1. tries each of its pieces in turn;
2. clicks a summon card;
3. clicks **End turn** once.

It logs every click that was blocked (silently or behind a hidden state), every hijack, and every dead click. It ran against the live v0.4 build (`d362575`, 8 rounds) and again against the overhauled build.

| Build | Silent / hidden blocks | Locks that explain themselves |
|---|---|---|
| v0.4 live (`d362575`) | **22 in 8 rounds** | 0 |
| v0.5 (this overhaul) | **0** | 7 (by design: one unit per turn, each one says why) |

The audit also covered:
- `scripts/ui-fullgames.mjs`: 3 full games vs Easy AI, real clicks only;
- `scripts/ui-overhaul.mjs`: targeted checks, plus every card played through the UI.

## Findings (v0.4), root causes first

| # | What the player saw | Root cause | Severity |
|---|---|---|---|
| 1 | **"I can't end my turn."** End turn with 8 cards did nothing visible. The turn did not pass, End turn greyed out, and a red banner asked for a discard. Every turn from round 2 on (7 of 8 audited turns). | **Hidden mandatory state**: ending a turn over the hand limit put the game into a `mustDiscard` mode. Only clicking cards in the hand would finish the turn. You draw 1 card per turn and start with 7, so any turn without a card play hit it. | Critical |
| 2 | **"I can't move a piece."** While the discard prompt was up, clicking a piece did nothing; even the reason toast was stale (from an earlier card). | The same `mustDiscard` mode swallowed every board click with no message. | Critical |
| 3 | After moving one piece, clicking another piece or the base did nothing, or showed a short toast at best. Summon cards went dim with only a hover-tooltip reason. | The **one-unit-per-turn** lock was invisible: no "you're using your Bishop" status, no lock marks on other units, nothing on the cards themselves. | High |
| 4 | **"It just prompts me to use a card."** At turn start the summon cards glowed (the base can play them). Clicking one auto-selected the base and entered targeting. | **Auto-selection plus modal targeting**: one card click silently switched the unit and armed a card. (Partly fixed in v0.4-fix6; the auto-switch remained and was not announced.) | High |
| 5 | Unsure what to do: the side panel mixed checklists, hints and a "Base" button, and nothing told you that picking a unit commits you once it acts. | No single "what can I do now" surface; the commit point was explained only in the rules. | Medium |
| 6 | A stale error toast ("Can't play Summon King…") stayed on screen into the next turns. | The toast timer outlived turn changes. | Low |
| 7 | Every unit pick was logged ("Red picks their Bishop…"), burying real actions in the log. | Selection was logged as if it were an action. | Low |
| 8 | Nothing moved: pieces teleported, damage appeared only in the log or a dice popup, and turn changes were easy to miss. | No action feedback on the board. | Medium |

## Changes (v0.5)
**Rule decision: one unit per turn is kept**, as the player asked. Everything below is about clarity within that rule.

- **End turn never blocks.** The `mustDiscard` state is gone from the engine. `endTurn` always passes the turn. Over the limit, the excess is discarded as part of ending the turn: cards you name (`discard: [...]`) first, then the **oldest**. The discards are listed in the log and in a toast.
  - Before you end, the status bar and the End turn button say what will be discarded ("End turn (discard 1)"), and those cards are tagged in the hand.
  - You can still ✕ any card yourself first (no confirm dialog).
  - Bots name their least useful cards.
- **Status bar** above the board: one sentence, always present, saying what you can do now and why other things are locked. Example: *"This turn you're using your ♝ Bishop. It can still attack. Other pieces and your base are 🔒 locked until next turn."*
- **Commit point made explicit:**
  - Before acting: *"♝ Bishop selected. Not committed yet: click another piece or the base to switch."*
  - After the first action, other units are dimmed with 🔒 (💤 for pieces summoned this turn), and the base is dimmed too. Clicking a locked unit explains why.
- **Undo** (U) for a plain move: no dice, capture or flag change, so nothing hidden was revealed. Undoing your first move also un-commits the unit.
- **Left Actions list:** a live list of the valid actions for the turn or the selected unit.
  - Move (*n hexes lit*), Attack (*n targets*), each playable card with its cost, Switch to base / another piece, Undo, End turn.
  - Clicking an item runs it. Hovering an item outlines the related hexes on the board.
  - Done items are greyed; locked items show the reason. Unplayable cards are grouped under *Not playable right now* with reasons.
- **Cards say why they're dimmed**, on the card itself (*"Base only: this turn you're using your Pawn"*, *"Needs 3⚡, you have 2"*, *"Only a Queen or King can play this"*). Cards that switch units first are marked *↪ switch & play*.
- **No hidden modal states:**
  - Targeting is cancelled by Esc, right-click, or clicking anything that isn't a target.
  - Clicking your own piece always selects it, or says why it can't be selected.
  - Clicking an enemy out of reach says why.
- **Discoverability:**
  - A first-turn "How a turn works" card (non-modal, in the sidebar; **?** reopens it).
  - Move/attack pips on each of your pieces.
  - Hover tooltips on pieces and bases.
  - An **attack preview** (damage range after shield/armor, kill chance).
  - Keyboard shortcuts: **E**/Enter, **1–9**, **B**, **U**, **Esc**, **?**.
  - A clearer current-player indicator (pulsing swatch, "(you)", ▶ in the player list, coloured header glow).
- **Animated feedback** (300–700 ms, never blocking input):
  - pieces slide;
  - damage, heals, shields and armor float up from the board;
  - impact, heal, shield and summon rings;
  - Fireball blast and arrow/fire-bolt streaks;
  - summons scale in, deaths fade into a 💀;
  - banners for card plays and flag pickup/drop;
  - a "Your turn / Gold's turn" banner.

  A ✨/🐢 reduced-motion toggle is stored per browser; it defaults to the system setting.
- The log no longer records unit picks; stale toasts clear when your turn starts.

## Verification

| Check | Result |
|---|---|
| `ux-audit.mjs` on v0.5 | 0 silent blocks |
| `ui-fullgames.mjs` (3 full games vs Easy, real clicks) | All games finished. Each turn checks: End turn passes the turn (including over the limit, where the discards are logged), the status bar names the unit in use, other units are drawn locked, and clicking a locked piece explains why. 0 failures |
| `ui-overhaul.mjs` | 67 checks, including every card played through the UI. 0 failures |
| `ui-smoke.mjs` (6 action orders, round 1 and later), `ui-smoke-fresh.mjs` | Pass |
| Unit tests (`npm test`) | Pass, including new tests for End turn over the limit, named discards, and no discard within the limit |
