# Die Build Die — Rules (v0.5 prototype)

Chess pieces, a deck of cards and a fistful of dice on a hexagonal board.
Every number below lives in [`src/game/config.ts`](src/game/config.ts) — change it there and the game, bots and tests follow.

> **Rules marked 🟡 are prototype defaults** filled in to make the game playable. They are up for discussion.

## Game setup (v0.4)
- **You vs the AI:** pick your name, **1–5 AI opponents** (2–6 players in all) and an **AI difficulty**. 🟡 You always take the first seat and go first; the difficulty applies to every AI.
  - **Easy** — makes mistakes: about a third of the time it grabs a random unit, it misjudges which unit is best, and it sometimes stops a turn early.
  - **Normal** — plays out every unit it could use this turn and picks the best result.
  - **Hard** — plans further ahead than Normal:
    - For each action it shortlists the best few and plays each one to the end of the turn with different dice. It rolls out every unit twice.
    - It weighs what each enemy could do on its next turn: melee kill chances, Shackles captures, and likely Fire Bolt and Cordon of Arrows. It never peeks at hands; it guesses from the enemy's energy and hand size.
    - It protects its pieces and especially its flag carrier.
  - The AIs never see your hand or future dice.
- **Mode** (only with 2+ AI opponents):
  - **⚔ Free for All** — every AI does what's best for itself: it fights you *or* the other AIs and races for the flag.
  - **🐺 Dogpile** — the AIs team up against you. They hunt your pieces, chase your flag carrier and go for your base, and they don't attack each other (except by accident, e.g. Fireball splash). 🟡 An AI can still win normally by carrying the flag home. 🟡 **If you're knocked out, you lose immediately** and the AIs win together. You're knocked out when your base falls and you have no King or Rook, or when your base is in ruins and you lose your last King or Rook.
- **Pass-and-play** (optional): add extra human players on the same device; Dogpile then targets all humans, and the AIs win only when every human base is gone.
- The top bar shows the difficulty and mode (e.g. `🤖 Hard · 🐺 Dogpile`).

## Board & setup
- The board is a **hexagon of radius 5** (91 hexes). The **centre hex** is exactly **5 hexes** from each of the **6 corners**. The **🚩 flag** starts on the centre hex.
- **2–6 players.** Each player starts in a corner with their **base** 🏰 (20 HP) on the corner hex and **one Pawn** standing on it.
- 🟡 Corners used: 2 players → opposite corners; 3 → every other corner; 4 → two opposite pairs; 5 → five corners; 6 → all.

## Your turn
1. **Draw.** On your **first turn you draw 7 cards**; every later turn you **draw 1**.
   - **Hand limit 7.** 🟡 The limit is checked **when you end your turn**, and **End turn always ends the turn**: if you hold more than 7, your **last** (newest) extra cards are discarded automatically and listed in the log. A big hand never stops you from acting, and playing a card first may mean nothing is discarded.
   - 🟡 You may discard any card yourself at any time on your turn (the ✕ on a card), e.g. to keep an old card and drop a newer one. The cards End turn would discard are marked *"discarded at end of turn"* in your hand.
   - 🟡 When your deck is empty, your discard pile is shuffled into a new deck.
2. **Energy.** You get **2 energy on your first turn, +1 each turn, up to 7**. Unspent energy is lost. Card costs run 1–7; **Fireball is the only 7**.
3. **Pick ONE unit** for the whole turn — your **base** or **one piece**:
   - **Base:** play **conjuration cards** to summon pieces on or next to your base — 🟡 as many as your energy pays for.
   - **Piece:** it may **move once, play one card, and attack once, in any order** (e.g. attack, then move away).
   - Your other units do nothing this turn.
   - 🟡 You can switch your pick freely until the unit **does something**; then it is locked in.
   - 🟡 **On screen:** see [Playing on screen](#playing-on-screen).
4. **End turn.** Always available; it never asks you for anything first.

## Playing on screen
- **Status bar** (above the board): one sentence that always says what you can do right now, and why other things are locked (e.g. *"This turn you're using your ♝ Bishop. Other pieces and your base are 🔒 locked until next turn."*).
- **Actions list** (left): every valid action right now for your unit: Move (*n hexes lit*), Attack (*n targets*), each playable card with its cost, switching units (before you act), Undo, End turn. Click an item to do it; **hover it to see it on the board**. Cards you can't play are listed under *Not playable right now* with the reason.
- **Picking a unit:** units you can pick glow. Clicking one selects it and lights its move hexes (outlined), attack targets (red) and playable cards (bright) all at once. Until its **first action** you can switch freely (click another piece, your base, or press **B**); after that the other units are drawn dimmed with 🔒 (💤 for pieces summoned this turn), and clicking one explains why.
- **Pips:** each of your pieces shows two small dots above it: white = move left, red = attack left (hollow = used).
- **Cards:** dimmed cards say on the card why they can't be played (*"Base only: this turn you're using your Pawn"*, *"Needs 3⚡, you have 2"*, *"Only a Queen or King can play this"*). A card marked *↪ switch & play* switches to the unit that can play it (only before you act).
- **Targeting is never a trap:** clicking a card lights its targets; click a target to play it. **Esc**, **right-click** or clicking anywhere else cancels; clicking one of your pieces selects it.
- **Hover** any piece for HP, die, armor and actions left; hover an enemy in reach to see the **attack preview** (damage range after shield/armor and kill chance).
- **Undo** (**U**): a plain move (no dice, no capture, nothing revealed) can be undone, which also un-commits your unit if it was the first action.
- **Keys:** **E**/Enter end turn · **1–9** play card 1–9 · **B** base · **U** undo move · **Esc**/right-click cancel · **?** help.
- **Effects:** pieces slide when they move; damage and heals float up from the board; card plays, flag pickups/drops and turn changes show short banners; summons scale in, deaths fade into a 💀. The ✨ button switches to **reduced motion** (also follows your system setting).
- A short **"How a turn works"** card appears on your first turn (reopen it with **?**).

## Pieces
Damage is rolled on the piece's die. Attacks always hit and reach **adjacent** hexes (range 1).

| Piece | HP | Damage | Movement | Conjuration cost |
|---|---|---|---|---|
| ♟ Pawn | 4 | d4 | 1 hex in any of the 6 directions | 1 |
| ♞ Knight | 6 | d6 | Jumps to any of the 12 hexes 3 away that aren't in a straight line; jumps over anything | 2 |
| ♝ Bishop | 8 | d8 | 🟡 Slides **up to 4 hexes in any of the 6 directions** | 3 |
| ♜ Rook | 10 | d10 | 🟡 Slides **up to 4 hexes in any of the 6 directions** | 4 |
| ♛ Queen | 12 | d12 | 🟡 Slides **any distance in any of the 6 directions** (to the board edge or the first blocker) | 5 |
| ♚ King | 20 | d20 | 1 step straight or diagonal | 6 |

- 🟡 Hexes have no clean rook/bishop (orthogonal/diagonal) split, so Rook and Bishop now move alike (up to 4) and the Queen stands out with unlimited range. Values live in `src/game/config.ts` (`SLIDE_RANGE`, `QUEEN_SLIDE_RANGE`).
- Sliding pieces are blocked by anything in their path. 🟡 A piece only picks up the flag by **landing** on its hex; sliding over it doesn't count. Nobody can stop on an occupied hex or an enemy base.
- New pieces can't be picked as your unit until your next turn (you used the base this turn anyway).
- A piece at 0 HP is removed.

## Cards
Each player has their own **66-card deck**: 18 conjurations + 48 ability cards.
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
| ✚ Heal | Pawn | **any piece** | 1 | 4 | 🟡 Heal **this piece or an adjacent friendly piece** 1d6 (up to max). 🟡 The target must be damaged |
| 🗡️ Sharpen | Knight | Knight, King | 1 | 3 | This piece's next attack deals +2 |
| ⚔️ Frenzy | Knight | Knight, King | 2 | 2 | This piece may attack one extra time this turn (2 attacks). **Not** an extra move: that is Haste |
| 💨 Haste | Knight | Knight, King | 1 | 3 | This piece may move one extra time this turn (2 moves). **Not** an extra attack: that is Frenzy |
| ⛓ Shackles | Knight | Knight, King | 2 | 2 | Equip this piece. While equipped it may **move onto an enemy piece whose current HP is less than its own**: that piece is **captured** (removed from the board, not killed) and held **prisoner at your base** |
| 🏹 Cordon of Arrows | Knight | Knight, King | 4 | 2 | Shoot **4 arrows**, split however you like among **enemy pieces** within **4 hexes** of this piece. Each arrow deals **1d8**, rolled separately |
| 🔥 Fire Bolt | Bishop | Bishop, Queen, King | 2 | 3 | Deal 2d4 to an enemy piece or base within 3 hexes of this piece |
| ☄️ Fireball | Bishop | Bishop, Queen, King | **7** | 1 | Pick any hex within **5** of this piece. Roll **8d6** once: **every** piece within **2 hexes** of it (19 hexes) — **yours too, even the caster** — and every base there takes that much |
| 🔨 Armor Rend | Bishop | Bishop, Queen, King | 3 | 2 | Remove all armor **and** shields from one enemy piece 🟡 within **4 hexes** of this piece |
| 💀 Necromancy | Bishop | Bishop, Queen, King | 3 | 🟡 2 | Raise a dead piece whose **💀 skull is next to this piece**: it returns **on its skull hex** (must be empty) at **full HP**. 🟡 An **enemy** corpse rises on **your** side. 🟡 It can't act until your next turn |
| ↩️ Recall | Bishop | Bishop, Queen, King | 1 | 2 | Teleport this piece to an 🟡 **empty hex next to** your base (onto the base hex only if none is free) and heal it 2. A carried flag is dropped where it stood |
| 🛡️ Shield | Rook | Rook, Queen, King | 1 | 3 | 🟡 **This piece or an adjacent friendly piece** gains a 4-point shield that absorbs damage until used up |
| 🧥 Gambeson | Rook | Rook, Queen, King | 1 | 3 | Armor on this piece: soaks up the next **4 damage in total** (across any number of hits), then it's gone |
| 🦺 Breastplate | Rook | Rook, Queen, King | 3 | 2 | Armor on this piece: **every** hit is reduced by 4 |
| 🛡 Plate Armor | Rook | Rook, Queen, King | 5 | 1 | Armor on this piece: **every** hit is reduced by 6 |
| 🏰 Fortify | Rook | Rook, Queen, King | 2 | 2 | Repair your base 6 HP (up to 20) |
| 🎴 Rally | Rook | Rook, Queen, King | 1 | 2 | Draw 2 cards (discard down to 7 at the end of your turn if needed) |
| ⬆️ Promote: Pawn → Knight | Queen | Queen, King | 🟡 2 | 🟡 2 | Turn a friendly **Pawn within 3 hexes** of this piece into a full-HP **Knight** |
| ⬆️ Promote: Pawn → Bishop | Queen | Queen, King | 🟡 3 | 🟡 2 | Friendly **Pawn** within 3 → full-HP **Bishop** |
| ⬆️ Promote: Pawn → Rook | Queen | Queen, King | 🟡 4 | 🟡 2 | Friendly **Pawn** within 3 → full-HP **Rook** |
| ⬆️ Promote: Bishop → Queen | Queen | Queen, King | 🟡 5 | 🟡 1 | Friendly **Bishop** within 3 → full-HP **Queen** |
| 👑 Promote: Knight → King | Queen | Queen, King | 🟡 6 | 🟡 1 | Friendly **Knight** within 3 → full-HP **King** |
| 👑 Promote: Rook → King | Queen | Queen, King | 🟡 6 | 🟡 1 | Friendly **Rook** within 3 → full-HP **King** |

**Armor:** a piece wears at most one armor; equipping another **replaces** it (Gambeson ↔ Breastplate ↔ Plate). The armor goes on the piece that plays the card. A **Shield stacks with any armor**: the **shield absorbs first, then armor** handles whatever gets through. Armor Rend strips both.
🟡 Armor works against **every hit**: attacks, Fire Bolt, Fireball, and **each arrow separately**. Damage aimed at a base and taken by the piece standing on it is reduced by that piece's armor too.

🟡 **Cordon of Arrows details:** only enemy **pieces** can be targets (not bases). You assign all 4 arrows before rolling; an arrow aimed at a piece that an earlier arrow already killed is wasted. Shields absorb arrows normally.

🟡 **Fireball details:** range 5, blast radius 2 (the target hex and two rings around it). One 8d6 roll (average 28) hits everything in the blast. Shields absorb it as usual. A base inside the blast takes the damage unless a piece is standing on it (see Bases). You can blow up your own base; if you do, you're out and your turn ends. Enemy bases are hit before yours, so a blast that knocks out the last enemy still wins.

🟡 **Shackles details:**
- 🟡 One use: the shackles are used up by the capture. Equipping costs the card play; the capture **is** the piece's move (normal movement rules: a Knight jumps onto the victim's hex, sliders can take the first piece in their line).
- 🟡 Needs **strictly less** current HP (shields and armor don't count). 🟡 Armor Rend does not remove shackles.
- 🟡 You can't capture a piece standing on an enemy base hex.
- A captured **flag carrier** drops the flag on its hex, and since the captor lands there, the captor picks it up.
- Prisoners are listed (⛓) in the players panel. They are not pieces: nothing can target, heal or count them.
- 🟡 If the captor's base is destroyed and the game goes on, all its prisoners are freed and return next to their own base (or are lost if that player is out or every spot is full). Prisoners of an eliminated player are removed.
- On screen: capturable pieces get a dashed purple ring ⛓. Clicking one captures it; **Shift+click** attacks it instead (only matters for a King, which can do both).

🟡 **Promotion details:** these six are the only promotions. The promoted piece gets the new type's full HP (and its die and movement) and keeps its shield, armor, shackles, Sharpen bonus, the flag, and any move/attack it hasn't used this turn. The caster can't promote itself. A piece promoted to a Rook or King counts as a builder for a ruined base.

**💀 Skulls:** every piece that dies leaves a skull on its hex, marked with its owner's colour and remembering its type. Skulls are only markers: anything can move over or onto them. Several deaths on one hex stack up, and Necromancy raises the most recent one. Captured prisoners aren't dead and leave no skull. 🟡 Pieces removed because their player was knocked out leave no skull. 🟡 A corpse raised onto the flag's hex picks up the flag.

See **[docs/CARD_AUDIT.md](docs/CARD_AUDIT.md)** for the card-by-card audit (text vs engine vs UI) and its tests.

## Bases
- Bases have 20 HP and can be attacked by adjacent enemy pieces and by Fire Bolt and Fireball.
- **A piece standing on its own base takes the damage instead.** The base only takes damage once that piece moves off or is destroyed.
  - 🟡 Leftover damage does **not** spill over: if a 10-damage hit kills a 4-HP pawn on the base, the base takes nothing.
  - 🟡 In a Fireball blast, that piece takes its own hit once and the base behind it takes nothing (even if the piece dies).
- **A base at 0 HP is destroyed.**
  - If that player has **no King and no Rook** on the board, they are **out**: all their pieces are removed (a carried flag drops).
  - If they have a **King or Rook**, they stay in with a **🏚 ruined base**.
- **Ruined base:**
  - 🟡 You can't pick the base as your unit (no conjurations) and Fortify can't be played.
  - 🟡 You can't score the flag there until it's rebuilt.
  - It can't be attacked. 🟡 Enemies still can't stand on its hex.
  - Prisoners held there are freed when it falls.
- **Rebuilding:** a King or Rook standing on the ruined base hex can press **🔨 Rebuild** as its action for the turn. 🟡 This uses its attack and any move it has left; it may move onto the hex first and play a card.
  - Each Rebuild rolls **1d8** of progress, and progress adds up.
  - At **20** the base is rebuilt and active again with full HP. If the builder is carrying the flag, that scores immediately.
  - 🟡 Attacks hit the builder standing there (the ruin itself can't be damaged), and progress is never lost.
- If a ruined player loses their **last King and Rook**, they are out.

## Winning — capture the flag
- 🚩 The flag starts on the centre hex.
- **Picking it up:** a piece must **end its move on the flag's hex** (land on it). Passing over it does nothing. 🟡 A piece summoned onto the flag's hex also picks it up.
- **Carrying:** the carrier moves and fights normally (it has a red ring and a 🚩).
- **Dropping:** if the carrier is destroyed, the flag drops on the hex where it died; anyone can pick it up. Recall makes the carrier drop it where it stood.
- **Win:** move your carrier **onto your own base hex**. 🟡 Your base hex must be empty, so a piece on it has to step aside to let the carrier in.
- **Second way to win — last active base standing:** the game ends as soon as only **one player has an active (not ruined) base**, and that player wins, even if someone else is still rebuilding. 🟡 In a 2-player game, ruins therefore never come into play: destroying the other base wins. 🟡 If one blast leaves nobody with an active base, the player whose turn it is wins.

## Playing the prototype
- One human vs AI by default; extra pass-and-play humans can share the device. With 2+ humans, a hand-off screen hides each hand until its owner clicks "Show my hand" (can be turned off at setup).
- **Pick your unit:** click a glowing piece, or click **"🏰 Use my base"** (or your empty base hex). You can also just **click a card**: until your unit has acted, clicking a card your current pick can't use switches to the unit that can (if several pieces could, they light up so you can choose). Cards you can reach this way have a dashed outline. Your unit has a gold ring; the rest of your pieces fade once it has acted.
- **Act:** with a piece picked, white dots are moves and red hexes are attacks. **Move, attack and play one card in any order**; the piece stays picked until you end the turn. The side panel lists what it can still do (● available, ✓ done, ○ not possible right now, with the reason). Cards it can't play are greyed; hover any card to see which pieces can play it and why it's blocked.
- **Fireball:** hover to preview the blast. **Cordon of Arrows:** click enemy pieces to assign arrows (a counter shows on each), then **Fire!** (or Reset).
- **Over the hand limit when you end your turn:** your hand turns red; click the card(s) to discard and the turn passes.
- **Esc** cancels a card, **Enter** ends the turn.
