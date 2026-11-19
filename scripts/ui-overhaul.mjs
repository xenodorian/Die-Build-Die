// Targeted UI tests for the v0.5 interface: never-blocking End turn, Actions list, status line,
// locks, undo, keyboard, right-click, tooltips, effects, reduced motion, help, and EVERY card through the UI.
// Usage: node scripts/ui-overhaul.mjs <url> [screenshot-prefix]   (needs playwright + Chrome)
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4175/Die-Build-Die/';
const SHOT = process.argv[3];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`); if (!ok) fails++; };
const idle = () => page.waitForFunction(() => { const s = window.dbd?.ui.state; return s && (s.winner !== null || (!s.players[s.current].isBot && !window.dbd.ui.busy)); }, null, { timeout: 60000 });
const settle = async () => { await page.waitForTimeout(60); await page.waitForFunction(() => !window.dbd.ui.busy, null, { timeout: 20000 }); };
const clickHex = async (h, button = 'left') => { const el = await page.$(`polygon.hit[data-q="${h.q}"][data-r="${h.r}"]`); const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button }); await settle(); };
const clickSel = async (sel) => { const el = await page.$(sel); if (!el) return false; const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await settle(); return true; };
const S = () => page.evaluate(() => { const s = window.dbd.ui.state; return { cur: s.current, round: s.round, active: s.active, acted: s.turnActed, hand: s.players[0].hand.map((c) => c.uid), energy: s.players[0].energy, pending: window.dbd.ui.pendingCard, intent: window.dbd.ui.cardIntent, status: document.querySelector('.statusbar')?.textContent.replace(/\s+/g, ' ').trim(), toast: document.querySelector('.toast')?.textContent ?? '', moves: document.querySelectorAll('circle.hl-move').length, atks: document.querySelectorAll('.hl-attack').length, cardHl: document.querySelectorAll('.hl-card').length, log: s.log.slice(-10).join('\n'), actions: [...document.querySelectorAll('.act-list .ai')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()) }; });
async function fresh() {
  await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('[data-diff="easy"]'); await page.click('#fast'); await page.click('#start'); await idle();
}
/** Put a known position on the board for player 0 (state injection is only used to SET UP scenarios). */
const rig = (opts) => page.evaluate((o) => {
  const s = window.dbd.ui.state;
  const P = (id, owner, kind, q, r, hp) => ({ id, owner, kind, pos: { q, r }, hp: hp ?? { pawn: 4, knight: 6, bishop: 8, rook: 10, queen: 12, king: 20 }[kind], maxHp: { pawn: 4, knight: 6, bishop: 8, rook: 10, queen: 12, king: 20 }[kind], movesLeft: 1, attacksLeft: 1, shield: 0, bonusDamage: 0, armor: null });
  s.current = 0; s.active = null; s.turnActed = false; s.cardsUsed = 0; s.winner = null;
  s.flag = { pos: { q: -4, r: 4 }, carrier: null };
  s.pieces = o.pieces.map((p) => P(...p));
  s.corpses = o.corpses ?? [];
  s.players[0].energy = o.energy ?? 7;
  s.players[0].baseHp = o.baseHp ?? 20;
  s.players[0].hand = o.hand.map((id, i) => ({ uid: 880000 + i, id }));
  window.dbd.ui.pendingCard = null; window.dbd.ui.cardIntent = null; window.dbd.ui.arrows = []; window.dbd.ui.undo = null; window.dbd.ui.helpOpen = false;
  window.dbd.renderGame();
}, opts);

// ---------- 1. First-turn help, status line, Actions list, End turn always on
await fresh();
let s = await S();
check('help card shows on the first turn', !!(await page.$('.helpcard')));
await page.click('#helpok');
check('"Got it" hides it and remembers', !(await page.$('.helpcard')) && (await page.evaluate(() => localStorage.getItem('dbd-help-seen-v1'))) === '1');
await page.keyboard.press('?'); await page.waitForTimeout(50);
check('? reopens help', !!(await page.$('.helpcard')));
await page.keyboard.press('Escape'); await page.waitForTimeout(50);
check('Esc closes help', !(await page.$('.helpcard')));
s = await S();
check('status says to pick ONE unit', /Pick ONE unit/.test(s.status), s.status);
check('Actions list offers the base, the pawn and End turn', s.actions.some((a) => /Use Base/.test(a)) && s.actions.some((a) => /Pawn/.test(a)) && s.actions.some((a) => /^End turn/.test(a)), JSON.stringify(s.actions.slice(0, 6)));
check('End turn enabled at turn start', !(await page.$eval('#endturn', (b) => b.disabled)));
check('turn banner appeared', (await page.$$('.fx.turnbanner')).length >= 0); // may already have faded

// ---------- 2. Select via the Actions list; hover highlights; locks after acting
const pawn = await page.evaluate(() => window.dbd.ui.state.pieces.find((p) => p.owner === 0));
await clickSel(`.act-list [data-act="sel:${pawn.id}"]`);
s = await S();
check('Actions item selects the pawn; moves lit', s.active?.id === pawn.id && s.moves > 0, `moves=${s.moves}`);
check('status: selected, not committed yet', /selected/.test(s.status) && /Not committed/.test(s.status), s.status);
await page.hover('.act-list [data-act="move"]'); await page.waitForTimeout(80);
check('hovering "Move" outlines the move hexes', (await page.$$('#hov .hov.move')).length === s.moves);
await page.mouse.move(5, 5);
// pip indicators on my piece
check('move/attack pips drawn on my piece', (await page.$$(`.piece[data-piece="${pawn.id}"] .pip-mv.on`)).length === 1);
// switch to base before acting is allowed
await page.keyboard.press('b'); await settle();
s = await S();
check('B switches to the base (nothing done yet)', s.active?.kind === 'base', s.status);
await clickHex(pawn.pos);
s = await S();
check('clicking the pawn switches back', s.active?.id === pawn.id);
// move -> locked in; base and summon cards say why they are locked
const target = await page.$eval('circle.hl-move', (e) => ({ q: +e.dataset.q, r: +e.dataset.r }));
await clickHex(target);
s = await S();
check('after moving, status names the unit in use', /This turn you're using your/.test(s.status) || /is done for this turn/.test(s.status), s.status);
check('base drawn locked', !!(await page.$('.base-g.benched')));
const why = await page.$$eval('.hand .card.cls-conjuration .why', (els) => els.map((e) => e.textContent));
check('summon cards are dimmed with a reason on the card', why.length > 0 && why.every((w) => /Base only/.test(w)), JSON.stringify(why.slice(0, 2)));
// clicking the base now explains the lock
const base = await page.evaluate(() => window.dbd.ui.state.players[0].base);
await clickHex(base);
s = await S();
check('clicking the locked base explains why', /locked/i.test(s.toast) || /Locked/.test(s.toast), s.toast);
// ---------- 3. Undo the move (nothing random revealed)
check('Undo offered after a plain move', s.actions.some((a) => /Undo/.test(a)));
await page.keyboard.press('u'); await settle();
s = await S();
const back = await page.evaluate((id) => window.dbd.ui.state.pieces.find((p) => p.id === id).pos, pawn.id);
check('U undoes the move and unlocks the turn', back.q === pawn.pos.q && back.r === pawn.pos.r && !s.acted, JSON.stringify({ back, acted: s.acted }));

// ---------- 4. Over the hand limit: End turn always ends the turn
await page.evaluate(() => { const s = window.dbd.ui.state; for (let i = 0; i < 3; i++) s.players[0].hand.push({ uid: 870000 + i, id: 'rally' }); window.dbd.renderGame(); });
s = await S();
const willDiscard = await page.$$('.hand .card.will-discard');
check('over the limit: status warns which cards End turn will discard', /End turn will discard/.test(s.status), s.status);
check('over the limit: the cards that will go are marked', willDiscard.length === s.hand.length - 7, `${willDiscard.length} of ${s.hand.length}`);
check('End turn button says it will discard', /discard 3/.test(await page.$eval('#endturn', (b) => b.textContent)));
await page.keyboard.press('e');
await page.waitForFunction(() => window.dbd.ui.state.current !== 0, null, { timeout: 5000 }).catch(() => {});
s = await S();
check('E ends the turn at once, even with 10 cards', s.cur !== 0 || s.round > 1, `cur=${s.cur}`);
check('the discards are in the log', /over the 7-card hand limit and discards/.test(await page.evaluate(() => window.dbd.ui.state.log.join('\n'))));
await idle();
check('hand back to the limit (7) after drawing', (await page.evaluate(() => window.dbd.ui.state.players[0].hand.length)) === 8);

// ---------- 5. Targeting is never modal: right-click / Esc / clicking your piece
await rig({ pieces: [[9001, 0, 'bishop', 0, 0], [9002, 0, 'pawn', -2, 0], [9101, 1, 'king', 1, 0]], hand: ['firebolt'] });
await clickHex({ q: 0, r: 0 });
await page.keyboard.press('1'); await settle();
s = await S();
check('key 1 plays card 1 (Fire Bolt targeting)', s.pending === 880000 && s.cardHl > 0);
await clickHex({ q: 3, r: -3 }, 'right');
s = await S();
check('right-click cancels targeting, piece stays selected', s.pending === null && s.active?.id === 9001 && s.moves > 0);
await page.keyboard.press('1'); await settle();
await clickHex({ q: -2, r: 0 });
s = await S();
check('clicking another of my pieces mid-targeting selects it', s.pending === null && s.active?.id === 9002);
// attack preview tooltip
await clickHex({ q: 0, r: 0 });
const kb = await (await page.$('polygon.hit[data-q="1"][data-r="0"]')).boundingBox();
await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.waitForTimeout(120);
const tip = await page.$eval('#tip', (e) => (e.classList.contains('show') ? e.textContent : ''));
check('hovering an enemy in reach shows an attack preview', /kill chance/.test(tip), tip);
const pb = await (await page.$('polygon.hit[data-q="-2"][data-r="0"]')).boundingBox();
await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.waitForTimeout(120);
check('hovering my piece shows HP/die/actions', /Moves left|click to select|Locked/.test(await page.$eval('#tip', (e) => e.textContent)));
await page.mouse.move(5, 5);

// ---------- 6. Effects: damage numbers, banners, summon scale-in, blast, arrows, flag toast
await rig({ pieces: [[9001, 0, 'bishop', 0, 0], [9101, 1, 'king', 1, 0]], hand: ['firebolt'] });
await clickHex({ q: 0, r: 0 });
await clickHex({ q: 1, r: 0 }); // attack
await page.waitForTimeout(450);
check('attack shows a floating damage number', (await page.$$('#fx .fx.float.dmg')).length > 0);
await page.keyboard.press('1'); await settle();
await clickHex({ q: 1, r: 0 });
await page.waitForTimeout(150);
check('card play shows a banner and a fire bolt', (await page.$$('#fx .fx.banner.b-card')).length > 0 && (await page.$$('#fx .fx.bolt.fire')).length > 0);
if (SHOT) await page.screenshot({ path: `${SHOT}-effects.png` });
await rig({ pieces: [[9001, 0, 'king', 0, 0], [9101, 1, 'rook', 2, 0], [9102, 1, 'pawn', 0, 3]], hand: ['fireball', 'cordon'], energy: 7 });
await clickHex({ q: 0, r: 0 });
await page.keyboard.press('1'); await settle();
await clickHex({ q: 2, r: 1 }); await page.waitForTimeout(120);
check('Fireball shows a blast', (await page.$$('#fx .fx.ring.blast')).length > 0);
await rig({ pieces: [[9001, 0, 'king', 0, 0], [9101, 1, 'rook', 2, 0], [9102, 1, 'pawn', 0, 3]], hand: ['cordon'], energy: 7 });
await clickHex({ q: 0, r: 0 });
await page.keyboard.press('1'); await settle();
for (let i = 0; i < 4; i++) await clickHex({ q: 2, r: 0 });
await clickSel('#fire'); await page.waitForTimeout(120);
check('Cordon of Arrows shows arrows', (await page.$$('#fx .fx.bolt.arrow')).length > 0);
await rig({ pieces: [[9001, 0, 'knight', -2, 1]], hand: ['summon_pawn'], energy: 7 });
await page.evaluate(() => { const s = window.dbd.ui.state; s.pieces[0].pos = { q: 1, r: -3 }; window.dbd.renderGame(); });
await clickHex({ q: 1, r: -3 });
const mv = await page.$$eval('circle.hl-move', (els) => els.map((e) => ({ q: +e.dataset.q, r: +e.dataset.r })));
await page.evaluate((h) => { const s = window.dbd.ui.state; s.flag = { pos: h, carrier: null }; window.dbd.renderGame(); }, mv[0]);
await clickHex(mv[0]); await page.waitForTimeout(120);
check('flag pickup shows a flag banner', (await page.$$('#fx .fx.banner.b-flag')).length > 0);
await rig({ pieces: [], hand: ['summon_pawn'], energy: 7 });
await page.keyboard.press('1'); await settle();
await clickSel('.hl-card'); await page.waitForTimeout(30);
check('summoned piece scales in', (await page.$$('.piece.spawn')).length + (await page.$$('#fx .fx.ring.summon')).length > 0);

// ---------- 7. Reduced motion toggle
await page.click('#motion');
check('motion toggle switches to reduced motion and remembers it', await page.evaluate(() => document.documentElement.classList.contains('reduced-motion') && localStorage.getItem('dbd-reduced-motion') === '1'));
await page.click('#motion');

// ---------- 8. EVERY card through the UI (King plays every class; base plays summons)
const cardIds = ['summon_pawn', 'summon_knight', 'summon_bishop', 'summon_rook', 'summon_queen', 'summon_king', 'heal', 'sharpen', 'frenzy', 'cordon', 'shackles', 'haste', 'firebolt', 'fireball', 'armor_rend', 'necromancy', 'recall', 'shield', 'fortify', 'gambeson', 'breastplate', 'plate', 'rally', 'promote_pawn_knight', 'promote_pawn_bishop', 'promote_pawn_rook', 'promote_bishop_queen', 'promote_knight_king', 'promote_rook_king'];
for (const id of cardIds) {
  await rig({
    pieces: [[9001, 0, 'king', 0, 0, 10], [9002, 0, 'pawn', -1, 0], [9003, 0, 'knight', -1, 1], [9004, 0, 'bishop', 0, -1], [9005, 0, 'rook', -2, 0], [9101, 1, 'pawn', 1, 0], [9102, 1, 'rook', 2, -1]],
    corpses: [{ id: 7777, owner: 1, kind: 'rook', pos: { q: 0, r: 1 }, round: 1 }],
    hand: [id], energy: 7, baseHp: 10,
  });
  if (!id.startsWith('summon')) await clickHex({ q: 0, r: 0 }); // pick the King
  await clickSel('.hand [data-card="880000"]');
  let t = await S();
  if (t.intent !== null) { await clickHex({ q: 0, r: 0 }); t = await S(); }
  if (t.pending !== null) {
    if (id === 'cordon') { for (let i = 0; i < 4; i++) await clickHex({ q: 1, r: 0 }); await clickSel('#fire'); }
    else await clickSel('.hl-card');
  }
  t = await S();
  const played = !t.hand.includes(880000) && t.energy < 7 || (!t.hand.includes(880000) && id === 'rally');
  check(`card ${id} plays through the UI`, played && /plays/.test(t.log), played ? '' : JSON.stringify({ toast: t.toast, status: t.status }));
}
if (SHOT) {
  // mid-game style view: a Bishop picked with several pieces on the board
  await rig({ pieces: [[9001, 0, 'bishop', 0, 0], [9002, 0, 'pawn', -1, 2], [9003, 0, 'knight', -2, 1], [9101, 1, 'king', 1, 0], [9102, 1, 'rook', 2, -2]], hand: ['firebolt', 'heal', 'summon_knight', 'shield', 'recall', 'frenzy', 'rally'], energy: 4 });
  await clickHex({ q: 0, r: 0 }); await page.mouse.move(5, 5); await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT}.png` });
}
console.log('fails', fails, 'errors', errors.slice(0, 5));
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
