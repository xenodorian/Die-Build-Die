# Die Build Die — Rules (v0.2 prototype)

Chess pieces, a deck of cards and a fistful of dice on a hexagonal board.
Every number below lives in [`src/game/config.ts`](src/game/config.ts) — change it there and the game, bots and tests follow.

> **Rules marked 🟡 are prototype defaults** that were filled in to make the game playable. They are up for discussion.

## Board & setup
- The board is a **hexagon of radius 10** (331 hexes). The **centre hex** is exactly **10 hexes** from each of the **6 corners**. The **🚩 flag** starts on the centre hex.
- **2–6 players.** Each player starts in a corner with their **base** 🏰 on the corner hex and **one Pawn** standing on the base.
- 🟡 Corners used: 2 players → opposite corners; 3 → every other corner; 4 → two opposite pairs; 5 → five corners; 6 → all.
- 🟡 Bases have **20 HP**.

## Turn order
On your turn:
1. **Draw.** On your **first turn you draw 7 cards**; every later turn you **draw 1**.
   - 🟡 Hand limit **10**: cards drawn past that are discarded ("burned"). You may **discard any card from your hand at any time** on your turn (the ✕ on a card) to make room.
   - 🟡 When your deck is empty, your discard pile is shuffled into a new deck.
2. **Energy.** You get energy to pay for cards: **2 on your first turn, +1 each turn, up to 7**. Unspent energy is lost. Card costs run 1–7; **Fireball is the only 7-cost card**.
3. **Act, in any order:**
   - Play any number of cards you can afford.
   - Each of your pieces may **move once, then attack once**. 🟡 Attacking ends that piece's movement.
4. Press **End turn** (or Enter).

## Pieces
Damage is rolled on the piece's die. Attacks always hit; all pieces attack **adjacent** hexes (range 1) only. *(Pieces, movement and the move-then-attack rule are confirmed.)*

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
| Card | Type | Cost | Copies | Effect |
|---|---|---|---|---|
| 🔥 Fire Bolt | Offense | 2 | 3 | Deal 2d4 to one enemy piece or base within 3 hexes of one of your pieces |
| 🗡️ Sharpen | Offense | 1 | 3 | Your piece's next attack deals +2 damage |
| ⚔️ Frenzy | Offense | 2 | 2 | Your piece may attack one extra time this turn |
| ☄️ **Fireball** | Offense | **7** | **1** | Requires one of your **Queens or Bishops**. Pick any hex within **10** of one of them. Roll **8d6** once: **every** piece within **4 hexes** of that hex — **yours included** — and every base there takes that much damage |
| 🛡️ Shield | Defense | 1 | 3 | Your piece gains a 4-point shield that absorbs damage (until used up) |
| ✚ Heal | Defense | 1 | 3 | Heal your piece 1d6 (up to its max) |
| 🏰 Fortify | Defense | 2 | 2 | Repair your base 6 HP (up to 20) |
| 💨 Haste | Special | 1 | 3 | Your piece may move one extra time this turn |
| ⬆️ Promote | Special | 2 | 2 | Turn your Pawn into a full-HP Knight (keeps any unused move/attack, and the flag) |
| 🎴 Rally | Special | 1 | 2 | Draw 2 cards |
| ↩️ Recall | Special | 1 | 1 | Teleport your piece next to your base and heal it 2. 🟡 A flag carrier drops the flag where it stood |

🟡 **Fireball details:** one 8d6 roll (avg 28) applies to everything in the blast, friend and foe. Shields absorb it as usual. A base inside the blast takes the damage unless it has a garrison (see Bases). You can blow up your own base; if you do, you are eliminated and your turn ends. Enemy bases resolve before yours, so a blast that knocks out the last enemy wins even if it also kills you.

🟡 **Deck:** each player has their own 43-card deck — 18 piece cards (5 Pawn, 4 Knight, 3 Bishop, 3 Rook, 2 Queen, 1 King) and 25 ability cards (above).

## Bases & garrisons
- Bases have 20 HP and can be attacked by adjacent enemy pieces, Fire Bolt and Fireball.
- **Garrison:** if one of the owner's pieces stands on its base, any damage aimed at the base **hits that piece instead**. The base only takes damage once that piece moves off or is destroyed.
  - 🟡 Excess damage does **not** spill over: if a 10-damage hit kills a 4-HP garrison pawn, the base takes nothing.
  - 🟡 In a Fireball blast the garrison takes its own hit once and the base behind it takes nothing (even if the garrison dies in that blast).
- A base at 0 HP is destroyed: that player is **eliminated** and all their pieces are removed (a carried flag drops).

## Winning — capture the flag
- 🚩 The flag starts on the centre hex.
- **Picking it up:** a piece that **stops on** the flag picks it up. 🟡 Sliding pieces (Rook, Bishop, Queen) also grab it when they **slide over** it. Knights only grab it by **landing** on it (they jump over everything else). 🟡 A piece summoned onto the flag's hex picks it up too.
- **Carrying:** the carrier moves and fights normally (it is ringed in red with a 🚩).
- **Dropping:** if the carrier is destroyed, the flag drops on the hex where it died, and anyone can pick it up. 🟡 Recall makes the carrier drop it where it stood.
- **Win:** move your carrier **onto your own base hex**. 🟡 Your base hex must be empty, so a garrison has to step aside to let the carrier in.
- **Secondary win — last base standing:** if every other base is destroyed, you win.

## Playing the prototype
- Hot-seat on one device. Any seat can be a 🤖 bot. With 2+ humans, a hand-off screen hides each hand until its owner clicks "Show my hand" (can be turned off at setup).
- Click a glowing piece to see moves (white dots) and attacks (red hexes). Click a card to play it; targets get a dashed outline. With Fireball selected, hovering a hex previews the blast and everything it would hit. Hover a card and click ✕ to discard it. **Esc** cancels, **Enter** ends the turn.
