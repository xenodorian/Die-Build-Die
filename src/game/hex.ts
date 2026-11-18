// Axial hex coordinates (q, r); the implied cube coordinate is s = -q - r.
export interface Hex {
  q: number;
  r: number;
}

export const hex = (q: number, r: number): Hex => ({ q, r });
export const hexKey = (h: Hex): string => `${h.q},${h.r}`;
export const hexEq = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;
export const hexAdd = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });
export const hexScale = (a: Hex, k: number): Hex => ({ q: a.q * k, r: a.r * k });
export const sOf = (h: Hex): number => -h.q - h.r;

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

/** The 6 edge-sharing neighbour directions ("orthogonal" / rook lines). */
export const DIRECTIONS: Hex[] = [
  hex(1, 0), hex(1, -1), hex(0, -1), hex(-1, 0), hex(-1, 1), hex(0, 1),
];

/** The 6 hex "diagonals" (bishop lines): distance 2, between two neighbours. */
export const DIAGONALS: Hex[] = [
  hex(2, -1), hex(1, -2), hex(-1, -1), hex(-2, 1), hex(-1, 2), hex(1, 1),
];

/** Glinski-style knight jumps: the 12 hexes at distance 3 that are not on a straight line. */
export const KNIGHT_JUMPS: Hex[] = (() => {
  const out: Hex[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      const h = hex(q, r);
      if (hexDistance(h, hex(0, 0)) !== 3) continue;
      const onLine = q === 0 || r === 0 || sOf(h) === 0;
      if (!onLine) out.push(h);
    }
  }
  return out;
})();

export const neighbors = (h: Hex): Hex[] => DIRECTIONS.map((d) => hexAdd(h, d));

/** All hexes of a hexagon-shaped board with the given radius, centred on (0,0). */
export function hexagonBoard(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push(hex(q, r));
    }
  }
  return out;
}

/** The 6 corners of a radius-R hexagon, in clockwise order on screen (pointy-top layout). */
export function corners(radius: number): Hex[] {
  return [
    hex(0, -radius),       // upper left
    hex(radius, -radius),  // upper right
    hex(radius, 0),        // right
    hex(0, radius),        // lower right
    hex(-radius, radius),  // lower left
    hex(-radius, 0),       // left
  ];
}

export const inBoard = (h: Hex, radius: number): boolean => hexDistance(h, hex(0, 0)) <= radius;
