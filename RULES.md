# Die Build Die — Rules (v0.1 prototype)

Chess pieces, a deck of cards and a fistful of dice on a hexagonal board.
Every number below lives in [`src/game/config.ts`](src/game/config.ts) — change it there and the game, bots and tests follow.

> **Rules marked 🟡 are prototype defaults** that were filled in to make the game playable. They are up for discussion.

## Board & setup
- The board is a **hexagon of radius 10** (331 hexes). The **centre hex ★** is exactly **10 hexes** from each of the **6 corners**.
- **2–6 players.** Each player starts in a corner with their **base** 🏰 on the corner hex and **one Pawn** standing on the base.
- 🟡 Corners used: 2 players → opposite corners; 3 → every other corner; 4 → two opposite pairs; 5 → five corners; 6 → all.
- 🟡 Bases have **20 HP**.

## Turn order
On your turn:
1. **Draw.** On your **first turn you draw 7 cards**; every later turn you **draw 1**.
   - 🟡 Hand limit **10**: cards drawn past that are discarded ("burned").
   - 🟡 When your deck is empty, your discard pile is shuffled into a new deck.
2. **Energy.** 🟡 You get energy to pay for cards: **2 on your first turn, +1 each turn, up to 6**. Unspent energy is lost.
3. **Act, in any order:**
   - Play any number of cards you can afford.
   - Each of your pieces may **move once, then attack once**. 🟡 Attacking ends that piece's movement.
4. Press **End turn** (or Enter).

## Pieces
Damage is rolled on the piece's die. 🟡 Attacks always hit; 🟡 all pieces attack **adjacent** hexes (range 1) only.

| Piece | HP | Damage | Movement | Card cost 🟡 |
|---|---|---|---|---|
| ♟ Pawn | 4 | d4 | 1 hex in any of the 6 directions | 1 |
| ♞ Knight | 6 | d6 | 🟡 **Jump** to any of the 12 hexes 3 away that are not in a straight line (Gliński hex-chess knight); jumps over anything | 2 |
| ♝ Bishop | 8 | d8 | 🟡 Slides up to **2 diagonal steps** (hex diagonals, between two neighbours) | 3 |
| ♜ Rook | 10 | d10 | 🟡 Slides up to **3 hexes** in a straight line | 4 |
| ♛ Queen | 12 | d12 | 🟡 Rook **or** Bishop movement | 5 |
| ♚ King | 20 | d20 | 🟡 1 step straight or 1 diagonal step | 6 |

- Sliding pieces are blocked by any piece or base in the way. Nobody can stop on an occupied hex.
- You can stand on your **own** base but never enter an enemy base hex.
- 🟡 **Summoning:** piece cards put the piece on your base hex, or on an empty hex next to it. 🟡 New pieces can't move or attack until your next turn (summoning sickness).
- When a piece reaches 0 HP it is removed.

## Ability cards
| Card | Type | Cost | Effect | Copies |
|---|---|---|---|---|
| 🔥 Fireball | Offense | 2 | 2d4 damage to an enemy piece or base within 3 hexes of one of your pieces | 3 |
| 🗡️ Sharpen | Offense | 1 | Your piece's next attack deals +2 | 3 |
| ⚔️ Frenzy | Offense | 2 | Your piece may attack one extra time this turn | 2 |
| 🛡️ Shield | Defense | 1 | Your piece gains a 4-point shield that absorbs damage | 3 |
| ✚ Heal | Defense | 1 | Heal your piece 1d6 (up to max) | 3 |
| 🏰 Fortify | Defense | 2 | Repair your base 6 HP (up to max) | 2 |
| 💨 Haste | Special | 1 | Your piece may move one extra time this turn | 3 |
| ⬆️ Promote | Special | 2 | Turn your Pawn into a full-HP Knight | 2 |
| 🎴 Rally | Special | 1 | Draw 2 cards | 2 |
| ↩️ Recall | Special | 1 | Teleport your piece next to your base and heal it 2 | 1 |

🟡 **Deck:** each player has their own 42-card deck — 18 piece cards (5 Pawn, 4 Knight, 3 Bishop, 3 Rook, 2 Queen, 1 King) and 24 ability cards (above).

## Bases
- 🟡 An enemy base can be attacked (or Fireballed) only when **none of its owner's pieces is standing on it** — a piece on your base guards it.
- A base at 0 HP is destroyed: that player is **eliminated** and all their pieces are removed.

## Winning
- 🟡 **Hold the centre:** if one of your pieces is on the centre hex ★ **at the start of your turn** (it survived a full round), you win.
  *Alternative in config:* `centerWin: 'enter'` — win the instant a piece steps onto the centre.
- 🟡 **Last base standing:** if every other base is destroyed, you win.

## Playing the prototype
- Hot-seat on one device. Any seat can be a 🤖 bot. With 2+ humans, a hand-off screen hides each hand until its owner clicks "Show my hand" (can be turned off at setup).
- Click a glowing piece to see moves (white dots) and attacks (red hexes). Click a card to play it; targets get a dashed outline. **Esc** cancels, **Enter** ends the turn.
