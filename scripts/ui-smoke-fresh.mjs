// UI smoke test for a FRESH game as the human seat (Playwright + system Chrome).
// Usage: node scripts/ui-smoke-fresh.mjs <url> [screenshot.png]
// Needs `playwright` resolvable (e.g. run from a folder with it installed) — not a project dependency.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4175/Die-Build-Die/';
const shot = process.argv[3];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`); if (!ok) fails++; };
const idle = () => page.waitForFunction(() => { const s = window.dbd?.ui.state; return s && (s.winner !== null || (!s.players[s.current].isBot && !window.dbd.ui.busy)); }, null, { timeout: 60000 });
const settle = async () => { await page.waitForTimeout(80); await page.waitForFunction(() => !window.dbd.ui.busy); };
const info = () => page.evaluate(() => { const s = window.dbd.ui.state; return { round: s.round, cur: s.current, active: s.active, energy: s.players[0].energy, moves: document.querySelectorAll('.hl-move').length, cardHl: document.querySelectorAll('.hl-card').length, pending: window.dbd.ui.pendingCard, toast: document.querySelector('.toast')?.textContent ?? null }; });
const clickHex = async (h) => { const el = await page.$(`polygon.hit[data-q="${h.q}"][data-r="${h.r}"]`); const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await settle(); };
const myPawn = () => page.evaluate(() => window.dbd.ui.state.pieces.find((p) => p.owner === 0));
async function freshGame() {
  if (await page.$('#newgame')) { await page.click('#newgame'); await page.waitForTimeout(200); }
  else { await page.goto(url); await page.evaluate(() => localStorage.removeItem('dbd-setup')); await page.reload(); }
  await page.click('[data-diff="easy"]');
  await page.click('#fast');
  await page.click('#start');
  await idle();
}
const clickPieceGraphic = async (id) => { const g = await page.$(`.piece[data-piece="${id}"]`); const b = await g.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await settle(); };

// A. The exact user flow: fresh Easy FFA, click the pawn sitting on the base, then move it.
await freshGame();
let pawn = await myPawn();
const baseHex = await page.evaluate(() => window.dbd.ui.state.players[0].base);
check('A0 fresh game: pawn starts on the base hex', pawn.pos.q === baseHex.q && pawn.pos.r === baseHex.r);
await clickPieceGraphic(pawn.id);
let i = await info();
check('A1 click pawn on base -> pawn picked, move hexes lit', i.active?.kind === 'piece' && i.active.id === pawn.id && i.moves > 0, JSON.stringify(i));
if (shot) { await page.mouse.move(5, 5); await page.waitForTimeout(150); await page.screenshot({ path: shot }); }
await clickPieceGraphic(pawn.id); // a second click must not switch to the base
i = await info();
check('A2 clicking the picked pawn again keeps it picked', i.active?.kind === 'piece' && i.moves > 0, JSON.stringify(i));
const dot = await page.$('.hl-move'); const db = await dot.boundingBox();
await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2); await settle();
pawn = await myPawn();
check('A3 click a lit hex -> pawn moved off the base, no card needed', !(pawn.pos.q === baseHex.q && pawn.pos.r === baseHex.r) && pawn.movesLeft === 0);

// B. Clicking a summon card first, then the pawn, must pick the pawn (used to just cancel the card).
await freshGame();
pawn = await myPawn();
const conj = await page.$('.card.cls-conjuration.playable');
if (conj) {
  await conj.click(); await settle();
  i = await info();
  check('B1 summon card click -> targets lit', i.pending !== null && i.cardHl > 0, JSON.stringify(i));
  await clickPieceGraphic(pawn.id);
  i = await info();
  check('B2 then clicking the pawn picks the pawn with moves lit', i.pending === null && i.active?.id === pawn.id && i.moves > 0, JSON.stringify(i));
  // C. With the pawn picked, a summon card click, then the pawn again -> pawn still usable
  await (await page.$('.card.cls-conjuration.playable')).click(); await settle();
  await clickPieceGraphic(pawn.id);
  i = await info();
  check('C1 pawn -> summon card -> pawn: pawn picked with moves lit', i.active?.id === pawn.id && i.moves > 0, JSON.stringify(i));
} else console.log('skip B/C: no affordable conjuration in this hand');

// D. Unplayable cards explain themselves: Promote Pawn -> Bishop on turn 1 (no Queen/King, 2 energy).
await page.evaluate(() => { const s = window.dbd.ui.state; s.players[0].hand[0] = { uid: 990001, id: 'promote_pawn_bishop' }; window.dbd.renderGame(); });
await page.click('[data-card="990001"]'); await page.waitForTimeout(150);
i = await info();
check('D1 Promote Pawn->Bishop on turn 1 shows a reason', !!i.toast && /Queen or King/.test(i.toast) && /3 energy, you have 2/.test(i.toast), JSON.stringify(i.toast));

// E. Base button picks the base explicitly.
await page.click('#hudbase'); await settle();
i = await info();
check('E1 HUD "Base" button picks the base', i.active?.kind === 'base', JSON.stringify(i));
await clickPieceGraphic(pawn.id);
i = await info();
check('E2 clicking the pawn switches back to it (nothing done yet)', i.active?.id === pawn.id && i.moves > 0);

// F. A different piece sitting on the base hex (e.g. summoned last turn) is picked and can move.
await page.evaluate(() => {
  const s = window.dbd.ui.state; const b = s.players[0].base;
  s.active = null; s.turnActed = false; s.cardsUsed = 0;
  s.pieces = s.pieces.filter((p) => p.owner !== 0);
  s.pieces.push({ id: 991001, owner: 0, kind: 'knight', pos: { ...b }, hp: 6, maxHp: 6, movesLeft: 1, attacksLeft: 1, shield: 0, bonusDamage: 0, armor: null });
  s.pieces.push({ id: 991002, owner: 0, kind: 'rook', pos: { q: b.q + (b.q > 0 ? -1 : 1), r: b.r }, hp: 10, maxHp: 10, movesLeft: 0, attacksLeft: 0, shield: 0, bonusDamage: 0, armor: null });
  window.dbd.renderGame();
});
await clickPieceGraphic(991001);
i = await info();
check('F1 knight on the base hex -> knight picked, moves lit', i.active?.id === 991001 && i.moves > 0, JSON.stringify(i));
await page.evaluate(() => { const s = window.dbd.ui.state; s.active = null; window.dbd.renderGame(); });
await clickPieceGraphic(991002);
i = await info();
check('F2 just-summoned rook explains why it cannot act', !!i.toast && /next turn/.test(i.toast), JSON.stringify(i.toast));

// G. Every promotion card works when affordable (Queen next to the piece, 7 energy).
const promos = [['promote_pawn_knight', 'pawn', 'knight'], ['promote_pawn_bishop', 'pawn', 'bishop'], ['promote_pawn_rook', 'pawn', 'rook'], ['promote_bishop_queen', 'bishop', 'queen'], ['promote_knight_king', 'knight', 'king'], ['promote_rook_king', 'rook', 'king']];
for (const [id, from, to] of promos) {
  await page.evaluate(({ id, from }) => {
    const s = window.dbd.ui.state;
    s.current = 0; s.active = null; s.turnActed = false; s.cardsUsed = 0;
    s.flag = { pos: { q: -4, r: 4 }, carrier: null };
    const HP = { pawn: 4, knight: 6, bishop: 8, rook: 10 };
    s.pieces = s.pieces.filter((p) => p.owner !== 0);
    s.pieces.push({ id: 992001, owner: 0, kind: 'queen', pos: { q: 0, r: 0 }, hp: 12, maxHp: 12, movesLeft: 1, attacksLeft: 1, shield: 0, bonusDamage: 0, armor: null });
    s.pieces.push({ id: 992002, owner: 0, kind: from, pos: { q: 0, r: 2 }, hp: HP[from], maxHp: HP[from], movesLeft: 1, attacksLeft: 1, shield: 0, bonusDamage: 0, armor: null });
    s.players[0].energy = 7;
    s.players[0].hand = [{ uid: 993001, id }];
    window.dbd.ui.pendingCard = null; window.dbd.ui.cardIntent = null;
    window.dbd.renderGame();
  }, { id, from });
  await page.click('[data-card="993001"]'); await settle(); // auto-picks the Queen (only piece that can play it)
  i = await info();
  const lit = i.cardHl > 0 && i.pending === 993001;
  await clickHex({ q: 0, r: 2 });
  const kind = await page.evaluate(() => window.dbd.ui.state.pieces.find((p) => p.id === 992002)?.kind);
  check(`G ${id}: card click -> Queen picked, target lit -> ${from} becomes ${to}`, lit && kind === to, JSON.stringify({ lit, kind }));
}

// H. Later rounds: end the turn, let the AI play, and pick+move a piece again.
await freshGame();
for (let r = 0; r < 2; r++) {
  await page.click('#endturn'); await page.waitForTimeout(150);
  await idle();
}
pawn = await myPawn();
await clickPieceGraphic(pawn.id);
i = await info();
check(`H1 round ${i.round}: pawn picked with moves lit`, i.active?.id === pawn.id && i.moves > 0, JSON.stringify(i));

console.log('fails', fails, 'errors', errors);
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
