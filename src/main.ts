import './ui/style.css';
import { CARDS, PIECES, PLAYER_COLORS, PLAYER_NAMES, RULES, type CardCategory } from './game/config';
import {
  CENTER, applyAction, baseAt, canPlayCard, cardTargets, currentPlayer, legalAttacks, legalMoves, newGame, pieceAt,
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
  busy: boolean;
  hideHands: boolean;
  revealed: boolean; // current human has acknowledged the hand-off screen
  fastDice: boolean;
}
const ui: Ui = { state: null, selectedPiece: null, pendingCard: null, busy: false, hideHands: true, revealed: true, fastDice: false };

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
    <p class="tagline">Chess pieces. A deck of cards. A fistful of dice. First to hold the centre wins.</p>
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
const CATEGORY_LABEL: Record<CardCategory, string> = { piece: 'Piece', offense: 'Offense', defense: 'Defense', special: 'Special' };
const CATEGORY_ICON: Record<string, string> = {
  fireball: '🔥', sharpen: '🗡️', frenzy: '⚔️', shield: '🛡️', heal: '✚', fortify: '🏰', haste: '💨', promote: '⬆️', rally: '🎴', recall: '↩️',
};

// ------------------------------------------------------------------ highlights

type HL = { moves: Hex[]; attacks: Target[]; cardTargets: Target[] };
function highlights(): HL {
  const s = ui.state!;
  const hl: HL = { moves: [], attacks: [], cardTargets: [] };
  if (s.winner !== null || ui.busy || currentPlayer(s).isBot) return hl;
  if (ui.pendingCard !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.pendingCard);
    if (card) hl.cardTargets = cardTargets(s, s.current, CARDS[card.id]);
    return hl;
  }
  if (ui.selectedPiece !== null) {
    const p = pieceById(s, ui.selectedPiece);
    if (p) {
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
  const c = px(CENTER);
  overlays += `<text class="center-star" x="${c.x}" y="${c.y + 7}">★</text>`;
  // Bases
  for (const p of s.players) {
    const { x, y } = px(p.base);
    if (!p.alive) {
      overlays += `<text class="base-icon dead" x="${x}" y="${y + 6}">✖</text>`;
      continue;
    }
    const frac = Math.max(0, p.baseHp / RULES.baseHp);
    overlays += `<g class="base-g" style="--pc:${p.color}">
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
    const sel = p.id === ui.selectedPiece;
    const ready = p.owner === s.current && !owner.isBot && (p.movesLeft > 0 || p.attacksLeft > 0) && s.winner === null;
    const frac = Math.max(0, p.hp / p.maxHp);
    const big = p.kind === 'king' || p.kind === 'queen';
    overlays += `<g class="piece ${sel ? 'sel' : ''} ${ready ? 'ready' : ''}" data-piece="${p.id}">
      <circle cx="${x}" cy="${y}" r="${big ? 15 : 13.5}" fill="${owner.color}" class="disc"/>
      ${p.shield ? `<circle cx="${x}" cy="${y}" r="${big ? 18 : 16.5}" class="shield"/>` : ''}
      <text class="glyph" x="${x}" y="${y + 7}">${PIECES[p.kind].glyph}</text>
      <rect x="${x - 12}" y="${y + 13}" width="24" height="3.5" rx="1.7" class="hpbg"/>
      <rect x="${x - 12}" y="${y + 13}" width="${24 * frac}" height="3.5" rx="1.7" class="hp ${frac <= 0.34 ? 'low' : ''}"/>
      ${p.bonusDamage ? `<text class="badge" x="${x + 12}" y="${y - 9}">+${p.bonusDamage}</text>` : ''}
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
    ${cells}${overlays}${hits}</svg>`;
}

// ------------------------------------------------------------------ panels

function renderCard(card: Card, playable: boolean, pending: boolean) {
  const d = CARDS[card.id];
  const icon = d.summons ? PIECES[d.summons].glyph : CATEGORY_ICON[d.id] ?? '✦';
  const stats = d.summons ? `<div class="stats"><span>❤ ${PIECES[d.summons].hp}</span><span>🎲 d${PIECES[d.summons].die}</span></div>` : '';
  return `<button class="card cat-${d.category} ${playable ? 'playable' : 'dim'} ${pending ? 'pending' : ''}" data-card="${card.uid}" title="${escapeHtml(d.text)}">
    <span class="cost">${d.cost}</span>
    <span class="cat">${CATEGORY_LABEL[d.category]}</span>
    <span class="icon">${icon}</span>
    <span class="name">${d.name}</span>
    ${stats}
    <span class="text">${d.text}</span>
  </button>`;
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

  let info = '<div class="hint">Click one of your pieces to see its moves (●) and attacks (red). Click a card to play it.</div>';
  const sel = ui.selectedPiece !== null ? pieceById(s, ui.selectedPiece) : undefined;
  if (ui.pendingCard !== null) {
    const card = currentPlayer(s).hand.find((c) => c.uid === ui.pendingCard);
    if (card) info = `<div class="hint strong">Playing <b>${CARDS[card.id].name}</b>: click a highlighted target. <button id="cancel" class="link">Cancel</button></div>`;
  } else if (sel) {
    const st = PIECES[sel.kind];
    info = `<div class="selinfo" style="--pc:${s.players[sel.owner].color}">
      <div class="big">${st.glyph} ${st.name}</div>
      <div>❤ ${sel.hp}/${sel.maxHp}${sel.shield ? ` · 🛡 ${sel.shield}` : ''} · 🎲 d${st.die}${sel.bonusDamage ? ` +${sel.bonusDamage}` : ''}</div>
      <div>Moves left ${sel.movesLeft} · Attacks left ${sel.attacksLeft}</div>
    </div>`;
  }
  const logLines = s.log.slice(-80).map((l) => `<div class="${l.startsWith('—') ? 'turn' : l.startsWith('  ') ? 'sub' : ''}">${escapeHtml(l)}</div>`).join('');
  return `<aside class="side">
    <div class="panel players">${players}</div>
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
    ? me.hand.map((c) => renderCard(c, !ui.busy && canPlayCard(s, s.current, c), c.uid === ui.pendingCard)).join('') || '<div class="empty">No cards in hand</div>'
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
      <button class="btn primary" id="endturn" ${ui.busy || me.isBot || s.winner !== null ? 'disabled' : ''}>End turn ⏎</button>
    </header>
    <main class="main">
      <div class="board-wrap">${renderBoard(hl)}</div>
      ${renderSidebar()}
    </main>
    <footer class="hand">${hand}</footer>
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
    renderGame();
  });
  app.querySelectorAll<HTMLElement>('[data-card]').forEach((el) =>
    el.addEventListener('click', () => onCardClick(Number(el.dataset.card))),
  );
  app.querySelectorAll<SVGElement>('.hit').forEach((el) =>
    el.addEventListener('click', () => onHexClick({ q: Number(el.dataset.q), r: Number(el.dataset.r) })),
  );
}

function onCardClick(uid: number) {
  const s = ui.state!;
  if (ui.busy || currentPlayer(s).isBot || s.winner !== null) return;
  const card = currentPlayer(s).hand.find((c) => c.uid === uid);
  if (!card || !canPlayCard(s, s.current, card)) return;
  if (ui.pendingCard === uid) {
    ui.pendingCard = null;
    renderGame();
    return;
  }
  if (CARDS[card.id].targeting === 'none') {
    void doAction({ type: 'playCard', cardUid: uid });
    return;
  }
  ui.pendingCard = uid;
  ui.selectedPiece = null;
  renderGame();
}

function onHexClick(h: Hex) {
  const s = ui.state!;
  if (ui.busy || currentPlayer(s).isBot || s.winner !== null) return;
  const hl = highlights();
  const piece = pieceAt(s, h);
  const base = baseAt(s, h);
  const targetsHere: Target[] = [];
  if (piece) targetsHere.push({ kind: 'piece', id: piece.id });
  if (base) targetsHere.push({ kind: 'base', owner: base.index });
  targetsHere.push({ kind: 'hex', hex: h });

  if (ui.pendingCard !== null) {
    const t = targetsHere.find((t) => hl.cardTargets.some((c) => sameTarget(c, t)));
    if (t) void doAction({ type: 'playCard', cardUid: ui.pendingCard, target: t });
    else {
      ui.pendingCard = null;
      renderGame();
    }
    return;
  }
  if (ui.selectedPiece !== null) {
    const atk = targetsHere.find((t) => hl.attacks.some((a) => sameTarget(a, t)));
    if (atk) {
      void doAction({ type: 'attack', pieceId: ui.selectedPiece, target: atk });
      return;
    }
    if (hl.moves.some((m) => hexEq(m, h))) {
      void doAction({ type: 'move', pieceId: ui.selectedPiece, to: h });
      return;
    }
  }
  ui.selectedPiece = piece && piece.owner === s.current ? (ui.selectedPiece === piece.id ? null : piece.id) : null;
  renderGame();
}

document.addEventListener('keydown', (e) => {
  if (!ui.state) return;
  if (e.key === 'Escape') {
    ui.pendingCard = null;
    ui.selectedPiece = null;
    renderGame();
  } else if (e.key === 'Enter' && !ui.busy && !currentPlayer(ui.state).isBot && ui.revealed && ui.state.winner === null) {
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
  // Keep the piece selected after a move so you can attack right away.
  if (action.type !== 'move') ui.selectedPiece = null;
  if (ui.selectedPiece !== null && !pieceById(s, ui.selectedPiece)) ui.selectedPiece = null;
  ui.pendingCard = null;
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
