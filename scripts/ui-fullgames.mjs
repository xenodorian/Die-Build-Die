// Full games vs Easy AI, played as the human with REAL clicks only (state is only read, never written).
// Usage: node scripts/ui-fullgames.mjs <url> [games=3] [maxRounds=80] [screenshot-prefix]
// Needs `playwright` resolvable (run from a folder that has it) and Chrome at /usr/bin/google-chrome.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4175/Die-Build-Die/';
const GAMES = +(process.argv[3] ?? 3);
const MAX_ROUNDS = +(process.argv[4] ?? 80);
const SHOT = process.argv[5];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
let fails = 0;
const bad = (msg) => { fails++; console.log('FAIL', msg); };
const idle = () => page.waitForFunction(() => { const s = window.dbd?.ui.state; return s && (s.winner !== null || (!s.players[s.current].isBot && !window.dbd.ui.busy)); }, null, { timeout: 120000 });
const settle = async () => { await page.waitForTimeout(60); await page.waitForFunction(() => !window.dbd.ui.busy, null, { timeout: 20000 }); };
const st = () => page.evaluate(() => {
  const s = window.dbd.ui.state; const me = s.players[0];
  const fh = s.flag.carrier !== null ? s.pieces.find((p) => p.id === s.flag.carrier)?.pos : s.flag.pos;
  return { round: s.round, cur: s.current, winner: s.winner, active: s.active, acted: s.turnActed, hand: me.hand.length, energy: me.energy, base: me.base, carrier: s.flag.carrier, flag: fh,
    mine: s.pieces.filter((p) => p.owner === 0).map((p) => ({ id: p.id, kind: p.kind, pos: p.pos, mv: p.movesLeft, at: p.attacksLeft })),
    moves: [...document.querySelectorAll('circle.hl-move')].map((e) => ({ q: +e.dataset.q, r: +e.dataset.r })),
    atks: document.querySelectorAll('.hl-attack').length, cardHl: document.querySelectorAll('.hl-card').length,
    playable: [...document.querySelectorAll('.hand .card.playable:not(.via-switch)')].map((e) => +e.dataset.card),
    summonable: [...document.querySelectorAll('.hand .card.cls-conjuration.playable')].map((e) => +e.dataset.card),
    benched: document.querySelectorAll('.piece.benched').length, status: document.querySelector('.statusbar')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
    actions: [...document.querySelectorAll('.act-list .ai')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    endEnabled: !document.querySelector('#endturn')?.disabled };
});
const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const clickHex = async (h) => { const el = await page.$(`polygon.hit[data-q="${h.q}"][data-r="${h.r}"]`); const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await settle(); };
/** Click an element's centre with the mouse (for SVG highlights the click lands on the click layer). */
const clickSel = async (sel) => { const el = await page.$(sel); if (!el) return false; const b = await el.boundingBox(); if (!b) return false; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await settle(); return true; };

const results = [];
for (let g = 0; g < GAMES; g++) {
  await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click('[data-diff="easy"]'); await page.click('#fast'); await page.click('#start');
  await idle();
  let turns = 0, lockChecks = 0, overLimitEnds = 0, unitTurns = 0, baseTurns = 0;
  while (true) {
    let s = await st();
    if (s.winner !== null || s.round > MAX_ROUNDS) break;
    turns++;
    if (s.active !== null) bad(`g${g} r${s.round}: turn started with a unit already selected`);
    if (!s.endEnabled) bad(`g${g} r${s.round}: End turn disabled at turn start`);
    if (!/Pick ONE unit/.test(s.status)) bad(`g${g} r${s.round}: status doesn't say to pick a unit: ${s.status}`);
    const carrying = s.carrier !== null && s.mine.some((p) => p.id === s.carrier);
    const wantSummon = s.mine.length < 3 && s.summonable.length > 0 && !carrying;
    if (wantSummon) {
      baseTurns++;
      if (!(await clickSel('.act-list [data-act="sel:base"]'))) bad(`g${g} r${s.round}: no 'Use Base' action`);
      for (let k = 0; k < 4; k++) {
        s = await st();
        const uid = s.summonable[0];
        if (!uid) break;
        await clickSel(`.hand [data-card="${uid}"]`);
        const t = await st();
        if (t.cardHl === 0) { bad(`g${g} r${s.round}: summon card click lit no target`); break; }
        await clickSel('.hl-card');
        const after = await st();
        if (after.mine.length <= s.mine.length) { bad(`g${g} r${s.round}: summon did not place a piece`); break; }
        if (after.mine.length > 0 && after.benched === 0) bad(`g${g} r${s.round}: after summoning, pieces are not shown locked`);
        if (!/using your base/.test(after.status)) bad(`g${g} r${s.round}: status doesn't say the base is in use: ${after.status}`);
      }
    } else if (s.mine.length) {
      unitTurns++;
      const goalOf = (p) => (s.carrier === p.id ? s.base : s.flag ?? s.base);
      const cands = s.mine.filter((p) => p.mv > 0 || p.at > 0);
      if (cands.length) {
        cands.sort((a, b) => dist(a.pos, goalOf(a)) - dist(b.pos, goalOf(b)));
        const p = cands[0];
        await clickHex(p.pos);
        let a = await st();
        if (!(a.active?.kind === 'piece' && a.active.id === p.id)) bad(`g${g} r${s.round}: clicking my ${p.kind} did not select it (${a.status})`);
        else {
          if (a.atks > 0) {
            await clickSel('.act-list [data-act="attack"]'); // one target: attacks it; several: highlights them
            a = await st();
            if (a.atks > 0 && a.winner === null) await clickSel('.hl-attack');
          }
          a = await st();
          if (a.winner === null && a.moves.length) {
            const goal = a.carrier === p.id ? a.base : a.flag ?? a.base;
            const best = [...a.moves].sort((x, y) => dist(x, goal) - dist(y, goal))[0];
            await clickHex(best);
            const b = await st();
            const moved = b.mine.find((x) => x.id === p.id);
            if (moved && moved.pos.q === p.pos.q && moved.pos.r === p.pos.r && b.winner === null) bad(`g${g} r${s.round}: clicking a lit move hex did not move`);
            if (b.winner === null && b.mine.length > 1) {
              lockChecks++;
              if (b.benched === 0) bad(`g${g} r${s.round}: after acting, other units are not shown locked`);
              if (!/This turn you're using|is done for this turn/.test(b.status)) bad(`g${g} r${s.round}: status doesn't say which unit is in use: ${b.status}`);
              const other = b.mine.find((x) => x.id !== p.id);
              await clickHex(other.pos);
              const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
              if (!/locked|next turn/i.test(toast)) bad(`g${g} r${s.round}: clicking a locked piece gave no explanation (toast="${toast}")`);
            }
          }
          a = await st();
          if (a.winner === null && a.playable.length) {
            await clickSel(`.hand [data-card="${a.playable[0]}"]`);
            const c = await st();
            if (c.cardHl > 0) await clickSel('.hl-card');
          }
        }
      }
    }
    s = await st();
    if (s.winner !== null) break;
    const handBefore = s.hand;
    if (!s.endEnabled) bad(`g${g} r${s.round}: End turn disabled before ending`);
    await clickSel('#endturn');
    const e = await page.evaluate(() => ({ cur: window.dbd.ui.state.current, round: window.dbd.ui.state.round, log: window.dbd.ui.state.log.slice(-15).join('\n') }));
    if (e.cur === 0 && e.round === s.round) bad(`g${g} r${s.round}: End turn did not end the turn`);
    if (handBefore > 7) { overLimitEnds++; if (!/hand limit and discards/.test(e.log)) bad(`g${g} r${s.round}: over-limit End turn didn't log the discards`); }
    await idle();
  }
  const s = await st();
  const res = { game: g + 1, winner: s.winner === 0 ? 'human' : s.winner === null ? 'unfinished' : 'AI', round: s.round, myTurns: turns, unitTurns, baseTurns, overLimitEnds, lockChecks };
  results.push(res);
  console.log('game', JSON.stringify(res));
  if (SHOT) await page.screenshot({ path: `${SHOT}-game${g + 1}-end.png` });
}
console.log('fails', fails, 'errors', errors.slice(0, 5));
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
