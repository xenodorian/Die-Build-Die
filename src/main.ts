import './ui/style.css';
import { ARMORS, CARDS, PIECES, PLAYER_COLORS, PLAYER_NAMES, RULES, canClassBeUsedBy, type CardCategory } from './game/config';
import {
  CENTER, activePiece, applyAction, areaVictims, baseAt, canBeUnit, canPlayCard, cardBlockReason, cardTargets, cardUsersText, currentPlayer,
  flagCarrier, flagHex, legalAttacks, legalMoves, newGame, pieceAt,
  pieceById, sameTarget, targetName,
  canRebuild,
} from './game/engine';
import { chooseBotAction } from './game/bot';
import { hexDistance, hexEq, hexagonBoard, type Hex } from './game/hex';
import type { Action, Card, Difficulty, GameEvent, GameMode, GameState, Piece, PlayerSetup, Target, Unit } from './game/types';
import { animateRoll } from './ui/dice';

const RULES_URL = 'https://github.com/xenodorian/Die-Build-Die/blob/main/RULES.md';
const SQ3 = Math.sqrt(3);
const S = 20; // hex size in SVG units

const app = document.getElementById('app')!;

interface Ui {
  state: GameState | null;
  selectedPiece: number | null;
  pendingCard: number | null;
  /** Cordon of Arrows: enemy piece id per assigned arrow. */
  arrows: number[];
  busy: boolean;
  hideHands: boolean;
  revealed: boolean; // current human has acknowledged the hand-off screen
  fastDice: boolean;
  /** A card clicked before choosing which of several pieces should play it. */
  cardIntent: number | null;
}
const ui: Ui = { state: null, selectedPiece: null, pendingCard: null, arrows: [], busy: false, hideHands: true, revealed: true, fastDice: false, cardIntent: null };

/**
 * Units that could play `card` if picked now. Before your unit has acted you may still switch,
 * so a card your current pick can't use is still reachable by switching to one that can.
 */
function unitsThatCanPlay(s: GameState, card: Card): Unit[] {
  if (s.turnActed || s.mustDiscard > 0 || s.winner !== null) return [];
  const saved = s.active;
  const out: Unit[] = [];
  const candidates: Unit[] = [{ kind: 'base' }, ...s.pieces.filter((p) => p.owner === s.current).map((p): Unit => ({ kind: 'piece', id: p.id }))];
  for (const u of candidates) {
    if (!canBeUnit(s, u)) continue;
    s.active = u;
    if (canPlayCard(s, s.current, card)) out.push(u);
  }
  s.active = saved;
  return out;
}

// ------------------------------------------------------------------ setup screen

interface SetupCfg {
  name: string;
  opponents: number; // AI opponents, 1-5
  difficulty: Difficulty;
  mode: GameMode;
  extraHumans: number; // pass-and-play humans besides you
}
const setupCfg: SetupCfg = loadSetup();

function loadSetup(): SetupCfg {
  const def: SetupCfg = { name: '', opponents: 1, difficulty: 'normal', mode: 'ffa', extraHumans: 0 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('dbd-setup') ?? '{}') };
  } catch {
    return def;
  }
}
const maxExtraHumans = () => RULES.maxPlayers - 1 - setupCfg.opponents;

const DIFF_INFO: Record<Difficulty, { label: string; blurb: string }> = {
  easy: { label: 'Easy', blurb: 'Makes mistakes: sometimes picks a random unit, misjudges plans, stops early.' },
  normal: { label: 'Normal', blurb: 'Plays out every unit it could use this turn and picks the best.' },
  hard: { label: 'Hard', blurb: 'Plans each turn further ahead, guesses what your pieces could do to it next turn, and protects its flag carrier.' },
};

function seatPreview(): string {
  const n = 1 + setupCfg.extraHumans + setupCfg.opponents;
  const corners = RULES.seatCorners[n];
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    const isMe = i === 0;
    const human = i <= setupCfg.extraHumans;
    const label = isMe ? `${escapeHtml(setupCfg.name.trim() || PLAYER_NAMES[c])} (you)` : human ? `${PLAYER_NAMES[c]} 🧑 hot-seat` : `${PLAYER_NAMES[c]} 🤖 ${DIFF_INFO[setupCfg.difficulty].label}`;
    rows.push(`<span class="seatchip" style="--pc:${PLAYER_COLORS[c]}"><span class="swatch"></span>${label}</span>`);
  }
  return rows.join('');
}

function renderSetup() {
  const c = setupCfg;
  c.extraHumans = Math.min(c.extraHumans, maxExtraHumans());
  const showMode = c.opponents >= 2;
  app.innerHTML = `
  <div class="setup">
    <h1 class="logo">Die <span>Build</span> Die</h1>
    <p class="tagline">Chess pieces. A deck of cards. A fistful of dice. Grab the flag from the centre and carry it home.</p>
    <div class="setup-card">
      <label class="field">Your name
        <input id="pname" placeholder="${PLAYER_NAMES[RULES.seatCorners[2][0]]}" value="${escapeHtml(c.name)}" maxlength="14"/>
      </label>
      <div class="field"><span>AI opponents</span>
        <div class="count">${[1, 2, 3, 4, 5].map((k) => `<button data-opp="${k}" class="${k === c.opponents ? 'on' : ''}">${k}</button>`).join('')}</div>
      </div>
      <div class="field"><span>AI difficulty</span>
        <div class="seg">${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<button data-diff="${d}" class="${d === c.difficulty ? 'on' : ''}">${DIFF_INFO[d].label}</button>`).join('')}</div>
      </div>
      <p class="small left">${DIFF_INFO[c.difficulty].blurb}</p>
      ${showMode ? `<div class="field"><span>Mode</span>
        <div class="seg">
          <button data-mode="ffa" class="${c.mode === 'ffa' ? 'on' : ''}">Free for All</button>
          <button data-mode="dogpile" class="${c.mode === 'dogpile' ? 'on' : ''}">Dogpile</button>
        </div></div>
        <p class="small left">${c.mode === 'dogpile'
          ? '<b>Dogpile:</b> every AI gangs up on you: hunting your pieces, chasing your flag carrier and smashing your base. They leave each other alone. If you are knocked out, you lose. An AI can still win by bringing the flag home.'
          : '<b>Free for All:</b> each AI does whatever is best for itself: fighting you <i>or</i> the other AIs, and racing for the flag.'}</p>` : ''}
      <details class="adv" ${c.extraHumans ? 'open' : ''}><summary>Pass-and-play (more humans on this device)</summary>
        <div class="field"><span>Extra human players</span>
          <div class="count">${Array.from({ length: maxExtraHumans() + 1 }, (_, k) => `<button data-hum="${k}" class="${k === c.extraHumans ? 'on' : ''}">${k}</button>`).join('')}</div>
        </div>
        <label class="check"><input type="checkbox" id="hide" ${ui.hideHands ? 'checked' : ''}/> Hide hands between human turns</label>
      </details>
      <label class="check"><input type="checkbox" id="fast" ${ui.fastDice ? 'checked' : ''}/> Fast dice</label>
      <div class="seatlist">${seatPreview()}</div>
      <button class="primary big" id="start">Start game</button>
      <p class="small"><a href="${RULES_URL}" target="_blank" rel="noopener">Read the rules</a></p>
    </div>
  </div>`;
  const rerender = () => {
    localStorage.setItem('dbd-setup', JSON.stringify(setupCfg));
    renderSetup();
  };
  app.querySelectorAll<HTMLButtonElement>('[data-opp]').forEach((b) => b.addEventListener('click', () => { c.opponents = Number(b.dataset.opp); rerender(); }));
  app.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => b.addEventListener('click', () => { c.difficulty = b.dataset.diff as Difficulty; rerender(); }));
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { c.mode = b.dataset.mode as GameMode; rerender(); }));
  app.querySelectorAll<HTMLButtonElement>('[data-hum]').forEach((b) => b.addEventListener('click', () => { c.extraHumans = Number(b.dataset.hum); rerender(); }));
  const nameInput = app.querySelector('#pname') as HTMLInputElement;
  nameInput.addEventListener('input', () => {
    c.name = nameInput.value;
    localStorage.setItem('dbd-setup', JSON.stringify(setupCfg));
    (app.querySelector('.seatlist') as HTMLElement).innerHTML = seatPreview();
  });
  (app.querySelector('#hide') as HTMLInputElement).addEventListener('change', (e) => (ui.hideHands = (e.target as HTMLInputElement).checked));
  (app.querySelector('#fast') as HTMLInputElement).addEventListener('change', (e) => (ui.fastDice = (e.target as HTMLInputElement).checked));
  app.querySelector('#start')!.addEventListener('click', startGame);
}

function startGame() {
  const c = setupCfg;
  const setups: PlayerSetup[] = [
    { name: c.name.trim(), isBot: false },
    ...Array.from({ length: c.extraHumans }, () => ({ isBot: false })),
    ...Array.from({ length: c.opponents }, () => ({ isBot: true, difficulty: c.difficulty })),
  ];
  const { state } = newGame(setups, Date.now(), c.opponents >= 2 ? c.mode : 'ffa');
  ui.state = state;
  ui.selectedPiece = null;
  ui.pendingCard = null;
  ui.arrows = [];
  ui.revealed = !needsHandoff();
  renderGame();
  void maybeRunBot();
}

// ------------------------------------------------------------------ helpers

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
const px = (h: Hex) => ({ x: S * SQ3 * (h.q + h.r / 2), y: S * 1.5 * h.r });
function hexPoints(h: Hex, size = S) {
  const { x, y } = px(h);
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(x + size * Math.cos(a)).toFixed(2)},${(y + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
const humansCount = () => ui.state!.players.filter((p) => !p.isBot && p.alive).length;
const needsHandoff = () => ui.hideHands && !currentPlayer(ui.state!).isBot && humansCount() > 1;
const CATEGORY_LABEL: Record<CardCategory, string> = { conjuration: 'Conjuration', offense: 'Offense', defense: 'Defense', special: 'Special' };
const CLASS_BADGE: Record<string, string> = { conjuration: '🏰 Base', pawn: '♟ Pawn', knight: '♞ Knight', bishop: '♝ Bishop', rook: '♜ Rook', queen: '♛ Queen' };
const CATEGORY_ICON: Record<string, string> = {
  shackles: '⛓',
  firebolt: '🔥', fireball: '☄️', cordon: '🏹', gambeson: '🧥', breastplate: '🦺', plate: '🛡', armor_rend: '🔨', sharpen: '🗡️', frenzy: '⚔️', shield: '🛡️', heal: '✚', fortify: '🏰', haste: '💨', necromancy: '💀', promote_pawn_knight: '⬆️', promote_pawn_bishop: '⬆️', promote_pawn_rook: '⬆️', promote_bishop_queen: '⬆️', promote_knight_king: '👑', promote_rook_king: '👑', rally: '🎴', recall: '↩️',
};

// ------------------------------------------------------------------ highlights

type HL = { moves: Hex[]; attacks: Target[]; cardTargets: Target[] };
function highlights(): HL {
  const s = ui.state!;
  const hl: HL = { moves: [], attacks: [], cardTargets: [] };
  if (s.winner !== null || ui.busy || currentPlayer(s).isBot) return hl;
  if (ui.pendingCard !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.pendingCard);
    if (card) hl.cardTargets = cardTargets(s, s.current, CARDS[card.id], activePiece(s));
    return hl;
  }
  const ap = activePiece(s);
  if (ap) {
    const p = ap;
    {
      hl.moves = legalMoves(s, p);
      hl.attacks = legalAttacks(s, p);
    }
  }
  return hl;
}

function targetHex(t: Target): Hex | null {
  const s = ui.state!;
  if (t.kind === 'hex') return t.hex;
  if (t.kind === 'base') return s.players[t.owner].base;
  return pieceById(s, t.id)?.pos ?? null;
}

// ------------------------------------------------------------------ board

function renderBoard(hl: HL): string {
  const s = ui.state!;
  const R = RULES.boardRadius;
  const pad = S * 1.6;
  const w = S * SQ3 * (2 * R + 1) + pad * 2;
  const h = S * (3 * R + 2) + pad * 2;
  const hexes = hexagonBoard(R);
  const markHex = (list: Target[]) => list.map(targetHex).filter((x): x is Hex => !!x);
  const atkHexes = markHex(hl.attacks);
  const cardHexes = markHex(hl.cardTargets);
  const has = (arr: Hex[], hx: Hex) => arr.some((a) => hexEq(a, hx));
  const me = currentPlayer(s);

  let cells = '';
  for (const hx of hexes) {
    const isCenter = hexEq(hx, CENTER);
    const base = s.players.find((p) => hexEq(p.base, hx));
    const ring = Math.max(Math.abs(hx.q), Math.abs(hx.r), Math.abs(-hx.q - hx.r));
    let cls = 'cell' + (ring % 2 ? ' alt' : '');
    if (isCenter) cls += ' center';
    let style = '';
    const home = s.players.find((p) => p.alive && hexDistance(p.base, hx) <= 2);
    if (home && !base) {
      cls += ' home';
      style = `--pc:${home.color}`;
    }
    if (base) {
      cls += base.alive ? ' base' : ' base dead';
      style = `--pc:${base.color}`;
    }
    cells += `<polygon class="${cls}" style="${style}" points="${hexPoints(hx, S - 0.6)}" data-q="${hx.q}" data-r="${hx.r}"/>`;
  }

  let overlays = '';
  // Centre marker
  if (s.flag.pos) {
    const f = px(s.flag.pos);
    overlays += `<text class="flag-icon" x="${f.x + 2}" y="${f.y + 8}">🚩</text>`;
  }
  // Bases
  for (const p of s.players) {
    const { x, y } = px(p.base);
    if (!p.alive) {
      overlays += `<text class="base-icon dead" x="${x}" y="${y + 6}">✖</text>`;
      continue;
    }
    const frac = Math.max(0, p.baseHp / RULES.baseHp);
    if (p.ruined) {
      overlays += `<g class="base-g ruined" style="--pc:${p.color}">
      <text class="base-icon" x="${x}" y="${y - 3}">🏚</text>
      <rect x="${x - 14}" y="${y + 10}" width="28" height="4" rx="2" class="hpbg"/>
      <rect x="${x - 14}" y="${y + 10}" width="${28 * frac}" height="4" rx="2" fill="#9aa0a6"/>
      <text class="base-hp" x="${x}" y="${y + 22}">🔨${p.baseHp}/${RULES.baseHp}</text>
    </g>`;
      continue;
    }
    overlays += `<g class="base-g" style="--pc:${p.color}">
      ${p.index === s.current && s.active?.kind === 'base' ? `<polygon class="base-active" points="${hexPoints(p.base, S + 2)}"/>` : ''}
      <text class="base-icon" x="${x}" y="${y - 3}">🏰</text>
      <rect x="${x - 14}" y="${y + 10}" width="28" height="4" rx="2" class="hpbg"/>
      <rect x="${x - 14}" y="${y + 10}" width="${28 * frac}" height="4" rx="2" fill="${p.color}"/>
      <text class="base-hp" x="${x}" y="${y + 22}">${p.baseHp}</text>
    </g>`;
  }
  // Skulls where pieces died (under everything else)
  const skullHexes = new Map<string, { n: number; last: (typeof s.corpses)[number] }>();
  for (const c of s.corpses) {
    const k = `${c.pos.q},${c.pos.r}`;
    skullHexes.set(k, { n: (skullHexes.get(k)?.n ?? 0) + 1, last: c });
  }
  for (const { n, last } of skullHexes.values()) {
    const { x, y } = px(last.pos);
    overlays += `<g class="skull" style="--pc:${s.players[last.owner].color}"><title>${n > 1 ? `${n} fallen pieces` : `Fallen ${s.players[last.owner].name} ${PIECES[last.kind].name}`}</title>
      <text class="skull-icon" x="${x}" y="${y + 6}">💀</text><circle class="skull-dot" cx="${x + 9}" cy="${y + 8}" r="3"/>${n > 1 ? `<text class="skull-n" x="${x - 10}" y="${y + 10}">${n}</text>` : ''}</g>`;
  }
  // Move highlights
  for (const m of hl.moves) {
    const { x, y } = px(m);
    overlays += `<circle class="hl-move" cx="${x}" cy="${y}" r="6"/>`;
  }
  // Pieces
  for (const p of s.pieces) {
    const { x, y } = px(p.pos);
    const owner = s.players[p.owner];
    const sel = s.active?.kind === 'piece' && s.active.id === p.id;
    const ready = p.owner === s.current && !owner.isBot && canBeUnit(s, { kind: 'piece', id: p.id }) && !sel;
    const benched = p.owner === s.current && !owner.isBot && s.turnActed && !sel;
    const arrowsHere = ui.arrows.filter((id) => id === p.id).length;
    const frac = Math.max(0, p.hp / p.maxHp);
    const big = p.kind === 'king' || p.kind === 'queen';
    overlays += `<g class="piece ${sel ? 'sel' : ''} ${ready ? 'ready' : ''} ${benched ? 'benched' : ''}" data-piece="${p.id}">
      <circle cx="${x}" cy="${y}" r="${big ? 15 : 13.5}" fill="${owner.color}" class="disc"/>
      ${p.shield ? `<circle cx="${x}" cy="${y}" r="${big ? 18 : 16.5}" class="shield"/>` : ''}
      <text class="glyph" x="${x}" y="${y + 7}">${PIECES[p.kind].glyph}</text>
      <rect x="${x - 12}" y="${y + 13}" width="24" height="3.5" rx="1.7" class="hpbg"/>
      <rect x="${x - 12}" y="${y + 13}" width="${24 * frac}" height="3.5" rx="1.7" class="hp ${frac <= 0.34 ? 'low' : ''}"/>
      ${p.bonusDamage ? `<text class="badge" x="${x + 12}" y="${y - 9}">+${p.bonusDamage}</text>` : ''}
      ${p.armor ? `<text class="armor-badge" x="${x - 13}" y="${y + 18}">${ARMORS[p.armor].icon}</text>` : ''}
      ${p.shackles ? `<text class="armor-badge" x="${x + 13}" y="${y + 18}">⛓</text>` : ''}
      ${arrowsHere ? `<circle cx="${x - 12}" cy="${y - 11}" r="7" class="arrow-badge"/><text class="arrow-count" x="${x - 12}" y="${y - 8}">${arrowsHere}</text>` : ''}
      ${s.flag.carrier === p.id ? `<circle cx="${x}" cy="${y}" r="${big ? 19 : 17.5}" class="carrier-ring"/><text class="carrier-flag" x="${x + 13}" y="${y - 7}">🚩</text>` : ''}
    </g>`;
  }
  // Shackles: capture targets (a move onto an enemy piece)
  for (const m of hl.moves) {
    if (!pieceAt(s, m)) continue;
    const { x, y } = px(m);
    overlays += `<circle class="hl-capture" cx="${x}" cy="${y}" r="17"/><text class="capture-icon" x="${x}" y="${y - 14}">⛓</text>`;
  }
  // A card waiting for you to pick which piece plays it
  if (ui.cardIntent !== null) {
    const card = me.hand.find((c) => c.uid === ui.cardIntent);
    if (card) for (const u of unitsThatCanPlay(s, card)) {
      const p = u.kind === 'piece' ? pieceById(s, u.id) : undefined;
      if (p) overlays += `<polygon class="hl-card" style="--pc:${me.color}" points="${hexPoints(p.pos, S - 2)}"/>`;
    }
  }
  // Attack + card target highlights (drawn on top)
  for (const hx of atkHexes) overlays += `<polygon class="hl-attack" points="${hexPoints(hx, S - 2)}"/>`;
  for (const hx of cardHexes) overlays += `<polygon class="hl-card" style="--pc:${me.color}" points="${hexPoints(hx, S - 2)}"/>`;
  // Click layer: transparent hexes on top so every click maps to a hex.
  let hits = '';
  for (const hx of hexes) {
    const clickable = has(hl.moves, hx) || has(atkHexes, hx) || has(cardHexes, hx) || (pieceAt(s, hx)?.owner === s.current && !me.isBot);
    hits += `<polygon class="hit ${clickable ? 'clickable' : ''}" points="${hexPoints(hx)}" data-q="${hx.q}" data-r="${hx.r}"/>`;
  }
  return `<svg class="board" viewBox="${-w / 2} ${-h / 2} ${w} ${h}" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="glow"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient></defs>
    <circle cx="0" cy="0" r="${S * 4}" fill="url(#glow)"/>
    ${cells}${overlays}<g id="aoe"></g>${hits}</svg>`;
}

// ------------------------------------------------------------------ panels

function renderCard(card: Card, playable: boolean, pending: boolean, discardable: boolean, forcedDiscard: boolean) {
  const s = ui.state!;
  const d = CARDS[card.id];
  const icon = d.summons ? PIECES[d.summons].glyph : CATEGORY_ICON[d.id] ?? '✦';
  const stats = d.summons ? `<div class="stats"><span>❤ ${PIECES[d.summons].hp}</span><span>🎲 d${PIECES[d.summons].die}</span></div>` : '';
  const switchTo = !playable && !forcedDiscard && !ui.busy ? unitsThatCanPlay(s, card) : [];
  const reason = playable || switchTo.length ? null : cardBlockReason(s, s.current, card);
  const switchNote = switchTo.length
    ? `\n\n↪ Click to switch to ${switchTo.length > 1 ? 'one of your pieces that can play it' : switchTo[0].kind === 'base' ? 'your base' : `your ${PIECES[pieceById(s, switchTo[0].id)!.kind].name}`} and play it (you can switch until your unit acts).`
    : '';
  const tip = `${d.name} — ${cardUsersText(d)}.\n${d.text}${reason && !forcedDiscard ? `\n\n✖ ${reason}` : ''}${switchNote}${forcedDiscard ? '\n\nClick to discard this card.' : ''}`;
  if (switchTo.length) playable = true;
  return `<button class="card cat-${d.category} cls-${d.cls} ${playable || forcedDiscard ? 'playable' : 'dim'} ${pending || ui.cardIntent === card.uid ? 'pending' : ''} ${switchTo.length ? 'via-switch' : ''} ${forcedDiscard ? 'to-discard' : ''}" data-card="${card.uid}" title="${escapeHtml(tip)}">
    <span class="cost">${d.cost}</span>
    ${discardable && !forcedDiscard ? `<span class="discard" data-discard="${card.uid}" title="Discard this card">✕</span>` : ''}
    <span class="cls">${CLASS_BADGE[d.cls]}</span>
    <span class="icon">${icon}</span>
    <span class="name">${d.name}</span>
    ${stats}
    <span class="text">${d.text}</span>
    <span class="cat">${CATEGORY_LABEL[d.category]}</span>
  </button>`;
}

function flagStatus(): string {
  const s = ui.state!;
  const c = flagCarrier(s);
  if (c) {
    const o = s.players[c.owner];
    return `🚩 <b style="color:${o.color}">${escapeHtml(o.name)}</b>'s ${PIECES[c.kind].name} carries the flag. ${hexDistance(c.pos, o.base)} hexes from home.`;
  }
  const f = flagHex(s);
  if (!f) return '🚩 The flag is missing.';
  return hexEq(f, CENTER) ? '🚩 The flag waits on the centre hex. Grab it and bring it to your base!' : `🚩 The flag lies on the ground at (${f?.q},${f?.r}). Anyone can grab it.`;
}

/** What the selected piece can still do this turn, and why not if it can't. */
function actionChecklist(p: Piece): string {
  const s = ui.state!;
  const me = currentPlayer(s);
  const row = (state: 'open' | 'done' | 'none', label: string) =>
    `<li class="act ${state}">${state === 'done' ? '✓' : state === 'open' ? '●' : '○'} ${label}</li>`;
  const moves = legalMoves(s, p).length;
  const atks = legalAttacks(s, p).length;
  const playable = me.hand.filter((c) => CARDS[c.id].cls !== 'conjuration' && canPlayCard(s, s.current, c)).length;
  const fits = me.hand.filter((c) => CARDS[c.id].cls !== 'conjuration' && canClassBeUsedBy(CARDS[c.id].cls, p.kind)).length;
  const cardsLeft = RULES.cardsPerPieceTurn - s.cardsUsed;
  return `<ul class="actions">
    ${p.movesLeft <= 0 ? row('done', 'Moved') : moves ? row('open', `<b>Move</b>: click a white dot${p.movesLeft > 1 ? ` (${p.movesLeft} moves left)` : ''}`) : row('none', 'Move: no free hex to move to')}
    ${p.attacksLeft <= 0 ? row('done', 'Attacked') : atks ? row('open', `<b>Attack</b>: click a red hex${p.attacksLeft > 1 ? ` (${p.attacksLeft} attacks left)` : ''}`) : row('none', `Attack: no enemy in reach yet (must be adjacent)`)}
    ${cardsLeft <= 0 ? row('done', 'Card played') : playable ? row('open', `<b>Card</b>: ${playable} glowing card${playable > 1 ? 's' : ''} in your hand`) : row('none', fits ? 'Card: not enough energy or no target for your cards' : `Card: none of your cards can be used by a ${PIECES[p.kind].name}`)}
  </ul>
  <div class="muted small">Do these in any order, then press End turn.</div>`;
}

/** The "this turn's unit" panel. */
function unitPanel(): string {
  const s = ui.state!;
  const me = currentPlayer(s);
  if (me.isBot) return '<div class="hint">Bot is playing…</div>';
  if (s.mustDiscard > 0) return `<div class="hint strong warn">✋ You have ${me.hand.length} cards — click ${s.mustDiscard === 1 ? 'a card' : `${s.mustDiscard} cards`} in your hand to discard (limit ${RULES.handLimit}).</div>`;
  const baseBtn = me.ruined
    ? `<div class="hint warn">🏚 Your base is in ruins (${me.baseHp}/${RULES.baseHp} rebuilt). Stand a King or Rook on it and press Rebuild (1d8 per turn). Lose every King and Rook and you're out.</div>`
    : canBeUnit(s, { kind: 'base' }) && s.active?.kind !== 'base'
    ? `<button id="usebase" class="btn">🏰 Use my base (conjure pieces)</button>` : '';
  const lock = s.turnActed ? '<span class="locked">🔒 locked in for this turn</span>' : '<span class="muted">You can still switch.</span>';
  if (!s.active) {
    return `<div class="hint strong"><b>Pick ONE unit for this turn:</b> your base (play conjuration cards) or one piece (move, play 1 card, attack — any order).</div>
      <div class="hint">Click a glowing piece, or:</div>${baseBtn}`;
  }
  if (s.active.kind === 'base') {
    return `<div class="selinfo" style="--pc:${me.color}"><div class="big">🏰 Base</div>
      <div>Play conjuration cards to summon pieces next to it (as many as your energy allows).</div><div>${lock}</div></div>`;
  }
  const sel = activePiece(s);
  if (!sel) return `<div class="hint">Your unit fell this turn. End your turn.</div>`;
  const st = PIECES[sel.kind];
  return `<div class="selinfo" style="--pc:${me.color}">
      <div class="big">${st.glyph} ${st.name}${s.flag.carrier === sel.id ? ' 🚩' : ''}</div>
      <div>❤ ${sel.hp}/${sel.maxHp}${sel.shield ? ` · 🔵 shield ${sel.shield}` : ''} · 🎲 d${st.die}${sel.bonusDamage ? ` +${sel.bonusDamage}` : ''}</div>
      ${sel.armor ? `<div>${ARMORS[sel.armor].icon} ${ARMORS[sel.armor].name}: ${ARMORS[sel.armor].pool ? `soaks ${sel.armorPool ?? 0} more damage` : `−${ARMORS[sel.armor].reduce} on every hit`}</div>` : ''}
      ${sel.shackles ? `<div>⛓ Shackles: move onto an enemy piece with less than ${sel.hp} HP to capture it (Shift+click to attack instead)</div>` : ''}
      ${canRebuild(s, sel) ? `<button id="rebuild" class="btn">🔨 Rebuild base (1d8 · uses this piece's attack and move)</button>` : ''}
      ${actionChecklist(sel)}
      <div>${lock}</div>
    </div>${s.turnActed ? '' : baseBtn}`;
}

function renderSidebar() {
  const s = ui.state!;
  const players = s.players.map((p) => {
    const pieces = s.pieces.filter((x) => x.owner === p.index).length;
    return `<div class="pl ${p.index === s.current ? 'cur' : ''} ${p.alive ? '' : 'out'}" style="--pc:${p.color}">
      <span class="swatch"></span>
      <span class="pname">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
      <span class="pmeta">${p.ruined ? `🏚 ruin ${p.baseHp}/${RULES.baseHp}` : `🏰 ${Math.max(0, p.baseHp)}`} · ♟ ${pieces} · 🂠 ${p.hand.length} · deck ${p.deck.length}${p.prisoners.length ? ` · <span title="Prisoners held at this base: ${p.prisoners.map((x) => `${s.players[x.owner].name} ${PIECES[x.kind].name}`).join(', ')}">⛓ ${p.prisoners.map((x) => `<span style="color:${s.players[x.owner].color}">${PIECES[x.kind].glyph}</span>`).join('')}</span>` : ''}</span>
    </div>`;
  }).join('');

  let info = unitPanel();
  if (ui.pendingCard !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.pendingCard);
    if (card && CARDS[card.id].targeting === 'arrows') {
      const n = CARDS[card.id].amount ?? 4;
      info = `<div class="hint strong">🏹 <b>Cordon of Arrows</b>: click enemy pieces in range to assign arrows (<b>${ui.arrows.length}/${n}</b>). The same target can take several.
        <div class="row-btns"><button id="fire" class="btn primary" ${ui.arrows.length === n ? '' : 'disabled'}>Fire!</button> <button id="resetarrows" class="btn ghost">Reset</button> <button id="cancel" class="link">Cancel</button></div></div>`;
    } else if (card) info = `<div class="hint strong">Playing <b>${CARDS[card.id].name}</b>: click a highlighted target. <button id="cancel" class="link">Cancel</button></div>`;
  }
  const logLines = s.log.slice(-80).map((l) => `<div class="${l.startsWith('—') ? 'turn' : l.startsWith('  ') ? 'sub' : ''}">${escapeHtml(l)}</div>`).join('');
  return `<aside class="side">
    <div class="panel players">${players}</div>
    <div class="panel flag">${flagStatus()}</div>
    <div class="panel info">${info}</div>
    <div class="panel log" id="log">${logLines}</div>
  </aside>`;
}

function hudMode(): string {
  const s = ui.state!;
  const bots = s.players.filter((p) => p.isBot);
  if (!bots.length) return '🧑 Hot-seat';
  const diffs = [...new Set(bots.map((b) => DIFF_INFO[b.difficulty].label))].join('/');
  return `🤖 ${diffs} · ${s.mode === 'dogpile' ? '🐺 Dogpile' : '⚔ Free for All'}`;
}

function renderGame() {
  const s = ui.state!;
  const me = currentPlayer(s);
  const hl = highlights();
  const showHand = !me.isBot && ui.revealed;
  const hand = showHand
    ? me.hand.map((c) => renderCard(c, !ui.busy && canPlayCard(s, s.current, c), c.uid === ui.pendingCard, !ui.busy && s.winner === null, s.mustDiscard > 0)).join('') || '<div class="empty">No cards in hand</div>'
    : `<div class="empty">${me.isBot ? `${escapeHtml(me.name)} (bot) is thinking…` : 'Hand hidden'}</div>`;
  const energyPips = Array.from({ length: RULES.energyMax }, (_, i) => `<span class="pip ${i < me.energy ? 'on' : ''}"></span>`).join('');

  app.innerHTML = `
  <div class="game" style="--cur:${me.color}">
    <header class="top">
      <div class="logo small">Die <span>Build</span> Die</div>
      <div class="turn"><span class="swatch"></span><span><b>${escapeHtml(me.name)}'s</b> turn · Round ${s.round}</span></div>
      <div class="modechip" title="AI difficulty and game mode">${hudMode()}</div>
      <div class="energy" title="Energy pays for cards">⚡ ${me.energy} ${energyPips}</div>
      <div class="spacer"></div>
      <a class="btn ghost" href="${RULES_URL}" target="_blank" rel="noopener">Rules</a>
      <button class="btn ghost" id="newgame">New game</button>
      <button class="btn primary" id="endturn" ${ui.busy || me.isBot || s.winner !== null || s.mustDiscard > 0 ? 'disabled' : ''}>End turn ⏎</button>
    </header>
    <main class="main">
      <div class="board-wrap">${renderBoard(hl)}</div>
      ${renderSidebar()}
    </main>
    <footer class="hand ${s.mustDiscard > 0 && showHand ? 'discarding' : ''}">${s.mustDiscard > 0 && showHand ? `<div class="discard-banner">Hand limit ${RULES.handLimit}: click ${s.mustDiscard === 1 ? 'a card' : `${s.mustDiscard} cards`} to discard and finish your turn</div>` : ''}${hand}</footer>
    <div class="dice-overlay" id="dice"></div>
    ${!ui.revealed && s.winner === null ? `<div class="modal"><div class="modal-card" style="--pc:${me.color}">
      <div class="swatch big"></div><h2>${escapeHtml(me.name)}'s turn</h2><p>Pass the device to ${escapeHtml(me.name)}.</p>
      <button class="btn primary" id="reveal">Show my hand</button></div></div>` : ''}
    ${s.winner !== null ? `<div class="modal"><div class="modal-card" style="--pc:${s.players[s.winner].color}">
      ${(() => {
        const w = s.players[s.winner!];
        const humans = s.players.filter((p) => !p.isBot);
        const lost = w.isBot && humans.length === 1;
        const won = !w.isBot && humans.length === 1;
        return lost
          ? `<div class="trophy">💀</div><h2>Defeat</h2><p class="small">${escapeHtml(w.name)} wins${s.mode === 'dogpile' ? ' for the AI pack' : ''}.</p>`
          : `<div class="trophy">🏆</div><h2>${won ? 'Victory! ' : ''}${escapeHtml(w.name)} wins!</h2>`;
      })()}<p>${escapeHtml(s.winReason ?? '')} · Round ${s.round}</p>
      <button class="btn primary" id="again">Play again</button> <button class="btn ghost" id="setup">Change setup</button></div></div>` : ''}
  </div>`;

  const logEl = document.getElementById('log');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
  bindGame();
}

// ------------------------------------------------------------------ input

function bindGame() {
  const s = ui.state!;
  app.querySelector('#newgame')?.addEventListener('click', () => {
    if (s.winner !== null || confirm('Abandon this game and return to setup?')) {
      ui.state = null;
      renderSetup();
    }
  });
  app.querySelector('#endturn')?.addEventListener('click', () => void doAction({ type: 'endTurn' }));
  app.querySelector('#reveal')?.addEventListener('click', () => {
    ui.revealed = true;
    renderGame();
  });
  app.querySelector('#again')?.addEventListener('click', startGame);
  app.querySelector('#setup')?.addEventListener('click', () => {
    ui.state = null;
    renderSetup();
  });
  app.querySelector('#cancel')?.addEventListener('click', () => {
    ui.pendingCard = null;
    ui.arrows = [];
    renderGame();
  });
  app.querySelector('#rebuild')?.addEventListener('click', () => { const p = activePiece(ui.state!); if (p) void doAction({ type: 'rebuild', pieceId: p.id }); });
  app.querySelector('#usebase')?.addEventListener('click', () => void doAction({ type: 'selectUnit', unit: { kind: 'base' } }));
  app.querySelector('#resetarrows')?.addEventListener('click', () => {
    ui.arrows = [];
    renderGame();
  });
  app.querySelector('#fire')?.addEventListener('click', () => {
    if (ui.pendingCard === null) return;
    void doAction({ type: 'playCard', cardUid: ui.pendingCard, arrows: [...ui.arrows] });
  });
  app.querySelectorAll<HTMLElement>('[data-card]').forEach((el) =>
    el.addEventListener('click', () => onCardClick(Number(el.dataset.card))),
  );
  app.querySelectorAll<SVGElement>('.hit').forEach((el) => {
    const h = { q: Number(el.dataset.q), r: Number(el.dataset.r) };
    el.addEventListener('click', (e) => onHexClick(h, (e as MouseEvent).shiftKey));
    el.addEventListener('mouseenter', () => previewArea(h));
  });
  app.querySelectorAll<HTMLElement>('[data-discard]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const s2 = ui.state!;
      if (ui.busy || currentPlayer(s2).isBot || s2.winner !== null) return;
      const uid = Number(el.dataset.discard);
      const card = currentPlayer(s2).hand.find((c) => c.uid === uid);
      if (card && confirm(`Discard ${CARDS[card.id].name}?`)) void doAction({ type: 'discard', cardUid: uid });
    }),
  );
}

function onCardClick(uid: number) {
  const s = ui.state!;
  if (ui.busy || currentPlayer(s).isBot || s.winner !== null) return;
  const card = currentPlayer(s).hand.find((c) => c.uid === uid);
  if (!card) return;
  if (s.mustDiscard > 0) {
    void doAction({ type: 'discard', cardUid: uid });
    return;
  }
  if (!canPlayCard(s, s.current, card)) {
    // Not playable by the current pick: switch to a unit that can play it (allowed until your unit acts).
    const units = unitsThatCanPlay(s, card);
    if (units.length === 1) {
      void doAction({ type: 'selectUnit', unit: units[0] }).then(() => onCardClick(uid));
    } else if (units.length > 1) {
      ui.cardIntent = ui.cardIntent === uid ? null : uid;
      renderGame();
    }
    return;
  }
  ui.cardIntent = null;
  if (ui.pendingCard === uid) {
    ui.pendingCard = null;
    ui.arrows = [];
    renderGame();
    return;
  }
  const t = CARDS[card.id].targeting;
  if (t === 'none' || t === 'self') {
    void doAction({ type: 'playCard', cardUid: uid });
    return;
  }
  ui.pendingCard = uid;
  ui.arrows = [];
  renderGame();
}

/** While an area card is selected, outline its blast radius under the mouse. */
function previewArea(h: Hex) {
  const g = document.getElementById('aoe');
  if (!g) return;
  const s = ui.state!;
  const card = ui.pendingCard !== null ? currentPlayer(s).hand.find((c) => c.uid === ui.pendingCard) : undefined;
  const def = card ? CARDS[card.id] : undefined;
  if (!def || def.targeting !== 'areaHex' || !highlights().cardTargets.some((t) => t.kind === 'hex' && hexEq(t.hex, h))) {
    g.innerHTML = '';
    return;
  }
  const r = def.radius ?? 0;
  const { pieces, bases } = areaVictims(s, h, r);
  g.innerHTML =
    hexagonBoard(RULES.boardRadius).filter((x) => hexDistance(x, h) <= r).map((x) => `<polygon class="aoe" points="${hexPoints(x, S - 1)}"/>`).join('') +
    pieces.map((p) => { const c = px(p.pos); return `<circle class="aoe-victim" cx="${c.x}" cy="${c.y}" r="16"/>`; }).join('') +
    bases.map((b) => { const c = px(b.base); return `<circle class="aoe-victim" cx="${c.x}" cy="${c.y}" r="18"/>`; }).join('');
}

function onHexClick(h: Hex, shift = false) {
  const s = ui.state!;
  if (ui.busy || currentPlayer(s).isBot || s.winner !== null || s.mustDiscard > 0) return;
  const hl = highlights();
  const piece = pieceAt(s, h);
  const base = baseAt(s, h);
  const targetsHere: Target[] = [];
  if (piece) targetsHere.push({ kind: 'piece', id: piece.id });
  if (base) targetsHere.push({ kind: 'base', owner: base.index });
  targetsHere.push({ kind: 'hex', hex: h });

  if (ui.pendingCard !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.pendingCard);
    const def = card ? CARDS[card.id] : undefined;
    const t = targetsHere.find((t) => hl.cardTargets.some((c) => sameTarget(c, t)));
    if (def?.targeting === 'arrows') {
      if (t && t.kind === 'piece' && ui.arrows.length < (def.amount ?? 4)) ui.arrows.push(t.id);
      renderGame();
      return;
    }
    if (t) void doAction({ type: 'playCard', cardUid: ui.pendingCard, target: t });
    else {
      ui.pendingCard = null;
      renderGame();
    }
    return;
  }
  if (ui.cardIntent !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.cardIntent);
    const uid = ui.cardIntent;
    ui.cardIntent = null;
    if (card && piece && piece.owner === s.current && unitsThatCanPlay(s, card).some((u) => u.kind === 'piece' && u.id === piece.id)) {
      void doAction({ type: 'selectUnit', unit: { kind: 'piece', id: piece.id } }).then(() => onCardClick(uid));
      return;
    }
    renderGame();
    return;
  }
  const ap = activePiece(s);
  if (ap) {
    // Shackles: moving onto an enemy piece captures it. That wins over attacking it; Shift+click attacks instead.
    if (piece && piece.owner !== s.current && hl.moves.some((m) => hexEq(m, h)) && !shift) {
      void doAction({ type: 'move', pieceId: ap.id, to: h });
      return;
    }
    const atk = targetsHere.find((t) => hl.attacks.some((a) => sameTarget(a, t)));
    if (atk) {
      void doAction({ type: 'attack', pieceId: ap.id, target: atk });
      return;
    }
    if (hl.moves.some((m) => hexEq(m, h))) {
      void doAction({ type: 'move', pieceId: ap.id, to: h });
      return;
    }
  }
  // Pick a unit: one of your pieces, or your base hex when nothing of yours stands on it.
  if (piece && piece.owner === s.current && canBeUnit(s, { kind: 'piece', id: piece.id }) && !(s.active?.kind === 'piece' && s.active.id === piece.id)) {
    void doAction({ type: 'selectUnit', unit: { kind: 'piece', id: piece.id } });
    return;
  }
  if (!piece && base && base.index === s.current && canBeUnit(s, { kind: 'base' }) && s.active?.kind !== 'base') {
    void doAction({ type: 'selectUnit', unit: { kind: 'base' } });
    return;
  }
  renderGame();
}

document.addEventListener('keydown', (e) => {
  if (!ui.state) return;
  if (e.key === 'Escape') {
    ui.cardIntent = null;
    ui.pendingCard = null;
    ui.arrows = [];
    renderGame();
  } else if (e.key === 'Enter' && !ui.busy && !currentPlayer(ui.state).isBot && ui.revealed && ui.state.winner === null && ui.state.mustDiscard === 0) {
    void doAction({ type: 'endTurn' });
  }
});

// ------------------------------------------------------------------ action loop

async function playEvents(events: GameEvent[], fast: boolean) {
  const host = document.getElementById('dice');
  if (!host) return;
  for (const e of events) {
    if (e.type === 'roll') {
      await animateRoll(host, { ...e, color: ui.state!.players[e.player].color, fast: fast || ui.fastDice });
    }
  }
}

async function doAction(action: Action) {
  const s = ui.state!;
  const actorWasBot = currentPlayer(s).isBot;
  const who = s.current;
  let events: GameEvent[];
  try {
    events = applyAction(s, action);
  } catch (err) {
    console.warn(err);
    return;
  }
  ui.pendingCard = null;
  ui.arrows = [];
  ui.busy = true;
  renderGame();
  await playEvents(events, actorWasBot);
  ui.busy = false;
  const turnPassed = s.current !== who;
  if (turnPassed) {
    ui.selectedPiece = null;
    ui.revealed = !needsHandoff();
  }
  renderGame();
  if (turnPassed) void maybeRunBot();
}

let botRunning = false;
async function maybeRunBot() {
  if (botRunning) return;
  botRunning = true;
  try {
    const s = ui.state!;
    while (ui.state === s && s.winner === null && currentPlayer(s).isBot) {
      await new Promise((r) => setTimeout(r, ui.fastDice ? 120 : 380));
      if (ui.state !== s) break;
      const action = chooseBotAction(s);
      const who = currentPlayer(s).name;
      if (action.type !== 'endTurn') console.debug(`[bot ${who}]`, action.type, action.type === 'attack' ? targetName(s, action.target) : '');
      botRunning = true;
      await doActionNoChain(action);
    }
  } finally {
    botRunning = false;
  }
}

/** Like doAction, but does not recursively start the bot loop (the loop drives itself). */
async function doActionNoChain(action: Action) {
  const s = ui.state!;
  const whoBot = s.current;
  let events: GameEvent[];
  try {
    events = applyAction(s, action);
  } catch (err) {
    console.warn(err);
    applyAction(s, { type: 'endTurn' });
    events = [];
  }
  ui.selectedPiece = null;
  ui.pendingCard = null;
  ui.busy = true;
  renderGame();
  await playEvents(events, true);
  ui.busy = false;
  if (s.current !== whoBot) ui.revealed = !needsHandoff();
  renderGame();
}

// Expose for debugging / screenshots.
(window as unknown as { dbd: unknown }).dbd = { ui, startGame, renderGame };

renderSetup();
