/**
 * ============================================================
 *  DIE BUILD DIE — GAME CONFIG
 *  Every tunable rule and every card lives in this one file.
 *  Change numbers here; the engine, UI and bots all read from it.
 * ============================================================
 */

export type Die = 4 | 6 | 8 | 10 | 12 | 20;

export type PieceKind = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

/** How a piece moves. Ranges are counted in steps along that line. */
export interface MoveRule {
  /** Steps along the 6 edge directions (rook lines). Sliding is blocked by any piece/base. */
  straight: number;
  /** Steps along the 6 hex diagonals (bishop lines). Blocked like straight moves. */
  diagonal: number;
  /** Can make a Glinski knight jump (12 hexes at distance 3, ignores blockers). */
  knightJump: boolean;
}

export interface PieceStats {
  kind: PieceKind;
  name: string;
  glyph: string;
  hp: number;
  die: Die;
  move: MoveRule;
  /** Attack range in hexes (1 = adjacent). */
  range: number;
}

export const PIECES: Record<PieceKind, PieceStats> = {
  pawn:   { kind: 'pawn',   name: 'Pawn',   glyph: '♟', hp: 4,  die: 4,  range: 1, move: { straight: 1, diagonal: 0, knightJump: false } },
  knight: { kind: 'knight', name: 'Knight', glyph: '♞', hp: 6,  die: 6,  range: 1, move: { straight: 0, diagonal: 0, knightJump: true } },
  bishop: { kind: 'bishop', name: 'Bishop', glyph: '♝', hp: 8,  die: 8,  range: 1, move: { straight: 0, diagonal: 2, knightJump: false } },
  rook:   { kind: 'rook',   name: 'Rook',   glyph: '♜', hp: 10, die: 10, range: 1, move: { straight: 3, diagonal: 0, knightJump: false } },
  queen:  { kind: 'queen',  name: 'Queen',  glyph: '♛', hp: 12, die: 12, range: 1, move: { straight: 3, diagonal: 2, knightJump: false } },
  king:   { kind: 'king',   name: 'King',   glyph: '♚', hp: 20, die: 20, range: 1, move: { straight: 1, diagonal: 1, knightJump: false } },
};

export type CardCategory = 'conjuration' | 'offense' | 'defense' | 'special';

/**
 * Card class: who may play it.
 *  conjuration – only your BASE (when the base is your unit this turn) — summons pieces
 *  pawn/knight/bishop/rook/queen – played by your selected piece; see CLASS_USERS.
 */
export type CardClass = 'conjuration' | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';

/** Which piece kinds may play each class of ability card. Kings can use everything. */
export const CLASS_USERS: Record<Exclude<CardClass, 'conjuration'>, PieceKind[]> = {
  pawn:   ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'], // Heal: any piece
  knight: ['knight', 'king'],
  bishop: ['bishop', 'queen', 'king'],
  rook:   ['rook', 'queen', 'king'],
  queen:  ['queen', 'king'],
};

/** What a card must be pointed at when played. Ranges are measured from the acting piece. */
export type Targeting =
  | 'none'                 // no target (Fortify, Rally)
  | 'self'                 // the acting piece (Sharpen, Frenzy, Haste, Recall)
  | 'summonHex'            // an empty hex on/next to your base
  | 'selfOrAdjacentFriend' // the acting piece or a friendly piece next to it (Heal, Shield)
  | 'friendlyPawnInRange'  // a friendly Pawn within `range` of the acting piece (Promote)
  | 'enemyInRange'         // enemy piece or base within `range` of the acting piece (Fire Bolt)
  | 'areaHex'              // any hex within `range` of the acting piece (Fireball)
  | 'arrows'               // `amount` arrows split among enemy PIECES within `range` (Cordon of Arrows)
  | 'enemyPieceInRange';   // one enemy PIECE within `range` of the acting piece (Armor Rend)

export type CardId =
  | 'summon_pawn' | 'summon_knight' | 'summon_bishop' | 'summon_rook' | 'summon_queen' | 'summon_king'
  | 'firebolt' | 'fireball' | 'sharpen' | 'frenzy'
  | 'shield' | 'heal' | 'fortify'
  | 'haste' | 'promote' | 'rally' | 'recall' | 'cordon'
  | 'gambeson' | 'breastplate' | 'plate' | 'armor_rend';

export type ArmorKind = 'gambeson' | 'breastplate' | 'plate';

/**
 * Armor reduces damage from each hit the piece takes (attacks, Fire Bolt, each arrow, Fireball).
 * Shield absorbs FIRST; armor then reduces whatever gets through. Armors don't stack:
 * equipping one replaces the old one. One-shot armor is used up by the next hit that gets past the shield.
 */
export const ARMORS: Record<ArmorKind, { name: string; reduce: number; oneShot: boolean; icon: string }> = {
  gambeson:    { name: 'Gambeson',    reduce: 2, oneShot: true,  icon: '🧥' },
  breastplate: { name: 'Breastplate', reduce: 4, oneShot: false, icon: '🦺' },
  plate:       { name: 'Plate Armor', reduce: 6, oneShot: false, icon: '🛡' },
};

export interface CardDef {
  id: CardId;
  name: string;
  cls: CardClass;
  category: CardCategory;
  cost: number;
  targeting: Targeting;
  text: string;
  /** Conjuration cards only. */
  summons?: PieceKind;
  /** Generic numeric parameters used by the effect. */
  amount?: number;
  dice?: { count: number; die: Die };
  range?: number;
  /** Area cards: blast radius around the target hex. */
  radius?: number;
  /** Copies of this card in each player's deck. */
  copies: number;
}

export const CARDS: Record<CardId, CardDef> = {
  // ---- Conjuration cards (played by your base) ----
  summon_pawn:   { id: 'summon_pawn',   name: 'Summon Pawn',   cls: 'conjuration', category: 'conjuration', cost: 1, targeting: 'summonHex', summons: 'pawn',   copies: 5, text: 'Summon a Pawn. 4 HP, d4. Moves 1 hex.' },
  summon_knight: { id: 'summon_knight', name: 'Summon Knight', cls: 'conjuration', category: 'conjuration', cost: 2, targeting: 'summonHex', summons: 'knight', copies: 4, text: 'Summon a Knight. 6 HP, d6. Jumps 3 hexes off-line (over anything).' },
  summon_bishop: { id: 'summon_bishop', name: 'Summon Bishop', cls: 'conjuration', category: 'conjuration', cost: 3, targeting: 'summonHex', summons: 'bishop', copies: 3, text: 'Summon a Bishop. 8 HP, d8. Slides up to 2 diagonal steps.' },
  summon_rook:   { id: 'summon_rook',   name: 'Summon Rook',   cls: 'conjuration', category: 'conjuration', cost: 4, targeting: 'summonHex', summons: 'rook',   copies: 3, text: 'Summon a Rook. 10 HP, d10. Slides up to 3 hexes in a line.' },
  summon_queen:  { id: 'summon_queen',  name: 'Summon Queen',  cls: 'conjuration', category: 'conjuration', cost: 5, targeting: 'summonHex', summons: 'queen',  copies: 2, text: 'Summon a Queen. 12 HP, d12. Rook or Bishop moves.' },
  summon_king:   { id: 'summon_king',   name: 'Summon King',   cls: 'conjuration', category: 'conjuration', cost: 6, targeting: 'summonHex', summons: 'king',   copies: 1, text: 'Summon a King. 20 HP, d20. Moves 1 step, straight or diagonal.' },

  // ---- Pawn card (any piece) ----
  heal:     { id: 'heal',     name: 'Heal',      cls: 'pawn',   category: 'defense', cost: 1, targeting: 'selfOrAdjacentFriend', dice: { count: 1, die: 6 }, copies: 4, text: 'Heal this piece or an adjacent friendly piece 1d6 HP (up to max).' },

  // ---- Knight cards (Knight, King) ----
  sharpen:  { id: 'sharpen',  name: 'Sharpen',   cls: 'knight', category: 'offense', cost: 1, targeting: 'self', amount: 2, copies: 3, text: 'This piece\'s next attack deals +2 damage.' },
  frenzy:   { id: 'frenzy',   name: 'Frenzy',    cls: 'knight', category: 'offense', cost: 2, targeting: 'self', amount: 1, copies: 2, text: 'This piece may attack one extra time this turn.' },
  cordon:   { id: 'cordon',   name: 'Cordon of Arrows', cls: 'knight', category: 'offense', cost: 4, targeting: 'arrows', amount: 4, range: 4, dice: { count: 1, die: 8 }, copies: 2, text: 'Shoot 4 arrows, split as you like among enemy pieces within 4 hexes. Each arrow deals 1d8.' },
  haste:    { id: 'haste',    name: 'Haste',     cls: 'knight', category: 'special', cost: 1, targeting: 'self', amount: 1, copies: 3, text: 'This piece may move one extra time this turn.' },

  // ---- Bishop cards (Bishop, Queen, King) ----
  firebolt: { id: 'firebolt', name: 'Fire Bolt', cls: 'bishop', category: 'offense', cost: 2, targeting: 'enemyInRange', range: 3, dice: { count: 2, die: 4 }, copies: 3, text: 'Deal 2d4 to an enemy piece or base within 3 hexes of this piece.' },
  fireball: { id: 'fireball', name: 'Fireball',  cls: 'bishop', category: 'offense', cost: 7, targeting: 'areaHex', range: 10, radius: 4, dice: { count: 8, die: 6 }, copies: 1, text: 'Pick a hex within 10 of this piece. Roll 8d6: EVERY piece (yours too) and base within 4 hexes takes it.' },
  armor_rend: { id: 'armor_rend', name: 'Armor Rend', cls: 'bishop', category: 'offense', cost: 3, targeting: 'enemyPieceInRange', range: 4, copies: 2, text: 'Strip all armor and shields from an enemy piece within 4 hexes of this piece.' },
  recall:   { id: 'recall',   name: 'Recall',    cls: 'bishop', category: 'special', cost: 1, targeting: 'self', amount: 2, copies: 2, text: 'Teleport this piece next to your base and heal it 2. A carried flag is dropped.' },

  // ---- Rook cards (Rook, Queen, King) ----
  shield:   { id: 'shield',   name: 'Shield',    cls: 'rook',   category: 'defense', cost: 1, targeting: 'selfOrAdjacentFriend', amount: 4, copies: 3, text: 'This piece or an adjacent friendly piece gains a 4-point damage shield.' },
  fortify:  { id: 'fortify',  name: 'Fortify',   cls: 'rook',   category: 'defense', cost: 2, targeting: 'none', amount: 6, copies: 2, text: 'Repair your base for 6 HP (up to its max).' },
  gambeson:    { id: 'gambeson',    name: 'Gambeson',    cls: 'rook', category: 'defense', cost: 1, targeting: 'self', copies: 3, text: 'Armor (replaces current): the next hit on this piece is reduced by up to 2, then it is gone.' },
  breastplate: { id: 'breastplate', name: 'Breastplate', cls: 'rook', category: 'defense', cost: 3, targeting: 'self', copies: 2, text: 'Armor (replaces current): every hit on this piece is reduced by 4.' },
  plate:       { id: 'plate',       name: 'Plate Armor', cls: 'rook', category: 'defense', cost: 5, targeting: 'self', copies: 1, text: 'Armor (replaces current): every hit on this piece is reduced by 6.' },
  rally:    { id: 'rally',    name: 'Rally',     cls: 'rook',   category: 'special', cost: 1, targeting: 'none', amount: 2, copies: 2, text: 'Draw 2 cards.' },

  // ---- Queen card (Queen, King) ----
  promote:  { id: 'promote',  name: 'Promote',   cls: 'queen',  category: 'special', cost: 2, targeting: 'friendlyPawnInRange', range: 3, copies: 2, text: 'Turn a friendly Pawn within 3 hexes into a full-HP Knight.' },
};

export function canClassBeUsedBy(cls: CardClass, kind: PieceKind): boolean {
  return cls !== 'conjuration' && CLASS_USERS[cls].includes(kind);
}

export const RULES = {
  /** Board is a hexagon of this radius; corners and centre are this far apart. */
  boardRadius: 10,
  minPlayers: 2,
  maxPlayers: 6,

  /** Which corners (0-5, clockwise from upper-left) are used for each player count. */
  seatCorners: {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
  } as Record<number, number[]>,

  baseHp: 20,
  startingPieces: ['pawn'] as PieceKind[],

  openingHand: 7,
  drawPerTurn: 1,
  /** Hand limit: whenever your hand goes above this, you must discard down to it before doing anything else. */
  handLimit: 7,

  /** Energy pays for cards. You refill to min(start + (turn-1) * perTurn, max) each turn. Unspent energy is lost. */
  energyStart: 2,
  energyPerTurn: 1,
  energyMax: 7,

  /** Freshly summoned pieces cannot be your unit until your next turn. */
  summoningSickness: true,
  /**
   * One unit per turn: you pick your BASE (play any number of conjuration cards you can afford)
   * or ONE piece, which may move, play cards and attack, in any order, up to these limits.
   */
  movesPerTurn: 1,
  attacksPerTurn: 1,
  cardsPerPieceTurn: 1,

  /**
   * Garrison: while one of its owner's pieces stands on a base, damage aimed at the base hits
   * that piece instead. Excess damage does NOT spill over onto the base.
   * In an area blast the garrison takes its own hit and the base behind it takes nothing.
   */
  garrisonAbsorbsBaseDamage: true,

  /**
   * Capture the flag: the flag starts on the centre hex. A piece that ENDS a move on it picks it up
   * (passing over it does nothing). Bring the carrier onto your own base hex to win. If the carrier
   * dies, the flag drops on its hex. Recall makes the carrier drop the flag where it stood.
   */
  flagStart: { q: 0, r: 0 },
  /** Also win by being the last player with a base standing. */
  lastBaseStandingWins: true,
};

export const PLAYER_COLORS = ['#e8505b', '#3d8bfd', '#3fbf6f', '#f2c14e', '#a46bf5', '#f08a3c'];
export const PLAYER_NAMES = ['Red', 'Blue', 'Green', 'Gold', 'Violet', 'Orange'];

export function buildDeckList(): CardId[] {
  const out: CardId[] = [];
  for (const def of Object.values(CARDS)) for (let i = 0; i < def.copies; i++) out.push(def.id);
  return out;
}
