'use client';

/**
 * Deterministic 1-bit pixel bust drawn from a seed string. Agents without an
 * uploaded avatar get a stable monochrome portrait instead of initials.
 */

const GRID = 16;

function seedHash(input: string): number {
  let hash = 2166136261;
  for (const ch of input) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = boolean[][];

function emptyGrid(): Grid {
  return Array.from({ length: GRID }, () => Array<boolean>(GRID).fill(false));
}

/** Paints x..x2 inclusive on row y, clipped to the grid. */
function span(grid: Grid, y: number, x: number, x2: number): void {
  if (y < 0 || y >= GRID) return;
  for (let i = Math.max(0, x); i <= Math.min(GRID - 1, x2); i += 1) grid[y]![i] = true;
}

function clear(grid: Grid, y: number, x: number, x2: number): void {
  if (y < 0 || y >= GRID) return;
  for (let i = Math.max(0, x); i <= Math.min(GRID - 1, x2); i += 1) grid[y]![i] = false;
}

export function buildPortrait(seed: string): Grid {
  const rand = mulberry32(seedHash(seed));
  const pick = (n: number) => Math.floor(rand() * n);
  const grid = emptyGrid();

  const hair = pick(5); // 0 crop, 1 side sweep, 2 curly, 3 long, 4 buzz
  const headphones = rand() < 0.18;
  const glasses = rand() < 0.28;
  const facial = pick(3); // 0 clean, 1 mustache, 2 full beard
  const shirt = pick(3); // 0 crew, 1 open collar, 2 tie

  // Shirt and shoulders.
  span(grid, 15, 2, 13);
  span(grid, 14, 2, 13);
  span(grid, 13, 3, 12);
  span(grid, 12, 4, 5);
  span(grid, 12, 10, 11);
  if (shirt === 1) {
    clear(grid, 13, 7, 8);
    clear(grid, 14, 7, 8);
  } else if (shirt === 2) {
    clear(grid, 13, 6, 9);
    clear(grid, 14, 6, 9);
    clear(grid, 15, 6, 9);
    span(grid, 13, 7, 8);
    span(grid, 14, 7, 8);
    span(grid, 15, 7, 8);
  }

  // Hair cap; the face below stays paper-white.
  span(grid, 2, 5, 10);
  span(grid, 3, 4, 11);
  if (hair === 0) {
    span(grid, 4, 4, 5);
    span(grid, 4, 10, 11);
    span(grid, 5, 4, 4);
    span(grid, 5, 11, 11);
  } else if (hair === 1) {
    span(grid, 4, 4, 8);
    span(grid, 5, 4, 4);
    span(grid, 5, 11, 11);
    span(grid, 6, 4, 4);
  } else if (hair === 2) {
    span(grid, 1, 6, 9);
    span(grid, 2, 4, 11);
    span(grid, 4, 4, 4);
    span(grid, 4, 11, 11);
    span(grid, 3, 3, 3);
    span(grid, 3, 12, 12);
    span(grid, 5, 3, 4);
    span(grid, 5, 11, 12);
  } else if (hair === 3) {
    span(grid, 4, 3, 4);
    span(grid, 4, 11, 12);
    for (let y = 5; y <= 10; y += 1) {
      span(grid, y, 3, 3);
      span(grid, y, 12, 12);
    }
    span(grid, 11, 3, 4);
    span(grid, 11, 11, 12);
  } else {
    clear(grid, 2, 5, 10);
    span(grid, 3, 5, 10);
  }

  if (headphones) {
    span(grid, 1, 5, 10);
    span(grid, 2, 4, 4);
    span(grid, 2, 11, 11);
    for (let y = 6; y <= 8; y += 1) {
      span(grid, y, 2, 3);
      span(grid, y, 12, 13);
    }
  }

  // Eyes / glasses; eyeRow shifts some faces down a pixel for variety.
  const eyeRow = 6 + pick(2);
  if (glasses) {
    span(grid, eyeRow, 5, 6);
    span(grid, eyeRow, 9, 10);
    span(grid, eyeRow + 1, 5, 6);
    span(grid, eyeRow + 1, 9, 10);
    grid[eyeRow]![7] = true;
    grid[eyeRow]![8] = true;
  } else {
    const wide = rand() < 0.5;
    span(grid, eyeRow, wide ? 5 : 6, 6);
    span(grid, eyeRow, 9, wide ? 10 : 9);
    if (rand() < 0.35) {
      span(grid, eyeRow - 1, 5, 6);
      span(grid, eyeRow - 1, 9, 10);
    }
  }

  // Nose.
  if (rand() < 0.6) span(grid, eyeRow + 2, 7, 8);

  // Mouth and facial hair.
  const mouth = pick(3); // 0 narrow, 1 medium, 2 wide
  const mouthSpan: [number, number] = mouth === 0 ? [7, 8] : mouth === 1 ? [6, 9] : [5, 10];
  if (facial === 2) {
    span(grid, 9, 4, 11);
    span(grid, 10, 4, 11);
    span(grid, 11, 6, 9);
    clear(grid, 10, mouthSpan[0], mouthSpan[1]); // mouth gap inside the beard
  } else {
    if (facial === 1) span(grid, 9, 5, 10);
    span(grid, 10, mouthSpan[0], mouthSpan[1]);
  }

  return grid;
}

export function PixelPortrait({ seed, className = '' }: { seed: string; className?: string }) {
  const grid = buildPortrait(seed);
  const cells: string[] = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (grid[y]![x]) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return (
    <svg
      viewBox={`0 0 ${GRID} ${GRID}`}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path fill="currentColor" d={cells.join('')} />
    </svg>
  );
}
