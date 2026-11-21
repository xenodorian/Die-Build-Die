import './ui/style.css';
import { ARMORS, CARDS, PIECES, PLAYER_COLORS, PLAYER_NAMES, RULES, canClassBeUsedBy, type CardCategory } from './game/config';
import {
  CENTER, activePiece, applyAction, areaVictims, baseAt, canBeUnit, canPlayCard, cardBlockReason, cardTargets, cardUsersText, currentPlayer,
  endTurnDiscards, flagCarrier, flagHex, legalAttacks, legalMoves, newGame, pieceAt,
  pieceById, sameTarget,
  canRebuild,
} from './game/engine';
import * as fx from './ui/fx';
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
  /** Short message shown after a click that couldn't do anything (e.g. why a card can't be played). */
  notice: string | null;
  /** Snapshot to restore with Undo (only after a plain move: nothing random or hidden was revealed). */
  undo: { snap: GameState; label: string } | null;
  /** The first-turn help card is showing. */
  helpOpen: boolean;
  /** Skull ids that just appeared (fade in on the next render). */
  freshCorpses: Set<number>;
  /** Piece ids that were just summoned/raised (scale in on the next render). */
  freshPieces: Set<number>;
}
const ui: Ui = {
  state: null, selectedPiece: null, pendingCard: null, arrows: [], busy: false, hideHands: true, revealed: true, fastDice: false,
  cardIntent: null, notice: null, undo: null, helpOpen: false, freshCorpses: new Set(), freshPieces: new Set(),
};
const MOTION_KEY = 'dbd-reduced-motion';
fx.setReducedMotion(localStorage.getItem(MOTION_KEY) !== null ? localStorage.getItem(MOTION_KEY) === '1' : matchMedia('(prefers-reduced-motion: reduce)').matches);
const HELP_KEY = 'dbd-help-seen-v1';
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** Flash a message so a click never does 'nothing'. */
function flash(msg: string) {
  ui.notice = msg;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    ui.notice = null;
    if (ui.state) renderGame();
  }, 4500);
  renderGame();
}

/**
 * Playable by the unit you have picked right now. Summon cards belong to the base, so while a
 * piece is picked they are not "lit" (clicking one still switches to the base before you act).
 */
function directlyPlayable(s: GameState, card: Card): boolean {
  if (CARDS[card.id].cls === 'conjuration' && s.active?.kind === 'piece') return false;
  return canPlayCard(s, s.current, card);
}

/**
 * Units that could play `card` if picked now. Before your unit has acted you may still switch,
 * so a card your current pick can't use is still reachable by switching to one that can.
 */
function unitsThatCanPlay(s: GameState, card: Card): Unit[] {
  if (s.turnActed || s.winner !== null) return [];
  const saved = s.active;
  const out: Unit[] = [];
  const candidates: Unit[] = [{ kind: 'base' }, ...s.pieces.filter((p) => p.owner === s.current).map((p): Unit => ({ kind: 'piece', id: p.id }))];
  for (const u of candidates) {
    if (!canBeUnit(s, u)) continue;
    s.active = u;
    if (directlyPlayable(s, card)) out.push(u);
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
  ui.undo = null;
  ui.notice = null;
  ui.revealed = !needsHandoff();
  ui.helpOpen = !localStorage.getItem(HELP_KEY);
  renderGame();
  announceTurn();
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
const humanTurn = () => { const s = ui.state!; return s.winner === null && !currentPlayer(s).isBot && ui.revealed; };
const CATEGORY_LABEL: Record<CardCategory, string> = { conjuration: 'Conjuration', offense: 'Offense', defense: 'Defense', special: 'Special' };
const CLASS_BADGE: Record<string, string> = { conjuration: '🏰 Base', pawn: '♟ Pawn', knight: '♞ Knight', bishop: '♝ Bishop', rook: '♜ Rook', queen: '♛ Queen' };
const CATEGORY_ICON: Record<string, string> = {
  shackles: '⛓',
  firebolt: '🔥', fireball: '☄️', cordon: '🏹', gambeson: '🧥', breastplate: '🦺', plate: '🛡', armor_rend: '🔨', sharpen: '🗡️', frenzy: '⚔️', shield: '🛡️', heal: '✚', fortify: '🏰', haste: '💨', necromancy: '💀', promote_pawn_knight: '⬆️', promote_pawn_bishop: '⬆️', promote_pawn_rook: '⬆️', promote_bishop_queen: '⬆️', promote_knight_king: '👑', promote_rook_king: '👑', rally: '🎴', recall: '↩️',
};
const pieceLabel = (p: Piece) => `${PIECES[p.kind].glyph} ${PIECES[p.kind].name}`;
const cardIcon = (c: Card) => { const d = CARDS[c.id]; return d.summons ? PIECES[d.summons].glyph : CATEGORY_ICON[d.id] ?? '✦'; };

/** Why one of your own pieces can't be this turn's unit right now (null if it can). */
function pieceLockReason(s: GameState, p: Piece): string | null {
  if (canBeUnit(s, { kind: 'piece', id: p.id })) return null;
  const unit = s.active?.kind === 'base' ? 'your base' : activePiece(s) ? `your ${PIECES[activePiece(s)!.kind].name}` : 'another unit';
  if (s.turnActed) return `Locked: this turn you're using ${unit}. One unit per turn, so this piece acts next turn.`;
  if (p.movesLeft <= 0 && p.attacksLeft <= 0) return 'Summoned this turn: it can act from your next turn.';
  return 'Not available right now.';
}

/** Why a card in hand is dimmed, in a few words (shown on the card itself). */
function cardWhy(s: GameState, card: Card): string {
  const def = CARDS[card.id];
  const me = currentPlayer(s);
  const ap = activePiece(s);
  if (def.cls === 'conjuration' && s.turnActed && ap) return `Base only: this turn you're using your ${PIECES[ap.kind].name}`;
  if (def.cls !== 'conjuration' && s.turnActed && s.active?.kind === 'base') return 'Pieces are locked: this turn you\'re using your base';
  if (me.energy < def.cost && (def.cls === 'conjuration' || (ap && canClassBeUsedBy(def.cls, ap.kind)))) return `Needs ${def.cost}⚡, you have ${me.energy}`;
  return cardBlockReason(s, s.current, card) ?? '';
}

// ------------------------------------------------------------------ highlights

type HL = { moves: Hex[]; attacks: Target[]; cardTargets: Target[] };
function highlights(): HL {
  const s = ui.state!;
  const hl: HL = { moves: [], attacks: [], cardTargets: [] };
  if (s.winner !== null || ui.busy || currentPlayer(s).isBot) return hl;
  if (ui.pendingCard !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.pendingCard);
    if (card) hl.cardTargets = cardTargets(s, s.current, CARDS[card.id], CARDS[card.id].cls === 'conjuration' ? undefined : activePiece(s));
    return hl;
  }
  const ap = activePiece(s);
  if (ap) {
    hl.moves = legalMoves(s, ap);
    hl.attacks = legalAttacks(s, ap);
  }
  return hl;
}

function targetHex(t: Target): Hex | null {
  const s = ui.state!;
  if (t.kind === 'hex') return t.hex;
  if (t.kind === 'base') return s.players[t.owner].base;
  return pieceById(s, t.id)?.pos ?? null;
}

/** Hexes a card would target if played now by the current/only possible unit (for hover previews). */
function cardHoverHexes(s: GameState, card: Card): Hex[] {
  const def = CARDS[card.id];
  if (!directlyPlayable(s, card)) return [];
  const ts = def.targeting === 'none' || def.targeting === 'self'
    ? (activePiece(s) ? [{ kind: 'piece', id: activePiece(s)!.id } as Target] : [])
    : cardTargets(s, s.current, def, def.cls === 'conjuration' ? undefined : activePiece(s));
  return ts.map(targetHex).filter((x): x is Hex => !!x);
}

/** Draw a temporary emphasis outline on hexes (hovering an action in the Actions list). */
function hoverHexes(hexes: Hex[], kind: string) {
  const g = document.getElementById('hov');
  if (!g) return;
  g.innerHTML = hexes.map((h) => `<polygon class="hov ${kind}" points="${hexPoints(h, S - 1)}"/>`).join('');
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
  const showMine = !me.isBot && ui.revealed && s.winner === null;

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
    const mine = p.index === s.current && showMine;
    const baseSel = mine && s.active?.kind === 'base';
    const baseReady = mine && !baseSel && canBeUnit(s, { kind: 'base' });
    const baseLocked = mine && !baseSel && !canBeUnit(s, { kind: 'base' });
    overlays += `<g class="base-g ${baseReady ? 'ready' : ''} ${baseLocked ? 'benched' : ''}" style="--pc:${p.color}">
      ${baseSel ? `<polygon class="base-active" points="${hexPoints(p.base, S + 2)}"/>` : ''}
      ${baseReady ? `<polygon class="base-ready" points="${hexPoints(p.base, S - 1)}"/>` : ''}
      <text class="base-icon" x="${x}" y="${y - 3}">🏰</text>
      <rect x="${x - 14}" y="${y + 10}" width="28" height="4" rx="2" class="hpbg"/>
      <rect x="${x - 14}" y="${y + 10}" width="${28 * frac}" height="4" rx="2" fill="${p.color}"/>
      <text class="base-hp" x="${x}" y="${y + 22}">${p.baseHp}</text>
      ${baseLocked ? `<text class="lock" x="${x + 13}" y="${y - 9}">🔒</text>` : ''}
    </g>`;
  }
  // Skulls where pieces died
  const skullHexes = new Map<string, { n: number; last: (typeof s.corpses)[number] }>();
  for (const c of s.corpses) {
    const k = `${c.pos.q},${c.pos.r}`;
    skullHexes.set(k, { n: (skullHexes.get(k)?.n ?? 0) + 1, last: c });
  }
  for (const { n, last } of skullHexes.values()) {
    const { x, y } = px(last.pos);
    overlays += `<g class="skull ${ui.freshCorpses.has(last.id) ? 'fresh' : ''}" style="--pc:${s.players[last.owner].color}"><title>${n > 1 ? `${n} fallen pieces` : `Fallen ${s.players[last.owner].name} ${PIECES[last.kind].name}`}</title>
      <text class="skull-icon" x="${x}" y="${y + 6}">💀</text><circle class="skull-dot" cx="${x + 9}" cy="${y + 8}" r="3"/>${n > 1 ? `<text class="skull-n" x="${x - 10}" y="${y + 10}">${n}</text>` : ''}</g>`;
  }
  // Move highlights
  for (const m of hl.moves) {
    const { x, y } = px(m);
    overlays += `<polygon class="hl-move-hex" style="--pc:${me.color}" points="${hexPoints(m, S - 2)}"/><circle class="hl-move" cx="${x}" cy="${y}" r="6" data-q="${m.q}" data-r="${m.r}"/>`;
  }
  // Pieces
  for (const p of s.pieces) {
    const { x, y } = px(p.pos);
    const owner = s.players[p.owner];
    const mine = p.owner === s.current && showMine;
    const sel = s.active?.kind === 'piece' && s.active.id === p.id;
    const ready = mine && !sel && canBeUnit(s, { kind: 'piece', id: p.id });
    const benched = mine && !sel && !ready;
    const sick = mine && !s.turnActed && p.movesLeft <= 0 && p.attacksLeft <= 0;
    const arrowsHere = ui.arrows.filter((id) => id === p.id).length;
    const frac = Math.max(0, p.hp / p.maxHp);
    const big = p.kind === 'king' || p.kind === 'queen';
    const rad = big ? 15 : 13.5;
    // Action pips (your pieces, your turn): move (white) and attack (red); hollow = used.
    const pips = mine && !sick
      ? `<circle class="pip-mv ${p.movesLeft > 0 && !benched ? 'on' : ''}" cx="${x - 5}" cy="${y - rad - 3}" r="2.6"/><circle class="pip-at ${p.attacksLeft > 0 && !benched ? 'on' : ''}" cx="${x + 5}" cy="${y - rad - 3}" r="2.6"/>`
      : '';
    overlays += `<g class="piece ${sel ? 'sel' : ''} ${ready ? 'ready' : ''} ${benched ? 'benched' : ''} ${ui.freshPieces.has(p.id) ? 'spawn' : ''}" data-piece="${p.id}">
      <g class="pbody">
      <circle cx="${x}" cy="${y}" r="${rad}" fill="${owner.color}" class="disc"/>
      ${p.shield ? `<circle cx="${x}" cy="${y}" r="${big ? 18 : 16.5}" class="shield"/>` : ''}
      <text class="glyph" x="${x}" y="${y + 7}">${PIECES[p.kind].glyph}</text>
      <rect x="${x - 12}" y="${y + 13}" width="24" height="3.5" rx="1.7" class="hpbg"/>
      <rect x="${x - 12}" y="${y + 13}" width="${24 * frac}" height="3.5" rx="1.7" class="hp ${frac <= 0.34 ? 'low' : ''}"/>
      ${p.bonusDamage ? `<text class="badge" x="${x + 12}" y="${y - 9}">+${p.bonusDamage}</text>` : ''}
      ${p.armor ? `<text class="armor-badge" x="${x - 13}" y="${y + 18}">${ARMORS[p.armor].icon}</text>` : ''}
      ${p.shackles ? `<text class="armor-badge" x="${x + 13}" y="${y + 18}">⛓</text>` : ''}
      ${pips}
      ${benched ? `<text class="lock" x="${x + 12}" y="${y - 8}">${sick ? '💤' : '🔒'}</text>` : ''}
      ${arrowsHere ? `<circle cx="${x - 12}" cy="${y - 11}" r="7" class="arrow-badge"/><text class="arrow-count" x="${x - 12}" y="${y - 8}">${arrowsHere}</text>` : ''}
      ${s.flag.carrier === p.id ? `<circle cx="${x}" cy="${y}" r="${big ? 19 : 17.5}" class="carrier-ring"/><text class="carrier-flag" x="${x + 13}" y="${y - 7}">🚩</text>` : ''}
      </g>
    </g>`;
  }
  for (const m of hl.moves) {
    if (!pieceAt(s, m)) continue;
    const { x, y } = px(m);
    overlays += `<circle class="hl-capture" cx="${x}" cy="${y}" r="17"/><text class="capture-icon" x="${x}" y="${y - 14}">⛓</text>`;
  }
  if (ui.cardIntent !== null) {
    const card = me.hand.find((c) => c.uid === ui.cardIntent);
    if (card) for (const u of unitsThatCanPlay(s, card)) {
      const p = u.kind === 'piece' ? pieceById(s, u.id) : undefined;
      if (p) overlays += `<polygon class="hl-card" style="--pc:${me.color}" points="${hexPoints(p.pos, S - 2)}"/>`;
    }
  }
  for (const hx of atkHexes) overlays += `<polygon class="hl-attack" points="${hexPoints(hx, S - 2)}"/>`;
  for (const hx of cardHexes) overlays += `<polygon class="hl-card" style="--pc:${me.color}" points="${hexPoints(hx, S - 2)}"/>`;
  let hits = '';
  for (const hx of hexes) {
    const clickable = has(hl.moves, hx) || has(atkHexes, hx) || has(cardHexes, hx) || (pieceAt(s, hx)?.owner === s.current && !me.isBot);
    hits += `<polygon class="hit ${clickable ? 'clickable' : ''}" points="${hexPoints(hx)}" data-q="${hx.q}" data-r="${hx.r}"/>`;
  }
  return `<svg class="board" viewBox="${-w / 2} ${-h / 2} ${w} ${h}" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="glow"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient></defs>
    <circle cx="0" cy="0" r="${S * 4}" fill="url(#glow)"/>
    ${cells}${overlays}<g id="aoe"></g><g id="hov"></g>${hits}</svg>`;
}

// ------------------------------------------------------------------ panels

function renderCard(card: Card, index: number, playable: boolean, pending: boolean, discardable: boolean, willDiscard: boolean) {
  const s = ui.state!;
  const d = CARDS[card.id];
  const icon = cardIcon(card);
  const stats = d.summons ? `<div class="stats"><span>❤ ${PIECES[d.summons].hp}</span><span>🎲 d${PIECES[d.summons].die}</span></div>` : '';
  const switchTo = !playable && !ui.busy ? unitsThatCanPlay(s, card) : [];
  const why = playable || switchTo.length ? '' : cardWhy(s, card);
  const switchNote = switchTo.length
    ? `↪ Click to switch to ${switchTo.length > 1 ? 'one of your pieces that can play it' : switchTo[0].kind === 'base' ? 'your base' : `your ${PIECES[pieceById(s, switchTo[0].id)!.kind].name}`} (you can switch until your unit acts)`
    : '';
  const tip = `${d.name} — ${cardUsersText(d)}.\n${d.text}${why ? `\n\n✖ ${why}` : ''}${switchNote ? `\n\n${switchNote}` : ''}${willDiscard ? '\n\nOver the hand limit: this card is discarded when you end the turn (✕ another card to keep this one).' : ''}`;
  const lit = playable || switchTo.length > 0;
  return `<button class="card cat-${d.category} cls-${d.cls} ${lit ? 'playable' : 'dim'} ${pending || ui.cardIntent === card.uid ? 'pending' : ''} ${switchTo.length ? 'via-switch' : ''} ${willDiscard ? 'will-discard' : ''}" data-card="${card.uid}" title="${escapeHtml(tip)}">
    <span class="cost">${d.cost}</span>
    ${index < 9 ? `<span class="hotkey">${index + 1}</span>` : ''}
    ${discardable ? `<span class="discard" data-discard="${card.uid}" title="Discard this card">✕</span>` : ''}
    <span class="cls">${CLASS_BADGE[d.cls]}</span>
    <span class="icon">${icon}</span>
    <span class="name">${d.name}</span>
    ${stats}
    <span class="text">${d.text}</span>
    ${why ? `<span class="why">✖ ${escapeHtml(why)}</span>` : switchNote ? `<span class="why switch">↪ switch &amp; play</span>` : ''}
    ${willDiscard ? '<span class="discard-tag">discarded at end of turn</span>' : ''}
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

/** One clear sentence (plus a detail line) about what you can do right now. Never empty. */
function statusLine(): { text: string; detail: string; tone: '' | 'go' | 'warn' | 'wait' } {
  const s = ui.state!;
  const me = currentPlayer(s);
  if (s.winner !== null) return { text: `🏆 ${escapeHtml(s.players[s.winner].name)} wins.`, detail: escapeHtml(s.winReason ?? ''), tone: 'go' };
  if (me.isBot) return { text: `🤖 ${escapeHtml(me.name)} is playing…`, detail: 'Wait for your turn. You can read the log on the right meanwhile.', tone: 'wait' };
  if (!ui.revealed) return { text: `Pass the device to ${escapeHtml(me.name)}.`, detail: '', tone: 'wait' };
  const over = endTurnDiscards(s);
  const overNote = over.length ? ` Hand ${me.hand.length}/${RULES.handLimit}: End turn will discard ${over.map((c) => `<b>${CARDS[c.id].name}</b>`).join(', ')} (last), or ✕ a card yourself.` : '';
  if (ui.pendingCard !== null) {
    const card = me.hand.find((c) => c.uid === ui.pendingCard);
    const def = card ? CARDS[card.id] : undefined;
    if (def?.targeting === 'arrows') return { text: `🏹 Cordon of Arrows: click enemy pieces to assign arrows (${ui.arrows.length}/${def.amount ?? 4}), then Fire.`, detail: 'Esc or right-click cancels and returns to your piece.', tone: 'go' };
    return { text: `🎯 Playing <b>${def?.name ?? 'card'}</b>: click a highlighted target.`, detail: 'Esc, right-click or clicking elsewhere cancels. Clicking one of your pieces selects it instead.', tone: 'go' };
  }
  if (ui.cardIntent !== null) {
    const card = me.hand.find((c) => c.uid === ui.cardIntent);
    return { text: `Which piece should play <b>${card ? CARDS[card.id].name : 'it'}</b>? Click a highlighted piece.`, detail: 'Esc cancels.', tone: 'go' };
  }
  if (!s.active) {
    return { text: '👉 Pick ONE unit for this turn: click a glowing piece, or 🏰 your base.', detail: `A piece can move, attack and play 1 card (any order). Your base summons new pieces. You can switch freely until the unit's first action; then it's locked in.${overNote}`, tone: 'go' };
  }
  if (s.active.kind === 'base') {
    const summons = me.hand.filter((c) => CARDS[c.id].cls === 'conjuration' && canPlayCard(s, s.current, c)).length;
    if (!s.turnActed) return { text: `🏰 Base selected: play a summon card (${summons} playable).`, detail: `Not committed yet: click a piece to switch. After summoning you can still move and attack with a piece this turn.${overNote}`, tone: 'go' };
    return { text: summons ? `🏰 This turn you're using your base. Summon more (${me.energy}⚡ left) or select a piece to move/attack.` : '🏰 Summons done. Select a piece to move and attack, or End turn.', detail: `A summoned piece (or any piece with actions left) can still move and attack this turn.${overNote}`, tone: summons ? 'go' : 'warn' };
  }
  const p = activePiece(s);
  if (!p) return { text: 'Your unit fell this turn. Press End turn (E).', detail: overNote, tone: 'warn' };
  const left: string[] = [];
  if (legalMoves(s, p).length) left.push('move');
  if (legalAttacks(s, p).length) left.push('attack');
  if (me.hand.some((c) => directlyPlayable(s, c))) left.push('play a card');
  const can = left.length ? `It can still ${left.length > 1 ? `${left.slice(0, -1).join(', ')} or ${left[left.length - 1]}` : left[0]}.` : '';
  if (!s.turnActed) return { text: `${pieceLabel(p)} selected. ${can || 'It has nothing to do right now.'}`, detail: `Not committed yet: click another piece or the base to switch. Its first action locks it in as this turn's unit.${overNote}`, tone: 'go' };
  if (!left.length) return { text: `${pieceLabel(p)} is done for this turn. Press End turn (E).`, detail: `Other units are 🔒 locked until next turn.${overNote}`, tone: 'warn' };
  return { text: `This turn you're using your ${pieceLabel(p)}. ${can}`, detail: `Other pieces and your base are 🔒 locked until next turn.${overNote}`, tone: 'go' };
}

interface ActItem { label: string; sub?: string; state: 'open' | 'done' | 'locked' | 'info'; act?: string; hover?: Hex[]; hoverKind?: string; key?: string }

/** The live list of things you can do right now (left sidebar). */
function actionItems(): { title: string; items: ActItem[] } {
  const s = ui.state!;
  const me = currentPlayer(s);
  const items: ActItem[] = [];
  if (s.winner !== null) return { title: 'Game over', items: [{ label: 'Play again', state: 'open', act: 'again' }] };
  if (me.isBot || !ui.revealed) return { title: 'Actions', items: [{ label: me.isBot ? `${me.name} is playing…` : 'Waiting for hand-off', state: 'info' }] };
  if (ui.pendingCard !== null) {
    const card = me.hand.find((c) => c.uid === ui.pendingCard);
    const hl = highlights();
    items.push({ label: `🎯 Choose a target for ${card ? CARDS[card.id].name : 'the card'}`, sub: `${hl.cardTargets.length} target${hl.cardTargets.length === 1 ? '' : 's'} lit on the board`, state: 'info', hover: hl.cardTargets.map(targetHex).filter((x): x is Hex => !!x), hoverKind: 'card' });
    items.push({ label: 'Cancel', sub: 'Esc / right-click', state: 'open', act: 'cancel', key: 'Esc' });
    return { title: 'Actions', items };
  }
  const ap = activePiece(s);
  const unitTitle = !s.active ? 'Pick one unit' : s.active.kind === 'base' ? '🏰 Base' : ap ? pieceLabel(ap) : 'Unit';
  // 1. the selected unit's own actions
  if (ap) {
    const mv = legalMoves(s, ap);
    const at = legalAttacks(s, ap);
    items.push(ap.movesLeft <= 0
      ? { label: '✓ Moved', state: 'done' }
      : mv.length ? { label: '➜ Move', sub: `${mv.length} hex${mv.length > 1 ? 'es' : ''} lit${ap.movesLeft > 1 ? ` · ${ap.movesLeft} moves left` : ''}`, state: 'open', act: 'move', hover: mv, hoverKind: 'move' }
      : { label: '➜ Move', sub: 'No free hex to move to', state: 'locked' });
    items.push(ap.attacksLeft <= 0
      ? { label: '✓ Attacked', state: 'done' }
      : at.length ? { label: '⚔ Attack', sub: `${at.length} target${at.length > 1 ? 's' : ''} in range · d${PIECES[ap.kind].die}${ap.bonusDamage ? `+${ap.bonusDamage}` : ''}${ap.attacksLeft > 1 ? ` · ${ap.attacksLeft} attacks left` : ''}`, state: 'open', act: 'attack', hover: at.map(targetHex).filter((x): x is Hex => !!x), hoverKind: 'attack' }
      : { label: '⚔ Attack', sub: 'No enemy next to it', state: 'locked' });
    if (canRebuild(s, ap)) items.push({ label: '🔨 Rebuild base', sub: '1d8, uses move and attack', state: 'open', act: 'rebuild' });
    if (s.cardsUsed >= RULES.cardsPerPieceTurn) items.push({ label: '✓ Card played', state: 'done' });
  }
  // 2. cards (playable now first, then switchable, then dimmed with reasons)
  const cardRows: ActItem[] = [];
  me.hand.forEach((c, i) => {
    const d = CARDS[c.id];
    const direct = directlyPlayable(s, c);
    const sw = !direct ? unitsThatCanPlay(s, c) : [];
    if (ap && s.cardsUsed >= RULES.cardsPerPieceTurn && d.cls !== 'conjuration') return;
    const label = `${cardIcon(c)} ${d.name} <span class="cost-chip">${d.cost}⚡</span>`;
    if (direct) cardRows.push({ label, sub: d.cls === 'conjuration' ? 'Summon next to your base' : 'Play now', state: 'open', act: `card:${c.uid}`, hover: cardHoverHexes(s, c), hoverKind: 'card', key: i < 9 ? String(i + 1) : undefined });
    else if (sw.length) cardRows.push({ label, sub: `Switch to ${sw.length > 1 ? 'a piece that can play it' : sw[0].kind === 'base' ? 'your base' : `your ${PIECES[pieceById(s, sw[0].id)!.kind].name}`} and play`, state: 'open', act: `card:${c.uid}`, key: i < 9 ? String(i + 1) : undefined });
    else cardRows.push({ label, sub: cardWhy(s, c), state: 'locked', act: `card:${c.uid}` });
  });
  // Before a unit is picked, the units come first; after, the selected unit's cards come first.
  const unitRows: ActItem[] = [];
  {
    // Switching units (before acting) or the locked-units note (after).
    const items = unitRows;
    if (!s.turnActed) {
      if (s.active?.kind !== 'base' && canBeUnit(s, { kind: 'base' })) items.push({ label: s.active ? '↺ Switch to 🏰 Base' : '🏰 Use Base', sub: 'Summon pieces', state: 'open', act: 'sel:base', key: 'B', hover: [me.base], hoverKind: 'card' });
      for (const p of s.pieces.filter((x) => x.owner === s.current)) {
        if (s.active?.kind === 'piece' && s.active.id === p.id) continue;
        const why = pieceLockReason(s, p);
        items.push(why
          ? { label: pieceLabel(p), sub: why, state: 'locked', hover: [p.pos], hoverKind: 'lock' }
          : { label: `${s.active ? '↺ Switch to ' : ''}${pieceLabel(p)}`, sub: [legalMoves(s, p).length ? 'move' : '', legalAttacks(s, p).length ? 'attack' : ''].filter(Boolean).join(' · ') || 'cards only', state: 'open', act: `sel:${p.id}`, hover: [p.pos], hoverKind: 'card' });
      }
    } else {
      const n = s.pieces.filter((x) => x.owner === s.current && !(s.active?.kind === 'piece' && s.active.id === x.id)).length + (s.active?.kind === 'base' ? 0 : 1);
      if (n) items.push({ label: `🔒 ${n} other unit${n > 1 ? 's' : ''} locked`, sub: 'One unit per turn: they act next turn', state: 'locked' });
    }
  }
  if (!s.active) items.push(...unitRows);
  items.push(...cardRows.filter((r) => r.state === 'open'));
  const lockedCards = cardRows.filter((r) => r.state !== 'open');
  if (s.active) items.push(...unitRows);
  if (ui.undo) items.push({ label: `↶ Undo ${ui.undo.label}`, sub: 'Nothing was rolled or revealed', state: 'open', act: 'undo', key: 'U' });
  const over = endTurnDiscards(s);
  items.push({ label: 'End turn', sub: over.length ? `Discards ${over.map((c) => CARDS[c.id].name).join(', ')} (hand limit ${RULES.handLimit})` : 'Pass to the next player', state: 'open', act: 'end', key: 'E' });
  if (lockedCards.length) items.push({ label: `Not playable right now (${lockedCards.length})`, state: 'info', sub: 'Each card says why. Hover a card for details.' }, ...lockedCards);
  return { title: unitTitle, items };
}

function renderActions(): string {
  const { title, items } = actionItems();
  const s = ui.state!;
  const lockNote = s.active && !currentPlayer(s).isBot && s.winner === null ? (s.turnActed ? '<span class="locked">🔒 locked in</span>' : '<span class="muted">not committed: you can switch</span>') : '';
  return `<aside class="actions-side"><div class="panel acts">
    <div class="acts-h">Actions <span class="acts-unit">${title}</span> ${lockNote}</div>
    <ul class="act-list">${items.map((it, i) => `<li class="ai ${it.state}" ${it.act ? `data-act="${it.act}" role="button" tabindex="0"` : ''} data-ai="${i}">
      <div class="al">${it.label}${it.key ? `<kbd>${it.key}</kbd>` : ''}</div>${it.sub ? `<div class="as">${escapeHtml(it.sub).replace(/&lt;b&gt;|&lt;\/b&gt;/g, '')}</div>` : ''}</li>`).join('')}</ul>
  </div></aside>`;
}

/** Details of the selected unit (right sidebar). */
function unitPanel(): string {
  const s = ui.state!;
  const me = currentPlayer(s);
  if (me.isBot) return '<div class="hint">Bot is playing…</div>';
  if (me.ruined) return `<div class="hint warn">🏚 Your base is in ruins (${me.baseHp}/${RULES.baseHp} rebuilt). Stand a King or Rook on it and press Rebuild (1d8 per turn). Lose every King and Rook and you're out.</div>`;
  if (!s.active) return `<div class="hint">No unit selected. Click a glowing piece or your 🏰 base. Hover any piece for its stats.</div>`;
  if (s.active.kind === 'base') return `<div class="selinfo" style="--pc:${me.color}"><div class="big">🏰 Base</div><div>❤ ${me.baseHp}/${RULES.baseHp}. Play summon cards to put pieces on or next to it (as many as your energy pays for). Summoned pieces can move and attack this turn.</div></div>`;
  const sel = activePiece(s);
  if (!sel) return `<div class="hint">Your unit fell this turn. End your turn.</div>`;
  const st = PIECES[sel.kind];
  return `<div class="selinfo" style="--pc:${me.color}">
      <div class="big">${st.glyph} ${st.name}${s.flag.carrier === sel.id ? ' 🚩' : ''}</div>
      <div>❤ ${sel.hp}/${sel.maxHp}${sel.shield ? ` · 🔵 shield ${sel.shield}` : ''} · 🎲 d${st.die}${sel.bonusDamage ? ` +${sel.bonusDamage}` : ''} · moves ${sel.movesLeft} · attacks ${sel.attacksLeft}</div>
      ${sel.armor ? `<div>${ARMORS[sel.armor].icon} ${ARMORS[sel.armor].name}: ${ARMORS[sel.armor].pool ? `soaks ${sel.armorPool ?? 0} more damage` : `−${ARMORS[sel.armor].reduce} on every hit`}</div>` : ''}
      ${sel.shackles ? `<div>⛓ Shackles: move onto an enemy piece with less than ${sel.hp} HP to capture it (Shift+click to attack instead)</div>` : ''}
      ${canRebuild(s, sel) ? `<button id="rebuild" class="btn">🔨 Rebuild base (1d8 · uses this piece's attack and move)</button>` : ''}
    </div>`;
}

function renderSidebar() {
  const s = ui.state!;
  const players = s.players.map((p) => {
    const pieces = s.pieces.filter((x) => x.owner === p.index).length;
    return `<div class="pl ${p.index === s.current ? 'cur' : ''} ${p.alive ? '' : 'out'}" style="--pc:${p.color}">
      <span class="swatch"></span>
      <span class="pname">${p.index === s.current ? '▶ ' : ''}${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
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
    } else if (card) info = `<div class="hint strong">Playing <b>${CARDS[card.id].name}</b>: click a highlighted target. <button id="cancel" class="link">Cancel (Esc)</button></div>`;
  }
  const logLines = s.log.slice(-80).map((l) => `<div class="${l.startsWith('—') ? 'turn' : l.startsWith('  ') ? 'sub' : ''}">${escapeHtml(l)}</div>`).join('');
  const help = ui.helpOpen && !currentPlayer(s).isBot && ui.revealed && s.winner === null ? HELP_HTML : '';
  return `<aside class="side">${help}
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

const HELP_HTML = `<div class="helpcard" role="note"><div class="hh">How a turn works</div>
  <ol>
    <li><b>Pick ONE unit</b>: click a glowing piece, or your 🏰 base (or press <kbd>B</kbd>).</li>
    <li><b>A piece</b> can <b>move</b> (outlined hexes), <b>attack</b> (red hexes) and play <b>1 card</b>, in any order. <b>The base</b> plays summon cards.</li>
    <li>You can <b>switch</b> units freely until the first action. Then the others are 🔒 locked until next turn.</li>
    <li>The <b>Actions</b> list on the left always shows what you can do; hover an item to see it on the board.</li>
    <li><b>End turn</b> (<kbd>E</kbd>) always works. Over 7 cards, the last extras are discarded.</li>
  </ol>
  <div class="muted small">Keys: <kbd>1</kbd>–<kbd>9</kbd> cards · <kbd>B</kbd> base · <kbd>U</kbd> undo move · <kbd>Esc</kbd>/right-click cancel · <kbd>?</kbd> this help</div>
  <button class="btn primary" id="helpok">Got it</button></div>`;

function renderGame() {
  const s = ui.state!;
  const me = currentPlayer(s);
  const hl = highlights();
  const showHand = !me.isBot && ui.revealed;
  const over = showHand ? endTurnDiscards(s).map((c) => c.uid) : [];
  const hand = showHand
    ? me.hand.map((c, i) => renderCard(c, i, !ui.busy && directlyPlayable(s, c), c.uid === ui.pendingCard, !ui.busy && s.winner === null, over.includes(c.uid))).join('') || '<div class="empty">No cards in hand</div>'
    : `<div class="empty">${me.isBot ? `${escapeHtml(me.name)} (bot) is thinking…` : 'Hand hidden'}</div>`;
  const energyPips = Array.from({ length: RULES.energyMax }, (_, i) => `<span class="pip ${i < me.energy ? 'on' : ''}"></span>`).join('');
  const st = statusLine();
  const canEnd = !ui.busy && !me.isBot && s.winner === null && ui.revealed;
  const boardHtml = renderBoard(hl);
  ui.freshCorpses.clear(); // these animate once, on this render only
  ui.freshPieces.clear();

  app.innerHTML = `
  <div class="game ${me.isBot ? 'bot-turn' : 'my-turn'}" style="--cur:${me.color}">
    <header class="top">
      <div class="logo small">Die <span>Build</span> Die</div>
      <div class="turn"><span class="swatch pulse"></span><span><b>${escapeHtml(me.name)}'s</b> turn${me.isBot ? ' 🤖' : !s.players.filter((p) => !p.isBot && p !== me).length ? ' (you)' : ''} · Round ${s.round}</span></div>
      <div class="modechip" title="AI difficulty and game mode">${hudMode()}</div>
      <div class="energy" title="Energy pays for cards. It refills each turn (+1 per turn, max ${RULES.energyMax}); unspent energy is lost.">⚡ ${me.energy} ${energyPips}</div>
      <div class="spacer"></div>
      <button class="btn ghost icon" id="motion" title="${fx.reducedMotion() ? 'Animations are OFF (reduced motion). Click to turn them on.' : 'Animations are ON. Click for reduced motion.'}">${fx.reducedMotion() ? '🐢' : '✨'}</button>
      <button class="btn ghost icon" id="help" title="How to play (?)">?</button>
      <a class="btn ghost" href="${RULES_URL}" target="_blank" rel="noopener">Rules</a>
      <button class="btn ghost" id="newgame">New game</button>
      ${!me.isBot && s.winner === null && ui.revealed && canBeUnit(s, { kind: 'base' }) && s.active?.kind !== 'base' ? `<button class="btn ghost" id="hudbase" title="Use your base this turn (play summon cards). Key: B">🏰 Base</button>` : ''}
      <button class="btn primary" id="endturn" ${canEnd ? '' : 'disabled'} title="Always ends your turn. Key: E or Enter">End turn${over.length ? ` (discard ${over.length})` : ''} ⏎</button>
    </header>
    <main class="main">
      ${renderActions()}
      <div class="center-col">
        <div class="statusbar ${st.tone}" role="status" aria-live="polite"><div class="st-main">${st.text}</div>${st.detail ? `<div class="st-detail">${st.detail}</div>` : ''}</div>
        <div class="board-wrap">${boardHtml}</div>
      </div>
      ${renderSidebar()}
    </main>
    ${ui.notice ? `<div class="toast" role="status">${escapeHtml(ui.notice)}</div>` : ''}
    <footer class="hand">${hand}</footer>
    <div class="dice-overlay" id="dice"></div>
    <div class="tip" id="tip"></div>
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

function cancelTargeting(): boolean {
  if (ui.pendingCard === null && ui.cardIntent === null) return false;
  ui.cardIntent = null;
  ui.pendingCard = null;
  ui.arrows = [];
  renderGame();
  return true;
}

function endTurnNow() {
  if (ui.busy || !humanTurn()) return;
  cancelTargeting();
  void doAction({ type: 'endTurn' });
}

function selectUnit(unit: Unit) {
  const s = ui.state!;
  if (s.active && unit.kind === s.active.kind && (unit.kind === 'base' || (s.active.kind === 'piece' && s.active.id === unit.id))) return;
  if (!canBeUnit(s, unit)) {
    const p = unit.kind === 'piece' ? pieceById(s, unit.id) : undefined;
    flash(p ? pieceLockReason(s, p) ?? 'Not available.' : s.turnActed ? 'Your base is locked: this turn you\'re using a piece. It can summon next turn.' : 'Your base cannot summon right now.');
    return;
  }
  void doAction({ type: 'selectUnit', unit });
}

/** Run an Actions-list item. */
function runAct(act: string) {
  const s = ui.state!;
  if (act === 'again') return startGame();
  if (ui.busy || !humanTurn()) return;
  if (act === 'end') return endTurnNow();
  if (act === 'cancel') return void cancelTargeting();
  if (act === 'undo') return doUndo();
  if (act === 'rebuild') { const p = activePiece(s); if (p) void doAction({ type: 'rebuild', pieceId: p.id }); return; }
  if (act === 'sel:base') return selectUnit({ kind: 'base' });
  if (act.startsWith('sel:')) return selectUnit({ kind: 'piece', id: Number(act.slice(4)) });
  if (act.startsWith('card:')) return onCardClick(Number(act.slice(5)));
  const hl = highlights();
  const ap = activePiece(s);
  if (act === 'attack' && ap) {
    if (hl.attacks.length === 1) { void doAction({ type: 'attack', pieceId: ap.id, target: hl.attacks[0] }); return; }
    pulseBoard('attack');
    flash('Click one of the red hexes to attack it.');
  }
  if (act === 'move' && ap) {
    pulseBoard('move');
    flash('Click one of the outlined hexes to move there.');
  }
}

function pulseBoard(kind: string) {
  const b = document.querySelector('svg.board');
  b?.classList.add(`emph-${kind}`);
  setTimeout(() => document.querySelector('svg.board')?.classList.remove(`emph-${kind}`), 1400);
}

function doUndo() {
  if (!ui.undo || ui.busy) return;
  ui.state = ui.undo.snap;
  ui.undo = null;
  ui.pendingCard = null;
  ui.arrows = [];
  flash('↶ Move undone.');
}

function bindGame() {
  const s = ui.state!;
  app.querySelector('#newgame')?.addEventListener('click', () => {
    if (s.winner !== null || confirm('Abandon this game and return to setup?')) {
      ui.state = null;
      renderSetup();
    }
  });
  app.querySelector('#endturn')?.addEventListener('click', endTurnNow);
  app.querySelector('#help')?.addEventListener('click', () => { ui.helpOpen = !ui.helpOpen; renderGame(); });
  app.querySelector('#helpok')?.addEventListener('click', () => { ui.helpOpen = false; localStorage.setItem(HELP_KEY, '1'); renderGame(); });
  app.querySelector('#motion')?.addEventListener('click', () => {
    fx.setReducedMotion(!fx.reducedMotion());
    localStorage.setItem(MOTION_KEY, fx.reducedMotion() ? '1' : '0');
    renderGame();
  });
  app.querySelector('#reveal')?.addEventListener('click', () => {
    ui.revealed = true;
    renderGame();
  });
  app.querySelector('#again')?.addEventListener('click', startGame);
  app.querySelector('#setup')?.addEventListener('click', () => {
    ui.state = null;
    renderSetup();
  });
  app.querySelector('#cancel')?.addEventListener('click', () => void cancelTargeting());
  app.querySelector('#rebuild')?.addEventListener('click', () => runAct('rebuild'));
  app.querySelector('#hudbase')?.addEventListener('click', () => selectUnit({ kind: 'base' }));
  app.querySelector('#resetarrows')?.addEventListener('click', () => {
    ui.arrows = [];
    renderGame();
  });
  app.querySelector('#fire')?.addEventListener('click', () => {
    if (ui.pendingCard === null) return;
    void doAction({ type: 'playCard', cardUid: ui.pendingCard, arrows: [...ui.arrows] });
  });
  app.querySelectorAll<HTMLElement>('.hand [data-card]').forEach((el) => {
    el.addEventListener('click', () => onCardClick(Number(el.dataset.card)));
    el.addEventListener('mouseenter', () => { const c = currentPlayer(ui.state!).hand.find((x) => x.uid === Number(el.dataset.card)); if (c) hoverHexes(cardHoverHexes(ui.state!, c), 'card'); });
    el.addEventListener('mouseleave', () => hoverHexes([], ''));
  });
  // Actions list: click runs it, hover shows it on the board
  const { items } = actionItems();
  app.querySelectorAll<HTMLElement>('.act-list [data-ai]').forEach((el) => {
    const it = items[Number(el.dataset.ai)];
    if (!it) return;
    if (it.act) el.addEventListener('click', () => {
      if (it.state === 'locked') { flash(`✖ ${it.label.replace(/<[^>]+>/g, '')}: ${it.sub ?? 'not available'}`); return; }
      if (it.state === 'open') runAct(it.act!);
    });
    el.addEventListener('mouseenter', () => hoverHexes(it.hover ?? [], it.hoverKind ?? ''));
    el.addEventListener('mouseleave', () => hoverHexes([], ''));
  });
  const board = app.querySelector('svg.board');
  board?.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelTargeting(); });
  board?.addEventListener('mouseleave', hideTip);
  app.querySelectorAll<SVGElement>('.hit').forEach((el) => {
    const h = { q: Number(el.dataset.q), r: Number(el.dataset.r) };
    el.addEventListener('click', (e) => onHexClick(h, (e as MouseEvent).shiftKey));
    el.addEventListener('mouseenter', (e) => { previewArea(h); showTip(h, e as MouseEvent); });
    el.addEventListener('mousemove', (e) => moveTip(e as MouseEvent));
  });
  app.querySelectorAll<HTMLElement>('[data-discard]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const s2 = ui.state!;
      if (ui.busy || !humanTurn()) return;
      const uid = Number(el.dataset.discard);
      const card = currentPlayer(s2).hand.find((c) => c.uid === uid);
      if (card) { void doAction({ type: 'discard', cardUid: uid }).then(() => flash(`Discarded ${CARDS[card.id].name}.`)); }
    }),
  );
}

// ------------------------------------------------------------------ hover tooltip (pieces, bases, attack preview)

function hideTip() {
  const t = document.getElementById('tip');
  if (t) t.classList.remove('show');
}
function moveTip(e: MouseEvent) {
  const t = document.getElementById('tip');
  if (!t) return;
  t.style.left = `${Math.min(e.clientX + 16, innerWidth - 260)}px`;
  t.style.top = `${Math.min(e.clientY + 14, innerHeight - 120)}px`;
}

/** Damage range and kill chance of `attacker` hitting `p` (shield, then armor). */
function attackPreview(attacker: Piece, p: Piece): string {
  const die = PIECES[attacker.kind].die;
  const after = (roll: number) => {
    let d = roll + attacker.bonusDamage;
    d -= Math.min(p.shield, d);
    if (p.armor && d > 0) { const a = ARMORS[p.armor]; d -= Math.min(a.pool ? (p.armorPool ?? 0) : (a.reduce ?? 0), d); }
    return d;
  };
  const lo = after(1);
  const hi = after(die);
  let kills = 0;
  for (let r = 1; r <= die; r++) if (after(r) >= p.hp) kills++;
  return `⚔ Attack: d${die}${attacker.bonusDamage ? `+${attacker.bonusDamage}` : ''} → <b>${lo}–${hi}</b> damage${p.shield || p.armor ? ' (after shield/armor)' : ''} · kill chance <b>${Math.round((kills / die) * 100)}%</b>`;
}

function showTip(h: Hex, e: MouseEvent) {
  const t = document.getElementById('tip');
  const s = ui.state;
  if (!t || !s) return;
  const p = pieceAt(s, h);
  const base = baseAt(s, h);
  const ap = activePiece(s);
  const lines: string[] = [];
  if (p) {
    const o = s.players[p.owner];
    const st = PIECES[p.kind];
    lines.push(`<b style="color:${o.color}">${escapeHtml(o.name)}</b> ${st.glyph} <b>${st.name}</b>${s.flag.carrier === p.id ? ' 🚩' : ''}`);
    lines.push(`❤ ${p.hp}/${p.maxHp}${p.shield ? ` · 🔵 ${p.shield}` : ''} · 🎲 d${st.die}${p.bonusDamage ? `+${p.bonusDamage}` : ''}${p.armor ? ` · ${ARMORS[p.armor].icon} ${ARMORS[p.armor].name}` : ''}${p.shackles ? ' · ⛓' : ''}`);
    if (p.owner === s.current && !currentPlayer(s).isBot) {
      const why = pieceLockReason(s, p);
      lines.push(why ? `<span class="tw">${why}</span>` : `Moves left ${p.movesLeft} · attacks left ${p.attacksLeft}${s.active?.kind === 'piece' && s.active.id === p.id ? '' : ' · click to select'}`);
    }
    if (ap && p.owner !== s.current && legalAttacks(s, ap).some((a) => a.kind === 'piece' && a.id === p.id)) lines.push(attackPreview(ap, p));
  } else if (base) {
    lines.push(`<b style="color:${base.color}">${escapeHtml(base.name)}</b>'s 🏰 base · ❤ ${base.baseHp}/${RULES.baseHp}${base.ruined ? ' (ruined)' : ''}`);
    if (ap && legalAttacks(s, ap).some((a) => a.kind === 'base' && a.owner === base.index)) lines.push(`⚔ Attack: d${PIECES[ap.kind].die}${ap.bonusDamage ? `+${ap.bonusDamage}` : ''} → ${1 + ap.bonusDamage}–${PIECES[ap.kind].die + ap.bonusDamage} damage`);
    if (base.index === s.current && !currentPlayer(s).isBot) lines.push(canBeUnit(s, { kind: 'base' }) ? 'Click to use your base (summon)' : '<span class="tw">Locked this turn: you are using a piece</span>');
  } else if (ap && legalMoves(s, ap).some((m) => hexEq(m, h))) {
    lines.push(`➜ Move your ${PIECES[ap.kind].name} here${flagHex(s) && hexEq(flagHex(s)!, h) ? ' and grab the 🚩 flag' : ''}`);
  } else if (flagHex(s) && hexEq(flagHex(s)!, h)) lines.push('🚩 The flag. Land a piece here to pick it up.');
  if (!lines.length) return hideTip();
  t.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  t.classList.add('show');
  moveTip(e);
}

function onCardClick(uid: number) {
  const s = ui.state!;
  if (ui.busy || !humanTurn()) return;
  const card = currentPlayer(s).hand.find((c) => c.uid === uid);
  if (!card) return;
  if (!directlyPlayable(s, card)) {
    // Not playable by the current pick: switch to a unit that can play it (allowed until your unit acts).
    const units = unitsThatCanPlay(s, card);
    if (units.length === 1) {
      ui.pendingCard = null;
      void doAction({ type: 'selectUnit', unit: units[0] }).then(() => onCardClick(uid));
    } else if (units.length > 1) {
      ui.pendingCard = null;
      ui.cardIntent = ui.cardIntent === uid ? null : uid;
      if (ui.cardIntent !== null) flash(`Click the highlighted piece that should play ${CARDS[card.id].name}.`);
      else renderGame();
    } else {
      flash(`✖ Can't play ${CARDS[card.id].name}: ${cardWhy(s, card)}.`);
    }
    return;
  }
  ui.cardIntent = null;
  ui.notice = null;
  if (ui.pendingCard === uid) {
    cancelTargeting();
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
  if (ui.busy || !humanTurn()) return;
  let hl = highlights();
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
    if (def?.targeting === 'arrows' && t && t.kind === 'piece') {
      if (ui.arrows.length < (def.amount ?? 4)) ui.arrows.push(t.id);
      renderGame();
      return;
    }
    if (t) {
      void doAction({ type: 'playCard', cardUid: ui.pendingCard, target: t });
      return;
    }
    // Not a target: drop the card and treat this as a normal click (never swallow it).
    ui.pendingCard = null;
    ui.arrows = [];
    hl = highlights();
  }
  if (ui.cardIntent !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.cardIntent);
    const uid = ui.cardIntent;
    ui.cardIntent = null;
    if (card && piece && piece.owner === s.current && unitsThatCanPlay(s, card).some((u) => u.kind === 'piece' && u.id === piece.id)) {
      void doAction({ type: 'selectUnit', unit: { kind: 'piece', id: piece.id } }).then(() => onCardClick(uid));
      return;
    }
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
      void doAction({ type: 'move', pieceId: ap.id, to: h }, `${PIECES[ap.kind].name} move`);
      return;
    }
  }
  // Your own piece: always try to select it (and say why not if it's locked).
  if (piece && piece.owner === s.current) {
    if (!(s.active?.kind === 'piece' && s.active.id === piece.id)) selectUnit({ kind: 'piece', id: piece.id });
    else renderGame();
    return;
  }
  if (!piece && base && base.index === s.current) {
    if (s.active?.kind !== 'base') selectUnit({ kind: 'base' });
    return;
  }
  if (piece || base) {
    // Enemy piece/base that isn't a target right now: explain.
    const who = piece ? `${s.players[piece.owner].name}'s ${PIECES[piece.kind].name}` : `${base!.name}'s base`;
    flash(ap ? (ap.attacksLeft > 0 ? `${who} is out of reach: your ${PIECES[ap.kind].name} attacks adjacent hexes only.` : `Your ${PIECES[ap.kind].name} has already attacked this turn.`) : `Select one of your pieces first, then click ${who} to attack it.`);
    return;
  }
  renderGame();
}

document.addEventListener('keydown', (e) => {
  if (!ui.state || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  const s = ui.state;
  if (e.key === 'Escape') {
    if (!cancelTargeting() && ui.helpOpen) { ui.helpOpen = false; renderGame(); }
    return;
  }
  if (e.key === '?') { ui.helpOpen = !ui.helpOpen; renderGame(); return; }
  if (!humanTurn() || ui.busy) return;
  const k = e.key.toLowerCase();
  if (k === 'e' || e.key === 'Enter') endTurnNow();
  else if (k === 'b') selectUnit({ kind: 'base' });
  else if (k === 'u') doUndo();
  else if (/^[1-9]$/.test(e.key)) {
    const c = currentPlayer(s).hand[Number(e.key) - 1];
    if (c) onCardClick(c.uid);
  }
});

// ------------------------------------------------------------------ action loop + effects

interface Snap {
  pieces: Map<number, { pos: Hex; hp: number; shield: number; armor: string | null | undefined; bonus: number; kind: Piece['kind']; owner: number }>;
  baseHp: number[];
  carrier: number | null;
  flagPos: Hex | null;
  corpseIds: Set<number>;
  current: number;
  hand: number;
}
function snap(s: GameState): Snap {
  return {
    pieces: new Map(s.pieces.map((p) => [p.id, { pos: { ...p.pos }, hp: p.hp, shield: p.shield, armor: p.armor, bonus: p.bonusDamage, kind: p.kind, owner: p.owner }])),
    baseHp: s.players.map((p) => p.baseHp),
    carrier: s.flag.carrier,
    flagPos: s.flag.pos ? { ...s.flag.pos } : null,
    corpseIds: new Set(s.corpses.map((c) => c.id)),
    current: s.current,
    hand: s.players[s.current].hand.length,
  };
}

/** Before rendering: mark new pieces/skulls so they animate in. */
function markFresh(before: Snap, s: GameState) {
  for (const p of s.pieces) if (!before.pieces.has(p.id)) ui.freshPieces.add(p.id);
  for (const c of s.corpses) if (!before.corpseIds.has(c.id)) ui.freshCorpses.add(c.id);
}

/** After rendering: slide moved pieces from where they were. */
function slideMoved(before: Snap, s: GameState) {
  if (fx.reducedMotion()) return;
  for (const p of s.pieces) {
    const b = before.pieces.get(p.id);
    if (!b || hexEq(b.pos, p.pos)) continue;
    const el = document.querySelector<SVGGElement>(`.piece[data-piece="${p.id}"]`);
    if (!el) continue;
    const a = px(b.pos);
    const z = px(p.pos);
    el.style.transition = 'none';
    el.style.transform = `translate(${a.x - z.x}px, ${a.y - z.y}px)`;
    void el.getBoundingClientRect();
    el.style.transition = 'transform 380ms cubic-bezier(.2,.8,.2,1)';
    el.style.transform = 'translate(0px, 0px)';
  }
}

/** After the dice: floating numbers, rings, banners for what changed. */
function effects(before: Snap, s: GameState, action: Action, events: GameEvent[]) {
  const color = s.players[before.current].color;
  const who = s.players[before.current];
  // Card banners + special visuals
  if (action.type === 'playCard') {
    const line = s.log.slice().reverse().find((l) => / plays /.test(l));
    const def = (() => { const m = line?.match(/ plays (.+)\.$/); return m ? Object.values(CARDS).find((d) => d.name === m[1]) : undefined; })();
    if (def) {
      fx.banner(`<span class="bi">${def.summons ? PIECES[def.summons].glyph : CATEGORY_ICON[def.id] ?? '✦'}</span> ${escapeHtml(line!.replace(/\.$/, ''))}`, color, 'card');
      const actor = def.cls !== 'conjuration' ? activePiece(s) : undefined;
      const from = actor ? before.pieces.get(actor.id)?.pos ?? actor.pos : who.base;
      if (def.id === 'fireball' && action.target?.kind === 'hex') fx.ring(action.target.hex, S, 'blast', def.radius ?? 2);
      if (def.id === 'cordon' && action.arrows) fx.bolts(from, action.arrows.map((id) => before.pieces.get(id)?.pos).filter((x): x is Hex => !!x), S, 'arrow');
      if (def.id === 'firebolt' && action.target) { const th = action.target.kind === 'piece' ? before.pieces.get(action.target.id)?.pos : action.target.kind === 'base' ? s.players[action.target.owner].base : null; if (th) fx.bolts(from, [th], S, 'fire'); }
    }
  }
  if (action.type === 'attack') {
    const ap = before.pieces.get(action.pieceId);
    const th = action.target.kind === 'piece' ? before.pieces.get(action.target.id)?.pos : action.target.kind === 'base' ? s.players[action.target.owner].base : null;
    if (ap && th) fx.bolts(ap.pos, [th], S, 'arrow');
  }
  // Pieces: damage, heals, shields, armor, deaths, summons
  let i = 0;
  for (const [id, b] of before.pieces) {
    const p = pieceById(s, id);
    const delay = 120 + (i++ % 6) * 70;
    if (!p) {
      const captured = events.some((e) => e.type === 'captured' && e.pieceId === id);
      fx.deathGhost(b.pos, S, PIECES[b.kind].glyph, s.players[b.owner].color);
      fx.floatText(b.pos, S, captured ? '⛓ captured' : '☠', captured ? 'info' : 'crit', delay);
      continue;
    }
    if (p.hp < b.hp) { fx.ring(p.pos, S, 'hit'); fx.floatText(p.pos, S, `−${b.hp - p.hp}`, 'dmg', delay); }
    if (p.hp > b.hp && p.kind === b.kind) { fx.ring(p.pos, S, 'heal'); fx.floatText(p.pos, S, `+${p.hp - b.hp} ❤`, 'heal', delay); }
    if (p.kind !== b.kind) { fx.ring(p.pos, S, 'summon'); fx.floatText(p.pos, S, `⬆ ${PIECES[p.kind].name}`, 'info', delay); }
    if (p.shield > b.shield) { fx.ring(p.pos, S, 'shield'); fx.floatText(p.pos, S, `🔵 +${p.shield - b.shield}`, 'shield', delay); }
    if (p.shield < b.shield && p.hp === b.hp) fx.floatText(p.pos, S, `🔵 −${b.shield - p.shield}`, 'shield', delay);
    if (p.armor !== b.armor) fx.floatText(p.pos, S, p.armor ? `${ARMORS[p.armor].icon} ${ARMORS[p.armor].name}` : 'armor gone', 'shield', delay);
    if (p.bonusDamage > b.bonus) fx.floatText(p.pos, S, `🗡 +${p.bonusDamage - b.bonus}`, 'info', delay);
  }
  for (const p of s.pieces) if (!before.pieces.has(p.id)) { fx.ring(p.pos, S, 'summon'); fx.floatText(p.pos, S, `✨ ${PIECES[p.kind].name}`, 'info', 150); }
  s.players.forEach((pl, k) => {
    const d = pl.baseHp - before.baseHp[k];
    if (d < 0) { fx.ring(pl.base, S, 'hit'); fx.floatText(pl.base, S, `🏰 −${-d}`, 'dmg', 150); }
    if (d > 0) { fx.ring(pl.base, S, 'heal'); fx.floatText(pl.base, S, `🏰 +${d}`, 'heal', 150); }
  });
  // Flag news
  if (s.flag.carrier !== before.carrier) {
    const c = s.flag.carrier !== null ? pieceById(s, s.flag.carrier) : undefined;
    if (c) {
      fx.ring(c.pos, S, 'flag');
      fx.banner(`🚩 ${escapeHtml(s.players[c.owner].name)}'s ${PIECES[c.kind].name} grabs the flag!`, s.players[c.owner].color, 'flag');
    } else if (s.flag.pos) {
      fx.ring(s.flag.pos, S, 'flag');
      fx.banner(`🚩 The flag drops at (${s.flag.pos.q},${s.flag.pos.r})!`, '#ff5a5a', 'flag');
    }
  }
  // End-of-turn discards are announced (they are also in the log)
  if (action.type === 'endTurn') {
    const line = s.log.slice().reverse().find((l) => l.startsWith(`${who.name} is over the`));
    if (line && !who.isBot && s.log.indexOf(line) >= s.log.length - 6) flash(`🗑 ${line}`);
  }
}

/** Big 'Your turn' / 'Gold's turn' banner when the turn passes. */
function announceTurn() {
  const s = ui.state!;
  if (s.winner !== null) return;
  const me = currentPlayer(s);
  const solo = s.players.filter((p) => !p.isBot).length === 1;
  fx.turnBanner(!me.isBot && solo ? 'Your turn' : `${escapeHtml(me.name)}'s turn`, `Round ${s.round}${!me.isBot ? ' · pick one unit' : ''}`, me.color);
}

async function playEvents(events: GameEvent[], fast: boolean) {
  const host = document.getElementById('dice');
  if (!host || fx.reducedMotion()) return;
  for (const e of events) {
    if (e.type === 'roll') {
      await animateRoll(host, { ...e, color: ui.state!.players[e.player].color, fast: fast || ui.fastDice });
    }
  }
}

/** Apply an action with effects. `undoLabel` makes it undoable (plain moves only). */
async function doAction(action: Action, undoLabel?: string) {
  const s = ui.state!;
  const actorWasBot = currentPlayer(s).isBot;
  const who = s.current;
  const before = snap(s);
  const backup = undoLabel ? structuredClone(s) : null;
  let events: GameEvent[];
  try {
    events = applyAction(s, action);
  } catch (err) {
    console.warn(err);
    flash(`✖ ${(err as Error).message}`);
    return;
  }
  // Undo is offered only for a plain move: no dice, no capture, no win, flag unchanged.
  const plain = backup && !events.some((e) => e.type === 'roll' || e.type === 'captured' || e.type === 'win') && s.flag.carrier === before.carrier;
  ui.undo = plain ? { snap: backup!, label: undoLabel! } : null;
  ui.pendingCard = null;
  ui.arrows = [];
  const turnPassed = s.current !== who;
  if (turnPassed) ui.notice = null;
  markFresh(before, s);
  ui.busy = events.some((e) => e.type === 'roll');
  renderGame();
  slideMoved(before, s);
  await playEvents(events, actorWasBot);
  effects(before, s, action, events);
  ui.busy = false;
  if (turnPassed) {
    ui.selectedPiece = null;
    ui.undo = null;
    ui.revealed = !needsHandoff();
  }
  renderGame();
  if (turnPassed) announceTurn();
  if (turnPassed) void maybeRunBot();
}

let botRunning = false;
async function maybeRunBot() {
  if (botRunning) return;
  botRunning = true;
  try {
    const s = ui.state!;
    while (ui.state === s && s.winner === null && currentPlayer(s).isBot) {
      await new Promise((r) => setTimeout(r, ui.fastDice || fx.reducedMotion() ? 140 : 420));
      if (ui.state !== s) break;
      const action = chooseBotAction(s);
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
  const before = snap(s);
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
  markFresh(before, s);
  ui.busy = true;
  renderGame();
  slideMoved(before, s);
  await playEvents(events, true);
  effects(before, s, action, events);
  ui.busy = false;
  const passed = s.current !== whoBot;
  if (passed) {
    ui.revealed = !needsHandoff();
    if (!currentPlayer(s).isBot) ui.notice = null; // no stale messages at the start of your turn
  }
  renderGame();
  if (passed) announceTurn();
}

// Expose for debugging / screenshots / UI tests.
(window as unknown as { dbd: unknown }).dbd = { ui, startGame, renderGame };

renderSetup();
