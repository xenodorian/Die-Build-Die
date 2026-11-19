/**
 * Transient action effects (floating numbers, banners, blasts, arrows, turn banner).
 * They live in a fixed layer on <body>, outside the re-rendered app, so a re-render never
 * cuts an effect short, and they never take pointer events (input is never blocked).
 */
import type { Hex } from '../game/hex';

let layer: HTMLElement | null = null;
let reduced = false;

export function setReducedMotion(on: boolean) {
  reduced = on;
  document.documentElement.classList.toggle('reduced-motion', on);
}
export const reducedMotion = () => reduced;

function host(): HTMLElement {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.id = 'fx';
    document.body.appendChild(layer);
  }
  return layer;
}

/** Screen position (page px) of a hex centre on the current board, or null if no board. */
export function hexToScreen(h: Hex, size: number): { x: number; y: number } | null {
  const svg = document.querySelector('svg.board') as SVGSVGElement | null;
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = size * Math.sqrt(3) * (h.q + h.r / 2);
  pt.y = size * 1.5 * h.r;
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

/** Hex size in screen px (for scaling ring effects). */
function hexPx(size: number): number {
  const svg = document.querySelector('svg.board') as SVGSVGElement | null;
  return (svg?.getScreenCTM()?.a ?? 1) * size;
}

function spawn(cls: string, html: string, x: number, y: number, ms: number): HTMLElement {
  const el = document.createElement('div');
  el.className = `fx ${cls}`;
  el.innerHTML = html;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  host().appendChild(el);
  setTimeout(() => el.remove(), reduced ? Math.min(ms, 900) : ms);
  return el;
}

/** A number or label floating up from a hex: '-5', '+3 ❤', '🛡 +4'. */
export function floatText(h: Hex, size: number, text: string, kind: 'dmg' | 'heal' | 'shield' | 'info' | 'crit' = 'info', delay = 0) {
  const p = hexToScreen(h, size);
  if (!p) return;
  const run = () => spawn(`float ${kind}`, text, p.x, p.y - 10, 1100);
  if (delay) setTimeout(run, delay);
  else run();
}

/** An expanding ring on a hex (impact, heal glow, summon flash, blast). */
export function ring(h: Hex, size: number, kind: 'hit' | 'heal' | 'shield' | 'summon' | 'blast' | 'death' | 'flag', hexes = 1) {
  const p = hexToScreen(h, size);
  if (!p) return;
  const r = hexPx(size) * (kind === 'blast' ? hexes * 1.9 + 1 : 1.1);
  const el = spawn(`ring ${kind}`, '', p.x, p.y, 700);
  el.style.width = el.style.height = `${r * 2}px`;
}

/** Lines that fly from `from` to each target (arrows, firebolts). */
export function bolts(from: Hex, targets: Hex[], size: number, kind: 'arrow' | 'fire') {
  const a = hexToScreen(from, size);
  if (!a) return;
  targets.forEach((t, i) => {
    const b = hexToScreen(t, size);
    if (!b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    setTimeout(() => {
      const el = spawn(`bolt ${kind}`, '', a.x, a.y, 600);
      el.style.width = `${len}px`;
      el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }, i * 90);
  });
}

/** A banner across the top of the board: card plays, flag news. */
export function banner(html: string, color: string, kind: 'card' | 'flag' | 'info' = 'card') {
  const board = document.querySelector('.board-wrap') as HTMLElement | null;
  const r = board?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + 54 : 90;
  host().querySelectorAll(`.banner.b-${kind}`).forEach((b) => b.remove());
  const el = spawn(`banner b-${kind}`, html, x, y, kind === 'flag' ? 2200 : 1600);
  el.style.setProperty('--pc', color);
}

/** Big centred 'Your turn' / 'Gold's turn' banner. */
export function turnBanner(text: string, sub: string, color: string) {
  const board = document.querySelector('.board-wrap') as HTMLElement | null;
  const r = board?.getBoundingClientRect();
  host().querySelectorAll('.turnbanner').forEach((b) => b.remove());
  const el = spawn('turnbanner', `<div class="t">${text}</div><div class="s">${sub}</div>`, r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2, 1300);
  el.style.setProperty('--pc', color);
}

/** Ghost of a piece that just died: fades and sinks where it stood. */
export function deathGhost(h: Hex, size: number, glyph: string, color: string) {
  const p = hexToScreen(h, size);
  if (!p) return;
  const el = spawn('ghost', `<span class="disc" style="background:${color}">${glyph}</span>`, p.x, p.y, 800);
  el.style.setProperty('--d', `${hexPx(size) * 1.35}px`);
}
