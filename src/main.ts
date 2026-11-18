import './ui/style.css';
import { ARMORS, CARDS, PIECES, PLAYER_COLORS, PLAYER_NAMES, RULES, type CardCategory } from './game/config';
import {
  CENTER, activePiece, applyAction, areaVictims, baseAt, canBeUnit, canPlayCard, cardBlockReason, cardTargets, cardUsersText, currentPlayer,
  flagCarrier, flagHex, legalAttacks, legalMoves, newGame, pieceAt,
  pieceById, sameTarget, targetName,
} from './game/engine';
import { chooseBotAction } from './game/bot';
import { hexDistance, hexEq, hexagonBoard, type Hex } from './game/hex';
import type { Action, Card, GameEvent, GameState, Target } from './game/types';
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
}
const ui: Ui = { state: null, selectedPiece: null, pendingCard: null, arrows: [], busy: false, hideHands: true, revealed: true, fastDice: false };

// ------------------------------------------------------------------ setup screen

interface SeatSetup { name: string; isBot: boolean }
let seatSetups: SeatSetup[] = [
  { name: '', isBot: false },
  { name: '', isBot: true },
];

function renderSetup() {
  const n = seatSetups.length;
  const seats = RULES.seatCorners[n];
  app.innerHTML = `
  <div class="setup">
    <h1 class="logo">Die <span>Build</span> Die</h1>
    <p class="tagline">Chess pieces. A deck of cards. A fistful of dice. Grab the flag from the centre and carry it home.</p>
    <div class="setup-card">
      <label class="row">Players
        <div class="count">${[2, 3, 4, 5, 6].map((k) => `<button data-count="${k}" class="${k === n ? 'on' : ''}">${k}</button>`).join('')}</div>
      </label>
      <div class="seats">
        ${seatSetups.map((s, i) => `
          <div class="seat" style="--pc:${PLAYER_COLORS[seats[i]]}">
            <span class="swatch"></span>
            <input data-name="${i}" placeholder="${PLAYER_NAMES[seats[i]]}" value="${escapeHtml(s.name)}" maxlength="14"/>
            <button data-bot="${i}" class="toggle ${s.isBot ? 'bot' : ''}">${s.isBot ? '🤖 Bot' : '🧑 Human'}</button>
          </div>`).join('')}
      </div>
      <label class="check"><input type="checkbox" id="hide" ${ui.hideHands ? 'checked' : ''}/> Hide hands between human turns (pass-and-play)</label>
      <label class="check"><input type="checkbox" id="fast" ${ui.fastDice ? 'checked' : ''}/> Fast dice</label>
      <button class="primary big" id="start">Start game</button>
      <p class="small"><a href="${RULES_URL}" target="_blank" rel="noopener">Read the rules</a></p>
    </div>
  </div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = Number(b.dataset.count);
      while (seatSetups.length < k) seatSetups.push({ name: '', isBot: true });
      seatSetups = seatSetups.slice(0, k);
      renderSetup();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-bot]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.bot);
      seatSetups[i].isBot = !seatSetups[i].isBot;
      renderSetup();
    }),
  );
  app.querySelectorAll<HTMLInputElement>('[data-name]').forEach((inp) =>
    inp.addEventListener('input', () => (seatSetups[Number(inp.dataset.name)].name = inp.value)),
  );
  (app.querySelector('#hide') as HTMLInputElement).addEventListener('change', (e) => (ui.hideHands = (e.target as HTMLInputElement).checked));
  (app.querySelector('#fast') as HTMLInputElement).addEventListener('change', (e) => (ui.fastDice = (e.target as HTMLInputElement).checked));
  app.querySelector('#start')!.addEventListener('click', startGame);
}

function startGame() {
  const { state } = newGame(seatSetups.map((s) => ({ name: s.name.trim(), isBot: s.isBot })));
  ui.state = state;
  ui.selectedPiece = null;
  ui.pendingCard = null;
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
  firebolt: '🔥', fireball: '☄️', cordon: '🏹', gambeson: '🧥', breastplate: '🦺', plate: '🛡', armor_rend: '🔨', sharpen: '🗡️', frenzy: '⚔️', shield: '🛡️', heal: '✚', fortify: '🏰', haste: '💨', promote: '⬆️', rally: '🎴', recall: '↩️',
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
    overlays += `<g class="base-g" style="--pc:${p.color}">
      ${p.index === s.current && s.active?.kind === 'base' ? `<polygon class="base-active" points="${hexPoints(p.base, S + 2)}"/>` : ''}
      <text class="base-icon" x="${x}" y="${y - 3}">🏰</text>
      <rect x="${x - 14}" y="${y + 10}" width="28" height="4" rx="2" class="hpbg"/>
      <rect x="${x - 14}" y="${y + 10}" width="${28 * frac}" height="4" rx="2" fill="${p.color}"/>
      <text class="base-hp" x="${x}" y="${y + 22}">${p.baseHp}</text>
    </g>`;
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
      ${arrowsHere ? `<circle cx="${x - 12}" cy="${y - 11}" r="7" class="arrow-badge"/><text class="arrow-count" x="${x - 12}" y="${y - 8}">${arrowsHere}</text>` : ''}
      ${s.flag.carrier === p.id ? `<circle cx="${x}" cy="${y}" r="${big ? 19 : 17.5}" class="carrier-ring"/><text class="carrier-flag" x="${x + 13}" y="${y - 7}">🚩</text>` : ''}
    </g>`;
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
  const reason = playable ? null : cardBlockReason(s, s.current, card);
  const tip = `${d.name} — ${cardUsersText(d)}.\n${d.text}${reason && !forcedDiscard ? `\n\n✖ ${reason}` : ''}${forcedDiscard ? '\n\nClick to discard this card.' : ''}`;
  return `<button class="card cat-${d.category} cls-${d.cls} ${playable || forcedDiscard ? 'playable' : 'dim'} ${pending ? 'pending' : ''} ${forcedDiscard ? 'to-discard' : ''}" data-card="${card.uid}" title="${escapeHtml(tip)}">
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

/** The "this turn's unit" panel. */
function unitPanel(): string {
  const s = ui.state!;
  const me = currentPlayer(s);
  if (me.isBot) return '<div class="hint">Bot is playing…</div>';
  if (s.mustDiscard > 0) return `<div class="hint strong warn">✋ You have ${me.hand.length} cards — click ${s.mustDiscard === 1 ? 'a card' : `${s.mustDiscard} cards`} in your hand to discard (limit ${RULES.handLimit}).</div>`;
  const baseBtn = canBeUnit(s, { kind: 'base' }) && s.active?.kind !== 'base'
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
      <div>Moves ${sel.movesLeft} · Attacks ${sel.attacksLeft} · Cards ${Math.max(0, RULES.cardsPerPieceTurn - s.cardsUsed)}</div>
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
      <span class="pmeta">🏰 ${Math.max(0, p.baseHp)} · ♟ ${pieces} · 🂠 ${p.hand.length} · deck ${p.deck.length}</span>
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
    <footer class="hand ${s.mustDiscard > 0 && showHand ? 'discarding' : ''}">${s.mustDiscard > 0 && showHand ? `<div class="discard-banner">Hand limit ${RULES.handLimit}: choose ${s.mustDiscard} to discard</div>` : ''}${hand}</footer>
    <div class="dice-overlay" id="dice"></div>
    ${!ui.revealed && s.winner === null ? `<div class="modal"><div class="modal-card" style="--pc:${me.color}">
      <div class="swatch big"></div><h2>${escapeHtml(me.name)}'s turn</h2><p>Pass the device to ${escapeHtml(me.name)}.</p>
      <button class="btn primary" id="reveal">Show my hand</button></div></div>` : ''}
    ${s.winner !== null ? `<div class="modal"><div class="modal-card" style="--pc:${s.players[s.winner].color}">
      <div class="trophy">🏆</div><h2>${escapeHtml(s.players[s.winner].name)} wins!</h2><p>${escapeHtml(s.winReason ?? '')} · Round ${s.round}</p>
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
    el.addEventListener('click', () => onHexClick(h));
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
  if (!canPlayCard(s, s.current, card)) return;
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

function onHexClick(h: Hex) {
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
  const ap = activePiece(s);
  if (ap) {
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
  if (action.type === 'endTurn') {
    ui.selectedPiece = null;
    ui.revealed = !needsHandoff();
  }
  renderGame();
  if (action.type === 'endTurn') void maybeRunBot();
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
  if (action.type === 'endTurn') ui.revealed = !needsHandoff();
  renderGame();
}

// Expose for debugging / screenshots.
(window as unknown as { dbd: unknown }).dbd = { ui, startGame, renderGame };

renderSetup();
