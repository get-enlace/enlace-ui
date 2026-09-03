import { describe, expect, it } from 'vitest';
import {
  findOpenPosition,
  NODE_CARD_GAP,
  NODE_CARD_SIZE,
  overlapRatio,
  rectsOverlap,
} from './nodePlacement.js';

describe('rectsOverlap', () => {
  it('detects partial overlap', () => {
    expect(
      rectsOverlap({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 })
    ).toBe(true);
  });

  it('allows edges that merely touch', () => {
    expect(
      rectsOverlap({ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 100 })
    ).toBe(false);
  });
});

describe('overlapRatio', () => {
  it('is zero for non-overlapping rects', () => {
    expect(overlapRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 })).toBe(0);
  });
});

describe('findOpenPosition', () => {
  const size = { width: 100, height: 80 };
  const gap = 20;
  const box = { width: size.width + gap, height: size.height + gap };

  it('keeps the desired spot when nothing is in the way', () => {
    expect(findOpenPosition({ x: 40, y: 60 }, [], { size, gap })).toEqual({ x: 40, y: 60 });
  });

  it('nudges just clear of another card, not a full spiral jump', () => {
    const open = findOpenPosition({ x: 10, y: 10 }, [{ x: 0, y: 0 }], { size, gap });
    // Nearest clearance is to the right of the obstacle (or similar short push).
    expect(distance(open, { x: 10, y: 10 })).toBeLessThan(box.width + box.height);
    expect(rectsOverlap({ ...open, ...box }, { x: 0, y: 0, ...box })).toBe(false);
  });

  it('prefers the nearest free clearance when several sides are open', () => {
    // Desired is slightly to the right of the obstacle center → right clearance is closest.
    const open = findOpenPosition({ x: 40, y: 0 }, [{ x: 0, y: 0 }], { size, gap });
    expect(open).toEqual({ x: box.width, y: 0 });
  });

  it('stays near desired when the first clearance is blocked by a second card', () => {
    const obstacles = [
      { x: 0, y: 0 },
      { x: box.width, y: 0 }, // blocks the simple "to the right" slot
    ];
    const open = findOpenPosition({ x: 10, y: 10 }, obstacles, { size, gap });
    expect(distance(open, { x: 10, y: 10 })).toBeLessThan(box.width * 2.5);
    for (const obstacle of obstacles) {
      expect(rectsOverlap({ ...open, ...box }, { ...obstacle, ...box })).toBe(false);
    }
  });

  it('uses the default card size constants without options', () => {
    const open = findOpenPosition({ x: 10, y: 10 }, [{ x: 10, y: 10 }]);
    const step = NODE_CARD_SIZE.width + NODE_CARD_GAP;
    expect(distance(open, { x: 10, y: 10 })).toBeLessThanOrEqual(step * step + 1);
    expect(open).not.toEqual({ x: 10, y: 10 });
  });
});

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
