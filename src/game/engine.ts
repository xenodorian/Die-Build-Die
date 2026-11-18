import { CARDS, CLASS_USERS, PIECES, PLAYER_COLORS, PLAYER_NAMES, RULES, buildDeckList, canClassBeUsedBy, type CardDef, type Die, type PieceKind } from './config';
import {
  DIAGONALS, DIRECTIONS, KNIGHT_JUMPS, corners, hex, hexAdd, hexDistance, hexEq, hexScale, hexagonBoard, inBoard, neighbors,
  type Hex,
} from './hex';
import { rollDie, shuffle } from './rng';
import type { Action, Card, GameEvent, GameState, Piece, Player, PlayerSetup, Target, Unit } from './types';

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
    active: null,
    turnActed: false,
    cardsUsed: 0,
    mustDiscard: 0,
    flag: { pos: { ...RULES.flagStart }, carrier: null },
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

export const sameUnit = (a: Unit, b: Unit): boolean =>
  a.kind === b.kind && (a.kind === 'base' || (b.kind === 'piece' && a.id === b.id));

export const activePiece = (s: GameState): Piece | undefined =>
  s.active?.kind === 'piece' ? pieceById(s, s.active.id) : undefined;

/** Can this be (or become) the current player's single unit for this turn? */
export function canBeUnit(s: GameState, unit: Unit): boolean {
  if (s.winner !== null || s.mustDiscard > 0) return false;
  if (s.active && sameUnit(s.active, unit)) return true;
  if (s.turnActed) return false; // locked in
  if (unit.kind === 'base') return currentPlayer(s).alive;
  const p = pieceById(s, unit.id);
  return !!p && p.owner === s.current && (p.movesLeft > 0 || p.attacksLeft > 0);
}

/** Units the current player could pick right now. */
export function selectableUnits(s: GameState): Unit[] {
  const out: Unit[] = [{ kind: 'base' }];
  for (const p of s.pieces) if (p.owner === s.current) out.push({ kind: 'piece', id: p.id });
  return out.filter((u) => canBeUnit(s, u));
}

export function legalMoves(s: GameState, piece: Piece): Hex[] {
  if (s.winner !== null || piece.owner !== s.current || piece.movesLeft <= 0) return [];
  if (!canBeUnit(s, { kind: 'piece', id: piece.id })) return [];
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

/** A piece of the base owner's standing on their base (it soaks damage aimed at the base). */
export function garrisonOf(s: GameState, player: Player): Piece | undefined {
  if (!RULES.garrisonAbsorbsBaseDamage) return undefined;
  const p = pieceAt(s, player.base);
  return p && p.owner === player.index ? p : undefined;
}

function baseTargetable(_s: GameState, player: Player): boolean {
  return player.alive;
}

/** Where the flag is right now (the carrier's hex, or where it lies). */
export function flagHex(s: GameState): Hex | null {
  if (s.flag.carrier !== null) return pieceById(s, s.flag.carrier)?.pos ?? null;
  return s.flag.pos;
}

export const flagCarrier = (s: GameState): Piece | undefined =>
  s.flag.carrier === null ? undefined : pieceById(s, s.flag.carrier);

/** Hexes a move passes over between `from` and `to` (excluding `from`, including `to`). Jumps only touch `to`. */
export function movePath(from: Hex, to: Hex): Hex[] {
  for (const dirs of [DIRECTIONS, DIAGONALS]) {
    for (const d of dirs) {
      for (let k = 1; k <= RULES.boardRadius * 2; k++) {
        if (hexEq(hexAdd(from, hexScale(d, k)), to)) {
          return Array.from({ length: k }, (_, i) => hexAdd(from, hexScale(d, i + 1)));
        }
      }
    }
  }
  return [to];
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
  if (!canBeUnit(s, { kind: 'piece', id: piece.id })) return [];
  return enemiesNear(s, [piece.pos], PIECES[piece.kind].range, piece.owner);
}

/** Empty hexes where `owner` may summon: the base itself, then its neighbours. */
export function summonHexes(s: GameState, owner: number): Hex[] {
  const base = s.players[owner].base;
  return [base, ...neighbors(base)].filter((h) => isOpenFor(s, h, owner));
}

/** Valid targets for `def` played by `actor` (the acting piece; undefined for conjurations). */
export function cardTargets(s: GameState, owner: number, def: CardDef, actor?: Piece): Target[] {
  if (def.targeting === 'summonHex') return summonHexes(s, owner).map((h) => ({ kind: 'hex', hex: h }));
  if (!actor) return [];
  const self: Target = { kind: 'piece', id: actor.id };
  switch (def.targeting) {
    case 'none':
      return [];
    case 'self':
      if (def.id === 'recall' && summonHexes(s, owner).length === 0) return [];
      return [self];
    case 'selfOrAdjacentFriend':
      return [self, ...s.pieces.filter((p) => p.owner === owner && hexDistance(p.pos, actor.pos) === 1).map((p): Target => ({ kind: 'piece', id: p.id }))];
    case 'friendlyPawnInRange':
      return s.pieces
        .filter((p) => p.owner === owner && p.kind === 'pawn' && p.id !== actor.id && hexDistance(p.pos, actor.pos) <= (def.range ?? 1))
        .map((p) => ({ kind: 'piece', id: p.id }));
    case 'enemyInRange':
      return enemiesNear(s, [actor.pos], def.range ?? 1, owner);
    case 'arrows':
      return s.pieces
        .filter((p) => p.owner !== owner && hexDistance(p.pos, actor.pos) <= (def.range ?? 1))
        .map((p) => ({ kind: 'piece', id: p.id }));
    case 'areaHex':
      return hexagonBoard(RULES.boardRadius)
        .filter((h) => hexDistance(h, actor.pos) <= (def.range ?? 0))
        .map((h) => ({ kind: 'hex', hex: h }));
  }
}

const CLASS_LABEL: Record<string, string> = { pawn: 'Pawn', knight: 'Knight', bishop: 'Bishop', rook: 'Rook', queen: 'Queen' };

/** Who may play a card, in words (for tooltips). */
export function cardUsersText(def: CardDef): string {
  if (def.cls === 'conjuration') return 'Conjuration: played by your base';
  if (def.cls === 'pawn') return 'Pawn card: any piece can use it';
  return `${CLASS_LABEL[def.cls]} card: usable by ${CLASS_USERS[def.cls].map((k) => PIECES[k].name).join(', ')}`;
}

/** Why `card` can't be played right now, or null if it can. */
export function cardBlockReason(s: GameState, owner: number, card: Card): string | null {
  if (s.winner !== null || owner !== s.current) return 'Not your turn';
  if (s.mustDiscard > 0) return `Discard ${s.mustDiscard} card(s) first`;
  const def = CARDS[card.id];
  const me = s.players[owner];
  if (def.cls === 'conjuration') {
    if (!canBeUnit(s, { kind: 'base' })) return 'Only your base plays conjurations, and this turn you chose a piece';
    if (me.energy < def.cost) return `Needs ${def.cost} energy`;
    if (!summonHexes(s, owner).length) return 'No empty hex on or next to your base';
    return null;
  }
  const actor = activePiece(s);
  if (!actor) return `${cardUsersText(def)}. Select a piece first`;
  if (!canClassBeUsedBy(def.cls, actor.kind)) return `${cardUsersText(def)} — not a ${PIECES[actor.kind].name}`;
  if (s.cardsUsed >= RULES.cardsPerPieceTurn) return `A piece may play ${RULES.cardsPerPieceTurn} card per turn`;
  if (me.energy < def.cost) return `Needs ${def.cost} energy`;
  if (def.id === 'fortify' && me.baseHp >= RULES.baseHp) return 'Your base is at full HP';
  if (def.targeting !== 'none' && cardTargets(s, owner, def, actor).length === 0) return 'No valid target';
  return null;
}

export function canPlayCard(s: GameState, owner: number, card: Card): boolean {
  return cardBlockReason(s, owner, card) === null;
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
  if (s.mustDiscard > 0) return s.players[me].hand.map((c) => ({ type: 'discard', cardUid: c.uid }));
  for (const card of s.players[me].hand) {
    if (!canPlayCard(s, me, card)) continue;
    const def = CARDS[card.id];
    if (def.targeting === 'none') out.push({ type: 'playCard', cardUid: card.uid });
    else if (def.targeting === 'arrows') {
      for (const arrows of arrowSplits(s, cardTargets(s, me, def, activePiece(s)), def.amount ?? 1)) {
        out.push({ type: 'playCard', cardUid: card.uid, arrows });
      }
    } else for (const t of cardTargets(s, me, def, activePiece(s))) out.push({ type: 'playCard', cardUid: card.uid, target: t });
  }
  for (const p of s.pieces.filter((x) => x.owner === me)) {
    for (const to of legalMoves(s, p)) out.push({ type: 'move', pieceId: p.id, to });
    for (const t of legalAttacks(s, p)) out.push({ type: 'attack', pieceId: p.id, target: t });
  }
  out.push({ type: 'endTurn' });
  return out;
}

/**
 * A handful of representative ways to split `n` arrows (the UI lets humans pick any split):
 * all on one target, spread evenly, and "just enough to kill the weakest, rest on the next".
 */
export function arrowSplits(s: GameState, targets: Target[], n: number): number[][] {
  const ids = targets.flatMap((t) => (t.kind === 'piece' ? [t.id] : []));
  if (!ids.length) return [];
  const out: number[][] = ids.map((id) => Array(n).fill(id));
  if (ids.length > 1) out.push(Array.from({ length: n }, (_, i) => ids[i % ids.length]));
  const byHp = [...ids].sort((a, b) => (pieceById(s, a)!.hp + pieceById(s, a)!.shield) - (pieceById(s, b)!.hp + pieceById(s, b)!.shield));
  const avg = 4.5; // 1d8
  const split: number[] = [];
  for (const id of byHp) {
    const p = pieceById(s, id)!;
    const need = Math.min(n - split.length, Math.ceil((p.hp + p.shield) / avg));
    for (let i = 0; i < need; i++) split.push(id);
    if (split.length >= n) break;
  }
  while (split.length < n) split.push(byHp[0]);
  out.push(split);
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
  for (let i = 0; i < count; i++) {
    if (who.deck.length === 0) {
      if (who.discard.length === 0) break;
      who.deck = shuffle(s, who.discard);
      who.discard = [];
      log(s, events, `${who.name} reshuffles their discard pile into a new deck.`, who.index);
    }
    who.hand.push(who.deck.pop()!);
    drawn++;
  }
  events.push({ type: 'draw', player: who.index, count: drawn, burned: 0 });
  if (who.index === s.current) {
    s.mustDiscard = Math.max(0, who.hand.length - RULES.handLimit);
    if (s.mustDiscard) log(s, events, `${who.name} has ${who.hand.length} cards and must discard ${s.mustDiscard}.`, who.index);
  }
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
  me.turnsTaken++;
  events.push({ type: 'turnStart', player: me.index, round: s.round });
  log(s, events, `— Round ${s.round}: ${me.name}'s turn —`, me.index);
  s.active = null;
  s.turnActed = false;
  s.cardsUsed = 0;
  s.mustDiscard = 0;
  drawCards(s, events, me, me.turnsTaken === 1 ? RULES.openingHand : RULES.drawPerTurn);
  me.energy = Math.min(RULES.energyStart + (me.turnsTaken - 1) * RULES.energyPerTurn, RULES.energyMax);
  for (const p of s.pieces) {
    if (p.owner !== me.index) continue;
    p.movesLeft = RULES.movesPerTurn;
    p.attacksLeft = RULES.attacksPerTurn;
  }
}

/** Remove a piece from the board; a carried flag drops on its hex. */
function removePiece(s: GameState, events: GameEvent[], p: Piece) {
  s.pieces = s.pieces.filter((x) => x !== p);
  if (s.flag.carrier === p.id) {
    s.flag = { pos: p.pos, carrier: null };
    log(s, events, `  🚩 The flag drops at (${p.pos.q},${p.pos.r}).`);
  }
}

/** Give the flag to `p` if it ended its move on the flag's hex. */
function tryPickUp(s: GameState, events: GameEvent[], p: Piece) {
  if (s.flag.carrier !== null || !s.flag.pos) return;
  if (!hexEq(p.pos, s.flag.pos)) return;
  s.flag = { pos: null, carrier: p.id };
  log(s, events, `🚩 ${s.players[p.owner].name}'s ${PIECES[p.kind].name} grabs the flag!`, p.owner);
  checkFlagWin(s, events, p);
}

function checkFlagWin(s: GameState, events: GameEvent[], p: Piece) {
  if (s.flag.carrier === p.id && hexEq(p.pos, s.players[p.owner].base)) {
    declareWin(s, events, p.owner, `captured the flag with a ${PIECES[p.kind].name}`);
  }
}

function eliminate(s: GameState, events: GameEvent[], who: Player) {
  who.alive = false;
  who.baseHp = 0;
  for (const p of s.pieces.filter((x) => x.owner === who.index)) removePiece(s, events, p);
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
      log(s, events, `  ☠ ${name} is destroyed.`);
      removePiece(s, events, p);
      events.push({ type: 'pieceDied', pieceId: p.id, owner: p.owner });
    }
  } else if (target.kind === 'base') {
    const pl = s.players[target.owner];
    if (!pl.alive) return;
    const guard = garrisonOf(s, pl);
    if (guard) {
      log(s, events, `  🛡 ${pl.name}'s ${PIECES[guard.kind].name} stands on the base and takes the hit.`);
      dealDamage(s, events, { kind: 'piece', id: guard.id }, amount);
      return;
    }
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
  assert(s.mustDiscard === 0 || action.type === 'discard', `Discard ${s.mustDiscard} card(s) first`);

  switch (action.type) {
    case 'move': {
      const p = pieceById(s, action.pieceId);
      assert(p && p.owner === me.index, 'Not your piece');
      assert(legalMoves(s, p).some((h) => hexEq(h, action.to)), 'Illegal move');
      lockUnit(s, { kind: 'piece', id: p.id });
      p.pos = action.to;
      p.movesLeft--;
      log(s, events, `${me.name} moves ${PIECES[p.kind].name} to (${action.to.q},${action.to.r}).`, me.index);
      tryPickUp(s, events, p);
      checkFlagWin(s, events, p);
      break;
    }
    case 'attack': {
      const p = pieceById(s, action.pieceId);
      assert(p && p.owner === me.index, 'Not your piece');
      assert(legalAttacks(s, p).some((t) => sameTarget(t, action.target)), 'Illegal attack');
      const stats = PIECES[p.kind];
      log(s, events, `${me.name}'s ${stats.name} attacks ${targetName(s, action.target)}.`, me.index);
      lockUnit(s, { kind: 'piece', id: p.id });
      const dmg = roll(s, events, `${stats.name} d${stats.die}`, [stats.die], p.bonusDamage, me.index);
      p.bonusDamage = 0;
      p.attacksLeft--;
      dealDamage(s, events, action.target, dmg);
      break;
    }
    case 'playCard': {
      const card = me.hand.find((c) => c.uid === action.cardUid);
      assert(card, 'Card not in hand');
      assert(canPlayCard(s, me.index, card), 'Cannot play that card now');
      const def = CARDS[card.id];
      const actor = def.cls === 'conjuration' ? undefined : activePiece(s);
      let target = action.target;
      if (def.targeting === 'self' && !target && actor) target = { kind: 'piece', id: actor.id };
      if (def.targeting === 'arrows') {
        const legal = cardTargets(s, me.index, def, actor).flatMap((t) => (t.kind === 'piece' ? [t.id] : []));
        assert(action.arrows && action.arrows.length === def.amount, `Assign all ${def.amount} arrows`);
        assert(action.arrows.every((id) => legal.includes(id)), 'Arrows must target enemy pieces in range');
        assert(new Set(action.arrows).size <= (def.amount ?? 1), 'Too many targets');
      } else if (def.targeting !== 'none') {
        assert(target, 'Card needs a target');
        assert(cardTargets(s, me.index, def, actor).some((t) => sameTarget(t, target!)), 'Illegal target');
      }
      if (def.cls === 'conjuration') lockUnit(s, { kind: 'base' });
      else {
        s.turnActed = true;
        s.cardsUsed++;
      }
      me.energy -= def.cost;
      me.hand = me.hand.filter((c) => c !== card);
      me.discard.push(card);
      log(s, events, `${me.name}${actor ? `'s ${PIECES[actor.kind].name}` : "'s base"} plays ${def.name}.`, me.index);
      if (def.targeting === 'arrows') resolveArrows(s, events, me, def, action.arrows!);
      else resolveCard(s, events, me, def, target, actor);
      break;
    }
    case 'discard': {
      const card = me.hand.find((c) => c.uid === action.cardUid);
      assert(card, 'Card not in hand');
      me.hand = me.hand.filter((c) => c !== card);
      me.discard.push(card);
      if (s.mustDiscard > 0) s.mustDiscard--;
      log(s, events, `${me.name} discards ${CARDS[card.id].name}.`, me.index);
      break;
    }
    case 'selectUnit': {
      assert(canBeUnit(s, action.unit), 'You cannot pick that unit now');
      s.active = action.unit;
      const p = action.unit.kind === 'piece' ? pieceById(s, action.unit.id) : undefined;
      log(s, events, `${me.name} picks their ${p ? PIECES[p.kind].name : 'base'} for this turn.`, me.index);
      break;
    }
    case 'endTurn': {
      log(s, events, `${me.name} ends their turn.`, me.index);
      advanceTurn(s, events);
      break;
    }
  }
  // A player who blew up their own base (e.g. with Fireball) loses the rest of their turn.
  if (s.winner === null && !currentPlayer(s).alive) advanceTurn(s, events);
  return events;
}

/** Make `unit` this turn's unit (switching is allowed until it does something) and lock it in. */
function lockUnit(s: GameState, unit: Unit) {
  assert(canBeUnit(s, unit), 'Another unit already acted this turn');
  s.active = unit;
  s.turnActed = true;
}

function advanceTurn(s: GameState, events: GameEvent[]) {
  let next = s.current;
  do {
    next = (next + 1) % s.players.length;
    if (next === 0) s.round++;
  } while (!s.players[next].alive);
  s.current = next;
  startTurn(s, events);
}

/** Pieces and bases that an area effect centred on `center` would hit. */
export function areaVictims(s: GameState, center: Hex, radius: number): { pieces: Piece[]; bases: Player[] } {
  return {
    pieces: s.pieces.filter((p) => hexDistance(p.pos, center) <= radius),
    bases: s.players.filter((pl) => pl.alive && hexDistance(pl.base, center) <= radius),
  };
}

function resolveArrows(s: GameState, events: GameEvent[], me: Player, def: CardDef, arrows: number[]) {
  const names = arrows.map((id) => targetName(s, { kind: 'piece', id }));
  const values = arrows.map(() => rollDie(s, def.dice!.die));
  events.push({
    type: 'roll', label: `${def.name}: ${names.map((n) => n.split(' ').slice(1).join(' ')).join(', ')}`,
    dice: arrows.map(() => def.dice!.die), values, bonus: 0, total: values.reduce((a, b) => a + b, 0), player: me.index,
  });
  arrows.forEach((id, i) => {
    if (!pieceById(s, id)) {
      log(s, events, `  Arrow ${i + 1} (${values[i]}) flies past — its target already fell.`);
      return;
    }
    log(s, events, `  Arrow ${i + 1} hits ${names[i]} for ${values[i]}.`);
    dealDamage(s, events, { kind: 'piece', id }, values[i]);
  });
}

function resolveCard(s: GameState, events: GameEvent[], me: Player, def: CardDef, target?: Target, _actor?: Piece) {
  const piece = target?.kind === 'piece' ? pieceById(s, target.id) : undefined;
  switch (def.id) {
    case 'summon_pawn': case 'summon_knight': case 'summon_bishop':
    case 'summon_rook': case 'summon_queen': case 'summon_king': {
      assert(target?.kind === 'hex', 'Summon needs a hex');
      const np = spawnPiece(s, me.index, def.summons!, target.hex, RULES.summoningSickness);
      log(s, events, `  A ${PIECES[def.summons!].name} appears at (${target.hex.q},${target.hex.r}).`, me.index);
      tryPickUp(s, events, np);
      break;
    }
    case 'fireball': {
      assert(target?.kind === 'hex', 'Fireball needs a hex');
      const { pieces, bases } = areaVictims(s, target.hex, def.radius!);
      log(s, events, `  🔥 A fireball engulfs everything within ${def.radius} hexes of (${target.hex.q},${target.hex.r})!`, me.index);
      const dmg = roll(s, events, `${def.name} ${def.dice!.count}d${def.dice!.die}`, Array(def.dice!.count).fill(def.dice!.die), 0, me.index);
      // Garrisons shield their base from the blast: they take their own hit only.
      const exposed = bases.filter((pl) => !garrisonOf(s, pl));
      for (const p of pieces) dealDamage(s, events, { kind: 'piece', id: p.id }, dmg);
      // Enemy bases first, your own last, so a blast that wins the game is not undone by self-elimination.
      exposed.sort((a, b) => Number(a.index === me.index) - Number(b.index === me.index));
      for (const pl of exposed) {
        if (s.winner !== null) break;
        if (pl.alive) dealDamage(s, events, { kind: 'base', owner: pl.index }, dmg);
      }
      if (!pieces.length && !exposed.length) log(s, events, '  …it hits nothing.');
      break;
    }
    case 'firebolt': {
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
      if (s.flag.carrier === p.id) {
        s.flag = { pos: p.pos, carrier: null };
        log(s, events, `  🚩 The flag is dropped at (${p.pos.q},${p.pos.r}).`);
      }
      if (spot) p.pos = spot;
      p.hp = Math.min(p.maxHp, p.hp + def.amount!);
      log(s, events, `  ${targetName(s, target!)} returns home and heals to ${p.hp}/${p.maxHp}.`);
      break;
    }
  }
}
