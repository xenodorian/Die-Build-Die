// UX audit: play as a "naive human" with real clicks; log every block (silent or explained), hijack and dead click.
// Usage: node scripts/ux-audit.mjs <url> [rounds=8] [findings.json]   (needs playwright + Chrome)
// UX audit: play as a "naive human" with real clicks only; log every block / hijack / dead click.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'https://xenodorian.github.io/Die-Build-Die/';
const rounds = +(process.argv[3] ?? 6);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('dialog', (d) => d.accept());
const findings = [];
const note = (round, kind, what) => { findings.push({ round, kind, what }); console.log(`[r${round}] ${kind}: ${what}`); };
const idle = () => page.waitForFunction(() => { const s = window.dbd?.ui.state; return s && (s.winner !== null || (!s.players[s.current].isBot && !window.dbd.ui.busy)); }, null, { timeout: 90000 });
const settle = async () => { await page.waitForTimeout(120); await page.waitForFunction(() => !window.dbd.ui.busy); };
const st = () => page.evaluate(() => { const s = window.dbd.ui.state; return { round: s.round, cur: s.current, winner: s.winner, active: s.active, acted: s.turnActed, must: s.mustDiscard, hand: s.players[0].hand.length, energy: s.players[0].energy, mine: s.pieces.filter((p) => p.owner === 0).map((p) => ({ id: p.id, kind: p.kind, mv: p.movesLeft, at: p.attacksLeft })), moves: document.querySelectorAll('.hl-move').length, atks: document.querySelectorAll('.hl-attack').length, playable: document.querySelectorAll('.card.playable').length, toast: document.querySelector('.toast')?.textContent ?? null, status: document.querySelector('.statusbar, .unitpanel, .panel .hint, .hint')?.textContent?.replace(/\s+/g, ' ').slice(0, 160) ?? '', endBtn: !!document.querySelector('#endturn') && !document.querySelector('#endturn').disabled }; });
const clickEl = async (sel) => { const el = await page.$(sel); if (!el) return false; const b = await el.boundingBox(); if (!b) return false; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await settle(); return true; };

await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.click('[data-diff="easy"]'); await page.click('#fast'); await page.click('#start'); await idle();
for (let t = 0; t < rounds; t++) {
  let s = await st(); if (s.winner !== null) break;
  const R = s.round;
  // 1. act with every piece I own, in order (a human with several pieces tries them all)
  for (const p of s.mine) {
    const before = await st();
    await clickEl(`.piece[data-piece="${p.id}"]`);
    const a = await st();
    if (!(a.active?.kind === 'piece' && a.active.id === p.id)) note(R, /locked|next turn/i.test(a.toast ?? '') ? 'LOCKED-EXPLAINED' : 'BLOCKED', `clicked my ${p.kind} (mv ${p.mv}, at ${p.at}) but it was not selected. toast="${a.toast}"`);
    else if (a.moves === 0 && p.mv > 0) note(R, 'DEAD', `${p.kind} selected but no move hexes lit`);
    else if (a.moves > 0) {
      // move toward the centre: click the lit move hex closest to (0,0)
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('.hl-move')];
        els.sort((x, y) => { const d = (e) => { const q = +e.getAttribute('data-q'), r = +e.getAttribute('data-r'); return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); }; return d(x) - d(y); });
        window.__target = els[0] ? { q: els[0].getAttribute('data-q'), r: els[0].getAttribute('data-r') } : null;
      });
      const tgt = await page.evaluate(() => window.__target);
      if (tgt && tgt.q !== null) await clickEl(`polygon.hit[data-q="${tgt.q}"][data-r="${tgt.r}"]`);
      else await clickEl('.hl-move');
      const b = await st();
      const moved = b.mine.find((x) => x.id === p.id)?.mv < p.mv;
      if (!moved) note(R, 'DEAD', `clicked a lit move hex for ${p.kind}, nothing moved`);
      if (b.atks > 0) { await clickEl('.hl-attack'); }
    }
  }
  // 2. try to summon with whatever glowing conjuration there is
  s = await st();
  const conj = await page.$('.card.cls-conjuration');
  if (conj) {
    const uid = await conj.getAttribute('data-card');
    const cls = await conj.getAttribute('class');
    await clickEl(`[data-card="${uid}"]`);
    const a = await st();
    const why = await page.evaluate((u) => document.querySelector(`[data-card="${u}"] .why`)?.textContent ?? '', uid).catch(() => '');
    if (!/playable/.test(cls)) note(R, why ? 'LOCKED-EXPLAINED' : 'BLOCKED', `summon card dimmed after acting with a piece; on-card reason="${why}"; click says: "${a.toast}"`);
    else if (a.moves + (await page.$$eval('.hl-card', (e) => e.length)) > 0) { await clickEl('.hl-card'); }
  }
  // 3. end turn like a human: click End turn once
  s = await st();
  const handBefore = s.hand;
  await clickEl('#endturn');
  await page.waitForTimeout(300);
  const e = await st();
  if (e.cur === 0 && e.round === s.round && e.winner === null) {
    note(R, 'BLOCKED', `clicked End turn with ${handBefore} cards: turn did NOT end. must=${e.must} toast="${e.toast}" status="${e.status}"`);
    // what does a human see now? try clicking a piece
    if (s.mine[0]) { await clickEl(`.piece[data-piece="${s.mine[0].id}"]`); const f = await st(); if (!(f.active?.id === s.mine[0].id)) note(R, 'BLOCKED', `while the discard prompt is up, clicking my ${s.mine[0].kind} does nothing (toast="${f.toast}")`); }
    while ((await st()).must > 0) { await clickEl('.card'); }
  }
  await idle();
}
const s = await st();
console.log(JSON.stringify({ end: s, findings: findings.length }));
const fs = await import('fs'); fs.writeFileSync(process.argv[4] ?? '/workspace/pwtools/audit-findings.json', JSON.stringify(findings, null, 1));
const kinds = {}; for (const f of findings) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1; console.log('SUMMARY', JSON.stringify(kinds));
await browser.close();
