export interface Position {
  x: number;
  y: number;
}

/**
 * Collision box for a canvas card. Sized near a typical rendered card
 * (min-width 180 / max-width 280 in styles.css, plus legend/summary), not
 * at the absolute max — oversized boxes made drag-end snaps jump too far.
 */
export const NODE_CARD_SIZE = { width: 240, height: 100 } as const;

/** Minimum gap between card edges once settled. */
export const NODE_CARD_GAP = 16;

export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function expands(size: { width: number; height: number }, gap: number): { width: number; height: number } {
  return { width: size.width + gap, height: size.height + gap };
}

/** True when the two axis-aligned boxes overlap (edges touching is OK). */
export function rectsOverlap(a: NodeRect, b: NodeRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Fraction of the *smaller* rect’s area that intersects the other.
 * Used for drop-to-group (≥ 0.5 means “half of the smaller card overlaps”).
 */
export function overlapRatio(a: NodeRect, b: NodeRect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller === 0 ? 0 : intersection / smaller;
}

/** Compact collapsed group card — roughly one workflow node footprint (style A; unused once style B shipped). */
export const GROUP_COLLAPSED_SIZE = { width: 220, height: 72 } as const;

/** Collapsed style B — mini cluster: header + one row per member. */
export const GROUP_COLLAPSED_WIDTH = 240;
export const GROUP_COLLAPSED_HEADER = 36;
export const GROUP_COLLAPSED_PAD = 16;
export const GROUP_COLLAPSED_ROW = 28;

export function collapsedGroupSize(memberCount: number): { width: number; height: number } {
  const n = Math.max(1, memberCount);
  return {
    width: GROUP_COLLAPSED_WIDTH,
    height: GROUP_COLLAPSED_HEADER + GROUP_COLLAPSED_PAD + n * GROUP_COLLAPSED_ROW,
  };
}

/** Title bar + padding around members when a group is expanded. */
export const GROUP_FRAME_PAD = 12;
export const GROUP_TITLE_HEIGHT = 36;

/** Drop-to-group threshold (see Canvas onNodeDragStop). */
export const GROUP_OVERLAP_THRESHOLD = 0.5;

function collides(
  position: Position,
  obstacles: Position[],
  size: { width: number; height: number }
): boolean {
  const candidate: NodeRect = { ...position, ...size };
  return obstacles.some((pos) => rectsOverlap(candidate, { ...pos, ...size }));
}

function distanceSq(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Keeps `desired` if free; otherwise picks the nearest free spot that just
 * clears neighboring cards — not a coarse full-card spiral, which used to
 * fling the dragged card across (and often out of) the viewport.
 */
export function findOpenPosition(
  desired: Position,
  obstacles: Position[],
  options: {
    size?: { width: number; height: number };
    gap?: number;
    /** How far from `desired` the fine search may wander before giving up. */
    maxSearchDistance?: number;
  } = {}
): Position {
  const size = expands(options.size ?? NODE_CARD_SIZE, options.gap ?? NODE_CARD_GAP);
  if (obstacles.length === 0 || !collides(desired, obstacles, size)) return desired;

  const candidates: Position[] = [];
  const consider = (pos: Position) => {
    if (!collides(pos, obstacles, size)) candidates.push(pos);
  };

  // 1) Minimum clearance against each obstacle — four cardinals, both
  //    "keep the free axis from desired" and "align to the obstacle".
  for (const obs of obstacles) {
    consider({ x: obs.x + size.width, y: desired.y });
    consider({ x: obs.x - size.width, y: desired.y });
    consider({ x: desired.x, y: obs.y + size.height });
    consider({ x: desired.x, y: obs.y - size.height });
    consider({ x: obs.x + size.width, y: obs.y });
    consider({ x: obs.x - size.width, y: obs.y });
    consider({ x: obs.x, y: obs.y + size.height });
    consider({ x: obs.x, y: obs.y - size.height });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => distanceSq(a, desired) - distanceSq(b, desired));
    return candidates[0];
  }

  // 2) Fine local spiral — small steps so we stay near the drop/drag point.
  const step = Math.max(24, Math.round(Math.min(size.width, size.height) / 4));
  const maxSearch = options.maxSearchDistance ?? Math.max(size.width, size.height) * 4;
  const maxRings = Math.ceil(maxSearch / step);

  for (let ring = 1; ring <= maxRings; ring++) {
    const r = ring * step;
    for (let i = -ring; i <= ring; i++) {
      const o = i * step;
      consider({ x: desired.x + r, y: desired.y + o });
      consider({ x: desired.x - r, y: desired.y + o });
      consider({ x: desired.x + o, y: desired.y + r });
      consider({ x: desired.x + o, y: desired.y - r });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => distanceSq(a, desired) - distanceSq(b, desired));
      return candidates[0];
    }
  }

  // 3) Last resort: sit just to the right of the rightmost obstacle, same y.
  const rightmost = obstacles.reduce((max, pos) => Math.max(max, pos.x), desired.x);
  return { x: rightmost + size.width, y: desired.y };
}
