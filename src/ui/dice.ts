import type { Die } from '../game/config';

/** SVG outline for each die type so a d4 looks different from a d20. */
const SHAPES: Record<Die, string> = {
  4: '50,6 94,88 6,88',
  6: '12,12 88,12 88,88 12,88',
  8: '50,4 94,50 50,96 6,50',
  10: '50,4 92,40 50,96 8,40',
  12: '50,4 95,37 78,92 22,92 5,37',
  20: '50,3 92,27 92,73 50,97 8,73 8,27',
};

export function dieSvg(die: Die, value: number | string, color: string, size = 72): string {
  const y = die === 4 ? 70 : die === 10 ? 52 : 60;
  return `<svg class="die" width="${size}" height="${size}" viewBox="0 0 100 100">
    <polygon points="${SHAPES[die]}" fill="${color}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
    <text x="50" y="${y}" text-anchor="middle" font-size="${String(value).length > 1 ? 30 : 36}" font-weight="800" fill="#fff">${value}</text>
    <text x="50" y="${die === 4 ? 84 : 86}" text-anchor="middle" font-size="11" fill="rgba(255,255,255,.75)">d${die}</text>
  </svg>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Show an animated roll in the overlay element and resolve when it is done. */
export async function animateRoll(
  host: HTMLElement,
  opts: { label: string; dice: Die[]; values: number[]; bonus: number; total: number; color: string; fast?: boolean },
): Promise<void> {
  const { label, dice, values, bonus, total, color, fast } = opts;
  host.innerHTML = `<div class="roll-card"><div class="roll-label">${label}</div><div class="roll-dice"></div><div class="roll-total">&nbsp;</div></div>`;
  host.classList.add('show');
  const diceEl = host.querySelector('.roll-dice') as HTMLElement;
  const totalEl = host.querySelector('.roll-total') as HTMLElement;
  const frames = fast ? 6 : 12;
  for (let f = 0; f < frames; f++) {
    diceEl.innerHTML = dice.map((d) => `<span class="spin">${dieSvg(d, 1 + Math.floor(Math.random() * d), color)}</span>`).join('');
    await sleep(45 + f * 6);
  }
  diceEl.innerHTML = dice.map((d, i) => `<span class="landed">${dieSvg(d, values[i], color)}</span>`).join('');
  totalEl.textContent = bonus ? `${values.join(' + ')} + ${bonus} = ${total}` : dice.length > 1 ? `${values.join(' + ')} = ${total}` : `${total}`;
  await sleep(fast ? 450 : 900);
  host.classList.remove('show');
  await sleep(120);
}
