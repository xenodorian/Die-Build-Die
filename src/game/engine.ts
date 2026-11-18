import { CARDS, PIECES, PLAYER_COLORS, PLAYER_NAMES, RULES, buildDeckList, type CardDef, type Die, type PieceKind } from './config';
import {
  DIAGONALS, DIRECTIONS, KNIGHT_JUMPS, corners, hex, hexAdd, hexDistance, hexEq, hexScale, inBoard, neighbors,
  type Hex,
} from './hex';
import { rollDie, shuffle } from './rng';
import type { Action, Card, GameEvent, GameState, Piece, Player, PlayerSetup, Target } from './types';

export const CENTER: Hex = hex(0, 0);

// ---------------------------------------------------------------- setup

export function newGame(setups: PlayerSetup[], seed = Date.now()): { state: GameState; events: GameEvent[] } {
  const n = setups.length;
  if (n < RULES.minPlayers || n > RULES.maxPlayers) throw new Error(`Need ${RULES.minPlayers}-${RULES.maxPlayers} players`);
  const boardCorners = corners(RULES.boardRadius);
  const seats = RULES.seatCorners[n];
  const state: GameState = {
    players: [],
    pieces: [],
    current: 0,
    round: 1,
    nextId: 1,
    rngState: seed | 0,
    winner: null,
    winReason: null,
    log: [],
  };
  setups.forEach((s, i) => {
    const corner = seats[i];
    const player: Player = {
      index: i,
      name: s.name || PLAYER_NAMES[corner],
      color: PLAYER_COLORS[corner],
      corner,
      base: boardCorners[corner],
      baseHp: RULES.baseHp,
      alive: true,
      isBot: !!s.isBot,
      deck: [],
      hand: [],
      discard: [],
      energy: 0,
      turnsTaken: 0,
    };
    player.deck = shuffle(state, buildDeckList().map((id) => ({ uid: state.nextId++, id })));
    state.players.push(player);
    for (const kind of RULES.startingPieces) {
      const spot = summonHexes(state, i)[0];
      if (spot) spawnPiece(state, i, kind, spot, false);
    }
  });
  const events: GameEvent[] = [];
  startTurn(state, events);
  return { state, events };
}

function spawnPiece(state: GameState, owner: number, kind: PieceKind, pos: Hex, sick: boolean): Piece {
  const stats = PIECES[kind];
  const piece: Piece = {
    id: state.nextId++,
    owner,
    kind,
    pos,
    hp: stats.hp,
    maxHp: stats.hp,
    movesLeft: sick ? 0 : RULES.movesPerTurn,
    attacksLeft: sick ? 0 : RULES.attacksPerTurn,
    shield: 0,
    bonusDamage: 0,
  };
  state.pieces.push(piece);
  return piece;
}

// ---------------------------------------------------------------- queries

export const currentPlayer = (s: GameState): Player => s.players[s.current];
export const pieceAt = (s: GameState, h: Hex): Piece | undefined => s.pieces.find((p) => hexEq(p.pos, h));
export const pieceById = (s: GameState, id: number): Piece | undefined => s.pieces.find((p) => p.id === id);
export const baseAt = (s: GameState, h: Hex): Player | undefined => s.players.find((p) => p.alive && hexEq(p.base, h));

/** Can a piece owned by `owner` stand on / pass through this hex? */
function isOpenFor(s: GameState, h: Hex, owner: number): boolean {
  if (!inBoard(h, RULES.boardRadius)) return false;
  if (pieceAt(s, h)) return false;
  const base = baseAt(s, h);
  return !base || base.index === owner;
}

export function legalMoves(s: GameState, piece: Piece): Hex[] {
  if (s.winner !== null || piece.owner !== s.current || piece.movesLeft <= 0) return [];
  const rule = PIECES[piece.kind].move;
  const out: Hex[] = [];
  const add = (h: Hex) => {
    if (!out.some((o) => hexEq(o, h))) out.push(h);
  };
  const slide = (dirs: Hex[], max: number) => {
    for (const d of dirs) {
      for (let k = 1; k <= max; k++) {
        const h = hexAdd(piece.pos, hexScale(d, k));
        if (!isOpenFor(s, h, piece.owner)) break;
        add(h);
      }
    }
  };
  slide(DIRECTIONS, rule.straight);
  slide(DIAGONALS, rule.diagonal);
  if (rule.knightJump) for (const j of KNIGHT_JUMPS) {
    const h = hexAdd(piece.pos, j);
    if (isOpenFor(s, h, piece.owner)) add(h);
  }
  return out;
}

function baseTargetable(s: GameState, player: Player): boolean {
  if (!player.alive) return false;
  if (!RULES.garrisonProtectsBase) return true;
  const guard = pieceAt(s, player.base);
  return !(guard && guard.owner === player.index);
}

/** Enemy pieces and bases within `range` of hex `from`, for attacker `owner`. */
function enemiesNear(s: GameState, from: Hex[], range: number, owner: number): Target[] {
  const out: Target[] = [];
  const near = (h: Hex) => from.some((f) => hexDistance(f, h) <= range);
  for (const p of s.pieces) if (p.owner !== owner && near(p.pos)) out.push({ kind: 'piece', id: p.id });
  for (const pl of s.players) {
    if (pl.index !== owner && baseTargetable(s, pl) && near(pl.base)) out.push({ kind: 'base', owner: pl.index });
  }
  return out;
}

export function legalAttacks(s: GameState, piece: Piece): Target[] {
  if (s.winner !== null || piece.owner !== s.current || piece.attacksLeft <= 0) return [];
  return enemiesNear(s, [piece.pos], PIECES[piece.kind].range, piece.owner);
}

/** Empty hexes where `owner` may summon: the base itself, then its neighbours. */
export function summonHexes(s: GameState, owner: number): Hex[] {
  const base = s.players[owner].base;
  return [base, ...neighbors(base)].filter((h) => isOpenFor(s, h, owner));
}

export function cardTargets(s: GameState, owner: number, def: CardDef): Target[] {
  const mine = s.pieces.filter((p) => p.owner === owner);
  switch (def.targeting) {
    case 'none':
      return [];
    case 'summonHex':
      return summonHexes(s, owner).map((h) => ({ kind: 'hex', hex: h }));
    case 'friendlyPiece': {
      if (def.id === 'recall') {
        if (summonHexes(s, owner).length === 0) return [];
      }
      return mine.map((p) => ({ kind: 'piece', id: p.id }));
    }
    case 'friendlyPawn':
      return mine.filter((p) => p.kind === 'pawn').map((p) => ({ kind: 'piece', id: p.id }));
    case 'enemyInRange':
      return enemiesNear(s, mine.map((p) => p.pos), def.range ?? 1, owner);
  }
}

export function canPlayCard(s: GameState, owner: number, card: Card): boolean {
  if (s.winner !== null || owner !== s.current) return false;
  const def = CARDS[card.id];
  if (s.players[owner].energy < def.cost) return false;
  if (def.id === 'fortify' && s.players[owner].baseHp >= RULES.baseHp) return false;
  return def.targeting === 'none' || cardTargets(s, owner, def).length > 0;
}

export const sameTarget = (a: Target, b: Target): boolean =>
  a.kind === b.kind &&
  ((a.kind === 'piece' && b.kind === 'piece' && a.id === b.id) ||
    (a.kind === 'base' && b.kind === 'base' && a.owner === b.owner) ||
    (a.kind === 'hex' && b.kind === 'hex' && hexEq(a.hex, b.hex)));

/** Every legal action for the current player (used by bots and tests). */
export function legalActions(s: GameState): Action[] {
  if (s.winner !== null) return [];
  const me = s.current;
  const out: Action[] = [];
  for (const card of s.players[me].hand) {
    if (!canPlayCard(s, me, card)) continue;
    const def = CARDS[card.id];
    if (def.targeting === 'none') out.push({ type: 'playCard', cardUid: card.uid });
    else for (const t of cardTargets(s, me, def)) out.push({ type: 'playCard', cardUid: card.uid, target: t });
  }
  for (const p of s.pieces.filter((x) => x.owner === me)) {
    for (const to of legalMoves(s, p)) out.push({ type: 'move', pieceId: p.id, to });
    for (const t of legalAttacks(s, p)) out.push({ type: 'attack', pieceId: p.id, target: t });
  }
  out.push({ type: 'endTurn' });
  return out;
}

export function targetName(s: GameState, t: Target): string {
  if (t.kind === 'piece') {
    const p = pieceById(s, t.id);
    return p ? `${s.players[p.owner].name} ${PIECES[p.kind].name}` : 'a fallen piece';
  }
  if (t.kind === 'base') return `${s.players[t.owner].name}'s base`;
  return `(${t.hex.q},${t.hex.r})`;
}

// ---------------------------------------------------------------- mutation

function log(s: GameState, events: GameEvent[], text: string, player?: number) {
  s.log.push(text);
  events.push({ type: 'log', text, player });
}

function roll(s: GameState, events: GameEvent[], label: string, dice: Die[], bonus: number, player: number): number {
  const values = dice.map((d) => rollDie(s, d));
  const total = values.reduce((a, b) => a + b, 0) + bonus;
  events.push({ type: 'roll', label, dice, values, bonus, total, player });
  return total;
}

function drawCards(s: GameState, events: GameEvent[], who: Player, count: number) {
  let drawn = 0;
  let burned = 0;
  for (let i = 0; i < count; i++) {
    if (who.deck.length === 0) {
      if (who.discard.length === 0) break;
      who.deck = shuffle(s, who.discard);
      who.discard = [];
      log(s, events, `${who.name} reshuffles their discard pile into a new deck.`, who.index);
    }
    const card = who.deck.pop()!;
    if (who.hand.length >= RULES.handLimit) {
      who.discard.push(card);
      burned++;
    } else {
      who.hand.push(card);
      drawn++;
    }
  }
  events.push({ type: 'draw', player: who.index, count: drawn, burned });
  if (burned) log(s, events, `${who.name}'s hand is full: ${burned} card(s) burned.`, who.index);
}

function declareWin(s: GameState, events: GameEvent[], player: number, reason: string) {
  if (s.winner !== null) return;
  s.winner = player;
  s.winReason = reason;
  log(s, events, `🏆 ${s.players[player].name} wins — ${reason}!`, player);
  events.push({ type: 'win', player, reason });
}

function startTurn(s: GameState, events: GameEvent[]) {
  const me = currentPlayer(s);
  if (RULES.centerWin === 'hold') {
    const p = pieceAt(s, CENTER);
    if (p && p.owner === me.index) {
      declareWin(s, events, me.index, `held the centre with a ${PIECES[p.kind].name}`);
      return;
    }
  }
  me.turnsTaken++;
  events.push({ type: 'turnStart', player: me.index, round: s.round });
  log(s, events, `— Round ${s.round}: ${me.name}'s turn —`, me.index);
  drawCards(s, events, me, me.turnsTaken === 1 ? RULES.openingHand : RULES.drawPerTurn);
  me.energy = Math.min(RULES.energyStart + (me.turnsTaken - 1) * RULES.energyPerTurn, RULES.energyMax);
  for (const p of s.pieces) {
    if (p.owner !== me.index) continue;
    p.movesLeft = RULES.movesPerTurn;
    p.attacksLeft = RULES.attacksPerTurn;
  }
}

function eliminate(s: GameState, events: GameEvent[], who: Player) {
  who.alive = false;
  who.baseHp = 0;
  s.pieces = s.pieces.filter((p) => p.owner !== who.index);
  log(s, events, `💥 ${who.name}'s base is destroyed. ${who.name} is out!`, who.index);
  events.push({ type: 'eliminated', player: who.index });
  const alive = s.players.filter((p) => p.alive);
  if (RULES.lastBaseStandingWins && alive.length === 1) declareWin(s, events, alive[0].index, 'last base standing');
}

function dealDamage(s: GameState, events: GameEvent[], target: Target, amount: number) {
  if (target.kind === 'piece') {
    const p = pieceById(s, target.id);
    if (!p) return;
    const name = targetName(s, target);
    const absorbed = Math.min(p.shield, amount);
    p.shield -= absorbed;
    const dmg = amount - absorbed;
    p.hp -= dmg;
    log(s, events, `  ${name} takes ${dmg}${absorbed ? ` (shield absorbed ${absorbed})` : ''} → ${Math.max(p.hp, 0)}/${p.maxHp} HP`);
    if (p.hp <= 0) {
      s.pieces = s.pieces.filter((x) => x !== p);
      log(s, events, `  ☠ ${name} is destroyed.`);
      events.push({ type: 'pieceDied', pieceId: p.id, owner: p.owner });
    }
  } else if (target.kind === 'base') {
    const pl = s.players[target.owner];
    pl.baseHp -= amount;
    log(s, events, `  ${pl.name}'s base takes ${amount} → ${Math.max(pl.baseHp, 0)}/${RULES.baseHp} HP`);
    if (pl.baseHp <= 0) eliminate(s, events, pl);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Apply an action for the current player. Mutates `s`; throws on an illegal action. */
export function applyAction(s: GameState, action: Action): GameEvent[] {
  const events: GameEvent[] = [];
  assert(s.winner === null, 'Game is over');
  const me = currentPlayer(s);

  switch (action.type) {
    case 'move': {
      const p = pieceById(s, action.pieceId);
      assert(p && p.owner === me.index, 'Not your piece');
      assert(legalMoves(s, p).some((h) => hexEq(h, action.to)), 'Illegal move');
      p.pos = action.to;
      p.movesLeft--;
      log(s, events, `${me.name} moves ${PIECES[p.kind].name} to (${action.to.q},${action.to.r}).`, me.index);
      if (hexEq(p.pos, CENTER)) {
        if (RULES.centerWin === 'enter') declareWin(s, events, me.index, 'reached the centre');
        else log(s, events, `⚑ ${me.name} takes the centre! Hold it until their next turn to win.`, me.index);
      }
      break;
    }
    case 'attack': {
      const p = pieceById(s, action.pieceId);
      assert(p && p.owner === me.index, 'Not your piece');
      assert(legalAttacks(s, p).some((t) => sameTarget(t, action.target)), 'Illegal attack');
      const stats = PIECES[p.kind];
      log(s, events, `${me.name}'s ${stats.name} attacks ${targetName(s, action.target)}.`, me.index);
      const dmg = roll(s, events, `${stats.name} d${stats.die}`, [stats.die], p.bonusDamage, me.index);
      p.bonusDamage = 0;
      p.attacksLeft--;
      p.movesLeft = 0;
      dealDamage(s, events, action.target, dmg);
      break;
    }
    case 'playCard': {
      const card = me.hand.find((c) => c.uid === action.cardUid);
      assert(card, 'Card not in hand');
      assert(canPlayCard(s, me.index, card), 'Cannot play that card now');
      const def = CARDS[card.id];
      if (def.targeting !== 'none') {
        assert(action.target, 'Card needs a target');
        assert(cardTargets(s, me.index, def).some((t) => sameTarget(t, action.target!)), 'Illegal target');
      }
      me.energy -= def.cost;
      me.hand = me.hand.filter((c) => c !== card);
      me.discard.push(card);
      log(s, events, `${me.name} plays ${def.name}.`, me.index);
      resolveCard(s, events, me, def, action.target);
      break;
    }
    case 'endTurn': {
      log(s, events, `${me.name} ends their turn.`, me.index);
      let next = s.current;
      do {
        next = (next + 1) % s.players.length;
        if (next === 0) s.round++;
      } while (!s.players[next].alive);
      s.current = next;
      startTurn(s, events);
      break;
    }
  }
  return events;
}

function resolveCard(s: GameState, events: GameEvent[], me: Player, def: CardDef, target?: Target) {
  const piece = target?.kind === 'piece' ? pieceById(s, target.id) : undefined;
  switch (def.id) {
    case 'summon_pawn': case 'summon_knight': case 'summon_bishop':
    case 'summon_rook': case 'summon_queen': case 'summon_king': {
      assert(target?.kind === 'hex', 'Summon needs a hex');
      spawnPiece(s, me.index, def.summons!, target.hex, RULES.summoningSickness);
      log(s, events, `  A ${PIECES[def.summons!].name} appears at (${target.hex.q},${target.hex.r}).`, me.index);
      break;
    }
    case 'fireball': {
      const dmg = roll(s, events, `${def.name} ${def.dice!.count}d${def.dice!.die}`, Array(def.dice!.count).fill(def.dice!.die), 0, me.index);
      dealDamage(s, events, target!, dmg);
      break;
    }
    case 'sharpen':
      piece!.bonusDamage += def.amount!;
      log(s, events, `  ${targetName(s, target!)} gets +${def.amount} on its next attack.`);
      break;
    case 'frenzy':
      piece!.attacksLeft += def.amount!;
      log(s, events, `  ${targetName(s, target!)} may attack again this turn.`);
      break;
    case 'shield':
      piece!.shield += def.amount!;
      log(s, events, `  ${targetName(s, target!)} gains a ${def.amount}-point shield.`);
      break;
    case 'heal': {
      const amt = roll(s, events, `${def.name} 1d${def.dice!.die}`, [def.dice!.die], 0, me.index);
      const before = piece!.hp;
      piece!.hp = Math.min(piece!.maxHp, piece!.hp + amt);
      log(s, events, `  ${targetName(s, target!)} heals ${piece!.hp - before} → ${piece!.hp}/${piece!.maxHp}.`);
      break;
    }
    case 'fortify': {
      const before = me.baseHp;
      me.baseHp = Math.min(RULES.baseHp, me.baseHp + def.amount!);
      log(s, events, `  Base repaired by ${me.baseHp - before} → ${me.baseHp}/${RULES.baseHp}.`);
      break;
    }
    case 'haste':
      piece!.movesLeft += def.amount!;
      log(s, events, `  ${targetName(s, target!)} may move again this turn.`);
      break;
    case 'promote': {
      const p = piece!;
      const stats = PIECES.knight;
      p.kind = 'knight';
      p.hp = p.maxHp = stats.hp;
      log(s, events, `  The Pawn is promoted to a Knight!`);
      break;
    }
    case 'rally':
      drawCards(s, events, me, def.amount!);
      break;
    case 'recall': {
      const p = piece!;
      const spot = summonHexes(s, me.index).sort((a, b) => hexDistance(a, me.base) - hexDistance(b, me.base))[0];
      if (spot) p.pos = spot;
      p.hp = Math.min(p.maxHp, p.hp + def.amount!);
      log(s, events, `  ${targetName(s, target!)} returns home and heals to ${p.hp}/${p.maxHp}.`);
      break;
    }
  }
}
