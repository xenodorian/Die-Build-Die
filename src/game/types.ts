import type { ArmorKind, CardId, Die, PieceKind } from './config';
import type { Hex } from './hex';

export interface Card {
  uid: number;
  id: CardId;
}

export interface Piece {
  id: number;
  owner: number;
  kind: PieceKind;
  pos: Hex;
  hp: number;
  maxHp: number;
  movesLeft: number;
  attacksLeft: number;
  shield: number;
  bonusDamage: number;
  /** Equipped armor (Rook cards); at most one. */
  armor?: ArmorKind | null;
  /** Points left in a pool armor (Gambeson). */
  armorPool?: number;
  /** Equipped with Shackles: may capture a weaker enemy piece by moving onto it (one use). */
  shackles?: boolean;
}

export interface Player {
  index: number;
  name: string;
  color: string;
  corner: number;
  base: Hex;
  baseHp: number;
  alive: boolean;
  isBot: boolean;
  difficulty: Difficulty;
  deck: Card[];
  hand: Card[];
  discard: Card[];
  energy: number;
  turnsTaken: number;
  /** Enemy pieces captured with Shackles, held at this player's base. */
  prisoners: Piece[];
  /** Base destroyed but the player still has a King or Rook: baseHp counts rebuild progress. */
  ruined: boolean;
}

export type Target =
  | { kind: 'piece'; id: number }
  | { kind: 'base'; owner: number }
  | { kind: 'hex'; hex: Hex };

/** The single unit a player acts with this turn. */
export type Unit = { kind: 'base' } | { kind: 'piece'; id: number };

export type Action =
  | { type: 'move'; pieceId: number; to: Hex }
  | { type: 'attack'; pieceId: number; target: Target }
  | { type: 'playCard'; cardUid: number; target?: Target; /** Cordon of Arrows: one enemy piece id per arrow (repeats allowed). */ arrows?: number[] }
  | { type: 'discard'; cardUid: number }
  | { type: 'selectUnit'; unit: Unit }
  /** A King or Rook standing on its owner's ruined base rolls 1d8 of rebuilding (uses its attack and move). */
  | { type: 'rebuild'; pieceId: number }
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'log'; text: string; player?: number }
  | { type: 'roll'; label: string; dice: Die[]; values: number[]; bonus: number; total: number; player: number }
  | { type: 'draw'; player: number; count: number; burned: number }
  | { type: 'turnStart'; player: number; round: number }
  | { type: 'pieceDied'; pieceId: number; owner: number }
  | { type: 'eliminated'; player: number }
  | { type: 'baseRuined'; player: number }
  | { type: 'baseRebuilt'; player: number }
  | { type: 'captured'; pieceId: number; by: number }
  | { type: 'win'; player: number; reason: string };

/** A dead piece's remains, which Necromancy can raise. */
export interface Corpse {
  id: number;
  owner: number;
  kind: PieceKind;
  pos: Hex;
  round: number;
}

export interface GameState {
  mode: GameMode;
  players: Player[];
  pieces: Piece[];
  current: number;
  round: number;
  nextId: number;
  rngState: number;
  /** This turn's unit (null until chosen). */
  active: Unit | null;
  /** True once the unit has done anything (moved, attacked, played a card); then it is locked in. */
  turnActed: boolean;
  /** Ability cards the active piece has played this turn. */
  cardsUsed: number;
  /** Cards the current player must discard (hand over the limit) before doing anything else. */
  mustDiscard: number;
  /** The flag lies on `pos` when nobody carries it; otherwise `carrier` is the carrying piece's id. */
  flag: { pos: Hex | null; carrier: number | null };
  /** 💀 Where pieces died (newest last). Purely a marker: pieces move over and onto skulls freely. */
  corpses: Corpse[];
  winner: number | null;
  winReason: string | null;
  log: string[];
}

export type Difficulty = 'easy' | 'normal' | 'hard';
/** 'ffa': everyone for themselves. 'dogpile': all AIs team up against the human player(s). */
export type GameMode = 'ffa' | 'dogpile';

export interface PlayerSetup {
  name?: string;
  isBot?: boolean;
  difficulty?: Difficulty;
}
