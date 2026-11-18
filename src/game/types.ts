import type { CardId, Die, PieceKind } from './config';
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
  deck: Card[];
  hand: Card[];
  discard: Card[];
  energy: number;
  turnsTaken: number;
}

export type Target =
  | { kind: 'piece'; id: number }
  | { kind: 'base'; owner: number }
  | { kind: 'hex'; hex: Hex };

export type Action =
  | { type: 'move'; pieceId: number; to: Hex }
  | { type: 'attack'; pieceId: number; target: Target }
  | { type: 'playCard'; cardUid: number; target?: Target }
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'log'; text: string; player?: number }
  | { type: 'roll'; label: string; dice: Die[]; values: number[]; bonus: number; total: number; player: number }
  | { type: 'draw'; player: number; count: number; burned: number }
  | { type: 'turnStart'; player: number; round: number }
  | { type: 'pieceDied'; pieceId: number; owner: number }
  | { type: 'eliminated'; player: number }
  | { type: 'win'; player: number; reason: string };

export interface GameState {
  players: Player[];
  pieces: Piece[];
  current: number;
  round: number;
  nextId: number;
  rngState: number;
  winner: number | null;
  winReason: string | null;
  log: string[];
}

export interface PlayerSetup {
  name?: string;
  isBot?: boolean;
}
