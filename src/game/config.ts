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

export type CardCategory = 'piece' | 'offense' | 'defense' | 'special';

/** What a card must be pointed at when played. */
export type Targeting =
  | 'none'
  | 'summonHex'      // an empty hex on/next to your base
  | 'friendlyPiece'
  | 'friendlyPawn'
  | 'enemyInRange'   // enemy piece or base within `range` of one of your pieces
  | 'areaHex';       // any hex within `range` of one of your pieces listed in `castFrom`

export type CardId =
  | 'summon_pawn' | 'summon_knight' | 'summon_bishop' | 'summon_rook' | 'summon_queen' | 'summon_king'
  | 'firebolt' | 'fireball' | 'sharpen' | 'frenzy'
  | 'shield' | 'heal' | 'fortify'
  | 'haste' | 'promote' | 'rally' | 'recall';

export interface CardDef {
  id: CardId;
  name: string;
  category: CardCategory;
  cost: number;
  targeting: Targeting;
  text: string;
  /** Piece cards only. */
  summons?: PieceKind;
  /** Generic numeric parameters used by the effect. */
  amount?: number;
  dice?: { count: number; die: Die };
  range?: number;
  /** Area cards: blast radius around the target hex. */
  radius?: number;
  /** Area cards: which of your piece kinds the target must be within `range` of. */
  castFrom?: PieceKind[];
  /** Copies of this card in each player's deck. */
  copies: number;
}

export const CARDS: Record<CardId, CardDef> = {
  // ---- Piece cards (chess pieces: rising HP and damage die) ----
  summon_pawn:   { id: 'summon_pawn',   name: 'Pawn',   category: 'piece', cost: 1, targeting: 'summonHex', summons: 'pawn',   copies: 5, text: 'Summon a Pawn. 4 HP, d4. Moves 1 hex.' },
  summon_knight: { id: 'summon_knight', name: 'Knight', category: 'piece', cost: 2, targeting: 'summonHex', summons: 'knight', copies: 4, text: 'Summon a Knight. 6 HP, d6. Jumps 3 hexes off-line (over anything).' },
  summon_bishop: { id: 'summon_bishop', name: 'Bishop', category: 'piece', cost: 3, targeting: 'summonHex', summons: 'bishop', copies: 3, text: 'Summon a Bishop. 8 HP, d8. Slides up to 2 diagonal steps.' },
  summon_rook:   { id: 'summon_rook',   name: 'Rook',   category: 'piece', cost: 4, targeting: 'summonHex', summons: 'rook',   copies: 3, text: 'Summon a Rook. 10 HP, d10. Slides up to 3 hexes in a line.' },
  summon_queen:  { id: 'summon_queen',  name: 'Queen',  category: 'piece', cost: 5, targeting: 'summonHex', summons: 'queen',  copies: 2, text: 'Summon a Queen. 12 HP, d12. Rook or Bishop moves.' },
  summon_king:   { id: 'summon_king',   name: 'King',   category: 'piece', cost: 6, targeting: 'summonHex', summons: 'king',   copies: 1, text: 'Summon a King. 20 HP, d20. Moves 1 step, straight or diagonal.' },

  // ---- Offensive ----
  firebolt: { id: 'firebolt', name: 'Fire Bolt', category: 'offense', cost: 2, targeting: 'enemyInRange', range: 3, dice: { count: 2, die: 4 }, copies: 3, text: 'Deal 2d4 to an enemy piece or base within 3 hexes of one of your pieces.' },
  fireball: { id: 'fireball', name: 'Fireball', category: 'offense', cost: 7, targeting: 'areaHex', range: 10, radius: 4, castFrom: ['queen', 'bishop'], dice: { count: 8, die: 6 }, copies: 1, text: 'Pick a hex within 10 of your Queen or Bishop. Roll 8d6: EVERY piece (yours too) and base within 4 hexes takes it.' },
  sharpen:  { id: 'sharpen',  name: 'Sharpen',  category: 'offense', cost: 1, targeting: 'friendlyPiece', amount: 2, copies: 3, text: "Your piece's next attack deals +2 damage." },
  frenzy:   { id: 'frenzy',   name: 'Frenzy',   category: 'offense', cost: 2, targeting: 'friendlyPiece', amount: 1, copies: 2, text: 'Your piece may attack one extra time this turn.' },

  // ---- Defensive ----
  shield:  { id: 'shield',  name: 'Shield',  category: 'defense', cost: 1, targeting: 'friendlyPiece', amount: 4, copies: 3, text: 'Give your piece a 4-point shield that absorbs damage.' },
  heal:    { id: 'heal',    name: 'Heal',    category: 'defense', cost: 1, targeting: 'friendlyPiece', dice: { count: 1, die: 6 }, copies: 3, text: 'Restore 1d6 HP to your piece (up to its max).' },
  fortify: { id: 'fortify', name: 'Fortify', category: 'defense', cost: 2, targeting: 'none', amount: 6, copies: 2, text: 'Repair your base for 6 HP (up to its max).' },

  // ---- Special ----
  haste:   { id: 'haste',   name: 'Haste',   category: 'special', cost: 1, targeting: 'friendlyPiece', amount: 1, copies: 3, text: 'Your piece may move one extra time this turn.' },
  promote: { id: 'promote', name: 'Promote', category: 'special', cost: 2, targeting: 'friendlyPawn', copies: 2, text: 'Turn one of your Pawns into a full-HP Knight. It keeps any unused move/attack.' },
  rally:   { id: 'rally',   name: 'Rally',   category: 'special', cost: 1, targeting: 'none', amount: 2, copies: 2, text: 'Draw 2 cards.' },
  recall:  { id: 'recall',  name: 'Recall',  category: 'special', cost: 1, targeting: 'friendlyPiece', amount: 2, copies: 1, text: 'Teleport your piece back next to your base and heal it 2.' },
};

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
  /** Draws beyond this hand size are discarded ("burned"). */
  handLimit: 10,

  /** Energy pays for cards. You refill to min(start + (turn-1) * perTurn, max) each turn. Unspent energy is lost. */
  energyStart: 2,
  energyPerTurn: 1,
  energyMax: 7,

  /** Freshly summoned pieces cannot move or attack until your next turn. */
  summoningSickness: true,
  /** A piece may move, then attack. Attacking ends its movement. */
  movesPerTurn: 1,
  attacksPerTurn: 1,

  /**
   * Garrison: while one of its owner's pieces stands on a base, damage aimed at the base hits
   * that piece instead. Excess damage does NOT spill over onto the base.
   * In an area blast the garrison takes its own hit and the base behind it takes nothing.
   */
  garrisonAbsorbsBaseDamage: true,

  /**
   * Capture the flag: the flag starts on the centre hex. A piece that stops on it or slides
   * through it picks it up. Bring the carrier onto your own base hex to win. If the carrier dies,
   * the flag drops on its hex. Recall makes the carrier drop the flag where it stood.
   */
  flagStart: { q: 0, r: 0 },
  /** Sliding pieces (Rook/Bishop/Queen) grab the flag when they pass over it, not only when they stop on it. */
  flagPickupWhenPassing: true,
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
