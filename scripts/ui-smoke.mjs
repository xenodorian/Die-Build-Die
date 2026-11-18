// UI smoke test (Playwright + system Chrome). Usage: node scripts/ui-smoke.mjs <url> [screenshot.png]
// Needs `playwright` installed (e.g. in a tools folder) — not a project dependency.
// UI smoke test: a human-selected piece can move, attack and play one card in every order (real clicks).
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4175/Die-Build-Die/';
const shot = process.argv[3];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.evaluate(() => localStorage.removeItem('dbd-setup'));
await page.reload();
await page.click('#fast');
await page.click('#start');
const idle = () => page.waitForFunction(() => { const s = window.dbd.ui.state; return s.winner !== null || (!s.players[s.current].isBot && !window.dbd.ui.busy); }, null, { timeout: 60000 });
await idle();
const clickHex = async (h) => {
  const el = await page.$(`polygon.hit[data-q="${h.q}"][data-r="${h.r}"]`);
  const b = await el.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(60);
  await page.waitForFunction(() => !window.dbd.ui.busy);
};
const clickCard = async (id) => {
  const uid = await page.evaluate((id) => window.dbd.ui.state.players[0].hand.find((c) => c.id === id)?.uid, id);
  await page.click(`[data-card="${uid}"]`);
  await page.waitForTimeout(60);
  await page.waitForFunction(() => !window.dbd.ui.busy);
};
const SC = {
  pawn: { kind: 'pawn', start: { q: 0, r: 0 }, dest: { q: -1, r: 0 }, e1: { q: 1, r: 0 }, e2: { q: -2, r: 0 }, card: 'heal', cardTarget: 'self' },
  knight_sharpen: { kind: 'knight', start: { q: 0, r: 0 }, dest: { q: 1, r: 2 }, e1: { q: -1, r: 0 }, e2: { q: 1, r: 3 }, card: 'sharpen' },
  knight_haste: { kind: 'knight', start: { q: 0, r: 0 }, dest: { q: 1, r: 2 }, e1: { q: -1, r: 0 }, e2: { q: 1, r: 3 }, card: 'haste' },
  bishop: { kind: 'bishop', start: { q: 0, r: 0 }, dest: { q: 1, r: 1 }, e1: { q: -1, r: 0 }, e2: { q: 2, r: 1 }, card: 'firebolt', cardTarget: 'e1' },
};
async function setup(sc, sick) {
  await page.evaluate(({ sc, sick }) => {
    const s = window.dbd.ui.state;
    s.current = 0; s.active = null; s.turnActed = false; s.cardsUsed = 0; s.mustDiscard = 0; s.winner = null;
    s.flag = { pos: { q: -4, r: 4 }, carrier: null };
    s.corpses = [];
    const mk = (id, owner, kind, pos, hp) => ({ id, owner, kind, pos, hp, maxHp: hp + 0, movesLeft: sick && owner === 0 ? 0 : 1, attacksLeft: sick && owner === 0 ? 0 : 1, shield: 0, bonusDamage: 0, armor: null });
    const HP = { pawn: 4, knight: 6, bishop: 8 };
    const me = mk(9001, 0, sc.kind, sc.start, HP[sc.kind]);
    me.hp = me.maxHp - 2;
    s.pieces = [me, mk(9002, 1, 'king', sc.e1, 20), mk(9003, 1, 'king', sc.e2, 20)];
    const p0 = s.players[0];
    p0.energy = 7;
    p0.hand = [{ uid: 777001, id: sc.card }, { uid: 777002, id: 'summon_pawn' }];
    window.dbd.ui.selectedPiece = null; window.dbd.ui.pendingCard = null;
    window.dbd.renderGame();
  }, { sc, sick });
}
const snap = () => page.evaluate(() => { const s = window.dbd.ui.state; const p = s.pieces.find((x) => x.id === 9001); return { pos: p?.pos, mv: p?.movesLeft, at: p?.attacksLeft, cards: s.cardsUsed, active: s.active, moves: document.querySelectorAll('.hl-move').length, atks: document.querySelectorAll('.hl-attack').length, playable: !!document.querySelector('[data-card="777001"].playable'), hint: document.querySelector('.selinfo')?.textContent?.replace(/\s+/g, ' ').trim() }; });
const perms = [['move', 'attack', 'card'], ['move', 'card', 'attack'], ['attack', 'move', 'card'], ['attack', 'card', 'move'], ['card', 'move', 'attack'], ['card', 'attack', 'move']];
let fails = 0;
for (const [name, sc] of Object.entries(SC)) {
  for (const order of perms) {
    await setup(sc, false);
    await clickHex(sc.start); // select the piece
    const log = [];
    let moved = false;
    for (const step of order) {
      const before = await snap();
      if (step === 'move') {
        await clickHex(sc.dest);
        moved = true;
      } else if (step === 'attack') {
        // attack whichever enemy is adjacent now
        await clickHex(moved ? sc.e2 : sc.e1);
      } else {
        await clickCard(sc.card);
        if (sc.cardTarget === 'self') await clickHex(moved ? sc.dest : sc.start);
        if (sc.cardTarget === 'e1') await clickHex(sc.e1);
      }
      const after = await snap();
      const ok = step === 'move' ? after.mv < before.mv : step === 'attack' ? after.at < before.at : after.cards > before.cards;
      log.push(`${step}:${ok ? 'ok' : 'FAIL'}`);
      if (!ok) { fails++; log.push(JSON.stringify(before)); }
    }
    const end = await snap();
    console.log(name.padEnd(15), order.join('→').padEnd(20), log.join(' '), '| still selected:', end.active?.id === 9001);
  }
}
// summoned-last-turn: a sick piece can't act this turn, but next turn it can do all three
await setup(SC.pawn, true);
await clickHex(SC.pawn.start);
console.log('sick piece selectable:', JSON.stringify(await snap()));
// Clicking a card your current pick can't use switches to a unit that can (before it acts).
await setup(SC.knight_sharpen, false);
await page.evaluate(() => { const s = window.dbd.ui.state; s.players[0].hand = [{ uid: 777001, id: 'sharpen' }, { uid: 777002, id: 'summon_pawn' }]; window.dbd.renderGame(); });
await clickCard('summon_pawn');
const sw1 = await page.evaluate(() => ({ active: window.dbd.ui.state.active, pending: window.dbd.ui.pendingCard, targets: document.querySelectorAll('.hl-card').length }));
console.log('conjuration click with nothing picked -> summon targets shown:', JSON.stringify(sw1), sw1.pending === 777002 && sw1.targets > 0 ? 'ok' : 'FAIL');
if (!(sw1.pending === 777002 && sw1.targets > 0)) fails++;
await page.keyboard.press('Escape');
await clickCard('sharpen');
const sw2 = await page.evaluate(() => ({ active: window.dbd.ui.state.active, cards: window.dbd.ui.state.cardsUsed, bonus: window.dbd.ui.state.pieces.find((p) => p.id === 9001).bonusDamage }));
console.log('Sharpen click while base picked -> switched to the Knight and played:', JSON.stringify(sw2), sw2.active?.id === 9001 && sw2.bonus === 2 ? 'ok' : 'FAIL');
if (!(sw2.active?.id === 9001 && sw2.bonus === 2)) fails++;

// Real first turn of a fresh game: the starting pawn moves off its base, then plays Heal (given one).
await page.click('#newgame');
await page.waitForTimeout(300);
await page.click('#start');
await idle();
const pawn0 = await page.evaluate(() => { const s = window.dbd.ui.state; s.players[0].hand[0] = { uid: 888001, id: 'heal' }; window.dbd.renderGame(); return s.pieces.find((p) => p.owner === 0); });
await clickHex(pawn0.pos);
const dot = await page.evaluate(() => { const c = document.querySelector('.hl-move'); return c && [c.getAttribute('cx'), c.getAttribute('cy')]; });
const dotEl = await page.$('.hl-move');
const db = await dotEl.boundingBox();
await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2);
await page.waitForFunction(() => !window.dbd.ui.busy);
await page.click('[data-card="888001"]');
await page.waitForTimeout(100);
const newPos = await page.evaluate(() => window.dbd.ui.state.pieces.find((p) => p.owner === 0).pos);
await clickHex(newPos);
const t1 = await page.evaluate(() => ({ energy: window.dbd.ui.state.players[0].energy, cards: window.dbd.ui.state.cardsUsed, moved: window.dbd.ui.state.pieces.find((p) => p.owner === 0).movesLeft === 0, checklist: document.querySelector('.actions')?.textContent?.replace(/\s+/g, ' ').trim() }));
console.log('turn 1 pawn move then Heal:', JSON.stringify(t1), t1.cards === 1 && t1.moved && t1.energy === 1 ? 'ok' : 'FAIL');
if (!(t1.cards === 1 && t1.moved)) fails++;
// End turn with 8 cards in hand → discard prompt, then the AI plays
await page.click('#endturn');
await page.waitForTimeout(200);
const disc = await page.evaluate(() => window.dbd.ui.state.mustDiscard);
if (disc > 0) { await page.click('.card.to-discard'); }
await page.waitForFunction(() => window.dbd.ui.state.current !== 0 || window.dbd.ui.state.round > 1, null, { timeout: 30000 });
console.log('end turn (discard prompt shown:', disc, ') -> turn passed ok');
await idle();
if (shot) {
  await setup(SC.bishop, false);
  await clickHex(SC.bishop.start);
  await clickHex(SC.bishop.dest);
  await page.waitForTimeout(300);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: shot });
  console.log('mid-turn', JSON.stringify(await snap()));
}
console.log('fails', fails, 'errors', errors);
await browser.close();
process.exit(fails ? 1 : 0);
