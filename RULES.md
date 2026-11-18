# Die Build Die — Rules (v0.3 prototype)

Chess pieces, a deck of cards and a fistful of dice on a hexagonal board.
Every number below lives in [`src/game/config.ts`](src/game/config.ts) — change it there and the game, bots and tests follow.

> **Rules marked 🟡 are prototype defaults** filled in to make the game playable. They are up for discussion.

## Board & setup
- The board is a **hexagon of radius 10** (331 hexes). The **centre hex** is exactly **10 hexes** from each of the **6 corners**. The **🚩 flag** starts on the centre hex.
- **2–6 players.** Each player starts in a corner with their **base** 🏰 (20 HP) on the corner hex and **one Pawn** standing on it.
- 🟡 Corners used: 2 players → opposite corners; 3 → every other corner; 4 → two opposite pairs; 5 → five corners; 6 → all.

## Your turn
1. **Draw.** On your **first turn you draw 7 cards**; every later turn you **draw 1**.
   - **Hand limit 7.** Whenever your hand goes above 7 (your draw, or Rally), you must **choose a card to discard** before doing anything else.
   - 🟡 You may also discard any card at any time on your turn (the ✕ on a card).
   - 🟡 When your deck is empty, your discard pile is shuffled into a new deck.
2. **Energy.** You get **2 energy on your first turn, +1 each turn, up to 7**. Unspent energy is lost. Card costs run 1–7; **Fireball is the only 7**.
3. **Pick ONE unit** for the whole turn — your **base** or **one piece**:
   - **Base:** play **conjuration cards** to summon pieces on or next to your base — 🟡 as many as your energy pays for.
   - **Piece:** it may **move once, play one card, and attack once, in any order** (e.g. attack, then move away).
   - Your other units do nothing this turn.
   - 🟡 You can switch your pick freely until the unit **does something**; then it is locked in.
4. **End turn.**

## Pieces
Damage is rolled on the piece's die. Attacks always hit and reach **adjacent** hexes (range 1).

| Piece | HP | Damage | Movement | Conjuration cost |
|---|---|---|---|---|
| ♟ Pawn | 4 | d4 | 1 hex in any of the 6 directions | 1 |
| ♞ Knight | 6 | d6 | Jumps to any of the 12 hexes 3 away that aren't in a straight line; jumps over anything | 2 |
| ♝ Bishop | 8 | d8 | Slides up to 2 diagonal steps | 3 |
| ♜ Rook | 10 | d10 | Slides up to 3 hexes in a line | 4 |
| ♛ Queen | 12 | d12 | Rook or Bishop movement | 5 |
| ♚ King | 20 | d20 | 1 step straight or diagonal | 6 |

- Sliding pieces are blocked by anything in their path. Nobody can stop on an occupied hex or an enemy base.
- New pieces can't be picked as your unit until your next turn (you used the base this turn anyway).
- A piece at 0 HP is removed.

## Cards
Each player has their own **55-card deck**: 18 conjurations + 37 ability cards.
Every ability card belongs to a piece **class**, and only the right pieces can play it. **Kings can play everything. Queens play Bishop, Rook and Queen cards (not Knight cards).** The card is played **by your selected piece**; ranges are measured from that piece.

### Conjuration cards (played by your base)
| Card | Cost | Copies | Effect |
|---|---|---|---|
| Summon Pawn | 1 | 5 | Summon a Pawn on or next to your base |
| Summon Knight | 2 | 4 | Summon a Knight |
| Summon Bishop | 3 | 3 | Summon a Bishop |
| Summon Rook | 4 | 3 | Summon a Rook |
| Summon Queen | 5 | 2 | Summon a Queen |
| Summon King | 6 | 1 | Summon a King |

### Ability cards
| Card | Class | Who can play it | Cost | Copies | Effect |
|---|---|---|---|---|---|
| ✚ Heal | Pawn | **any piece** | 1 | 4 | 🟡 Heal **this piece or an adjacent friendly piece** 1d6 (up to max) |
| 🗡️ Sharpen | Knight | Knight, King | 1 | 3 | This piece's next attack deals +2 |
| ⚔️ Frenzy | Knight | Knight, King | 2 | 2 | This piece may attack one extra time this turn |
| 💨 Haste | Knight | Knight, King | 1 | 3 | This piece may move one extra time this turn |
| 🏹 Cordon of Arrows | Knight | Knight, King | 4 | 2 | Shoot **4 arrows**, split however you like among **enemy pieces** within **4 hexes** of this piece. Each arrow deals **1d8**, rolled separately |
| 🔥 Fire Bolt | Bishop | Bishop, Queen, King | 2 | 3 | Deal 2d4 to an enemy piece or base within 3 hexes of this piece |
| ☄️ Fireball | Bishop | Bishop, Queen, King | **7** | 1 | Pick any hex within **10** of this piece. Roll **8d6** once: **every** piece within **4 hexes** of it — **yours too, even the caster** — and every base there takes that much |
| 🔨 Armor Rend | Bishop | Bishop, Queen, King | 3 | 2 | Remove all armor **and** shields from one enemy piece 🟡 within **4 hexes** of this piece |
| ↩️ Recall | Bishop | Bishop, Queen, King | 1 | 2 | Teleport this piece next to your base and heal it 2. A carried flag is dropped where it stood |
| 🛡️ Shield | Rook | Rook, Queen, King | 1 | 3 | 🟡 **This piece or an adjacent friendly piece** gains a 4-point shield that absorbs damage until used up |
| 🧥 Gambeson | Rook | Rook, Queen, King | 1 | 3 | Armor on this piece: the **next** hit is reduced by up to 2, then it's gone |
| 🦺 Breastplate | Rook | Rook, Queen, King | 3 | 2 | Armor on this piece: **every** hit is reduced by 4 |
| 🛡 Plate Armor | Rook | Rook, Queen, King | 5 | 1 | Armor on this piece: **every** hit is reduced by 6 |
| 🏰 Fortify | Rook | Rook, Queen, King | 2 | 2 | Repair your base 6 HP (up to 20) |
| 🎴 Rally | Rook | Rook, Queen, King | 1 | 2 | Draw 2 cards (then discard down to 7 if needed) |
| ⬆️ Promote | Queen | Queen, King | 2 | 2 | 🟡 Turn a friendly **Pawn within 3 hexes** of this piece into a full-HP Knight |

**Armor:** a piece wears at most one armor; equipping another **replaces** it. The armor goes on the piece that plays the card. **Shield absorbs first, then armor reduces whatever gets through.**
🟡 Armor works against **every hit**: attacks, Fire Bolt, Fireball, and **each arrow separately**. Gambeson is used up by the next hit that gets past the shield (a hit fully soaked by the shield doesn't use it). Damage aimed at a base and taken by the piece standing on it is reduced by that piece's armor too.

🟡 **Cordon of Arrows details:** only enemy **pieces** can be targets (not bases). You assign all 4 arrows before rolling; an arrow aimed at a piece that an earlier arrow already killed is wasted. Shields absorb arrows normally.

🟡 **Fireball details:** one 8d6 roll (average 28) hits everything in the blast. Shields absorb it as usual. A base inside the blast takes the damage unless a piece is standing on it (see Bases). You can blow up your own base; if you do, you're out and your turn ends. Enemy bases are hit before yours, so a blast that knocks out the last enemy still wins.

## Bases
- Bases have 20 HP and can be attacked by adjacent enemy pieces and by Fire Bolt and Fireball.
- **A piece standing on its own base takes the damage instead.** The base only takes damage once that piece moves off or is destroyed.
  - 🟡 Leftover damage does **not** spill over: if a 10-damage hit kills a 4-HP pawn on the base, the base takes nothing.
  - 🟡 In a Fireball blast, that piece takes its own hit once and the base behind it takes nothing (even if the piece dies).
- A base at 0 HP is destroyed: that player is **eliminated** and all their pieces are removed (a carried flag drops).

## Winning — capture the flag
- 🚩 The flag starts on the centre hex.
- **Picking it up:** a piece must **end its move on the flag's hex** (land on it). Passing over it does nothing. 🟡 A piece summoned onto the flag's hex also picks it up.
- **Carrying:** the carrier moves and fights normally (it has a red ring and a 🚩).
- **Dropping:** if the carrier is destroyed, the flag drops on the hex where it died; anyone can pick it up. Recall makes the carrier drop it where it stood.
- **Win:** move your carrier **onto your own base hex**. 🟡 Your base hex must be empty, so a piece on it has to step aside to let the carrier in.
- **Second way to win — last base standing:** if every other base is destroyed, you win.

## Playing the prototype
- Hot-seat on one device. Any seat can be a 🤖 bot. With 2+ humans, a hand-off screen hides each hand until its owner clicks "Show my hand" (can be turned off at setup).
- **Pick your unit:** click a glowing piece, or click **"🏰 Use my base"** (or your empty base hex). Your unit has a gold ring; the rest of your pieces fade once it has acted.
- **Act:** with a piece picked, white dots are moves and red hexes are attacks. Cards it can't play are greyed; hover any card to see which pieces can play it and why it's blocked.
- **Fireball:** hover to preview the blast. **Cordon of Arrows:** click enemy pieces to assign arrows (a counter shows on each), then **Fire!** (or Reset).
- **Over the hand limit:** your hand turns red; click the card(s) to discard.
- **Esc** cancels a card, **Enter** ends the turn.
