import { describe, expect, it } from 'vitest';
import {
  expandedGroupFrame,
  findGroupDropTarget,
  findUngroupedOutsidersInFrame,
  groupContainingNode,
  memberBounds,
  nudgeOutsideFrame,
  sortGroupMemberIds,
} from './groupGeometry.js';
import {
  collapsedGroupSize,
  GROUP_OVERLAP_THRESHOLD,
  NODE_CARD_SIZE,
  overlapRatio,
} from './nodePlacement.js';
import type { NodeGroup } from '../types.js';

describe('overlapRatio', () => {
  it('is 1 when one rect fully covers the other', () => {
    expect(
      overlapRatio({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 40, height: 40 })
    ).toBe(1);
  });

  it('is 0 when rects only touch at an edge', () => {
    expect(
      overlapRatio({ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 100 })
    ).toBe(0);
  });

  it('reports half when half of the smaller area intersects', () => {
    // 100×100 vs 100×100, shifted by 50 on x → intersection 50×100 = 5000; smaller area 10000 → 0.5
    expect(
      overlapRatio({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 0, width: 100, height: 100 })
    ).toBe(0.5);
  });
});

describe('findGroupDropTarget', () => {
  const positions = {
    a: { x: 0, y: 0 },
    b: { x: 300, y: 0 },
    c: { x: 600, y: 0 },
  };

  it('returns null when overlap is below the threshold', () => {
    // Far from everyone
    expect(
      findGroupDropTarget('a', { x: 1000, y: 1000 }, [], ['a', 'b'], positions)
    ).toBeNull();
  });

  it(`offers create when ≥${GROUP_OVERLAP_THRESHOLD * 100}% overlaps an ungrouped peer`, () => {
    // Drop a almost exactly on b
    const target = findGroupDropTarget(
      'a',
      { x: positions.b.x + 10, y: positions.b.y + 10 },
      [],
      ['a', 'b', 'c'],
      positions
    );
    expect(target).toEqual({ kind: 'create', withNodeId: 'b', ratio: expect.any(Number) });
    expect(target!.ratio).toBeGreaterThanOrEqual(GROUP_OVERLAP_THRESHOLD);
  });

  it('offers join when overlapping a collapsed group chrome', () => {
    const group: NodeGroup = {
      id: 'g-1',
      name: 'Orders',
      nodeIds: ['b', 'c'],
      collapsed: true,
      position: { x: 280, y: 0 },
      skipConfirmOnDrop: false,
    };
    const target = findGroupDropTarget(
      'a',
      { x: group.position.x + 5, y: group.position.y + 5 },
      [group],
      ['a', 'b', 'c'],
      positions
    );
    expect(target).toMatchObject({ kind: 'join', groupId: 'g-1' });
    expect(overlapRatio(
      { x: group.position.x + 5, y: group.position.y + 5, ...NODE_CARD_SIZE },
      { ...group.position, ...collapsedGroupSize(group.nodeIds.length) }
    )).toBeGreaterThanOrEqual(GROUP_OVERLAP_THRESHOLD);
  });

  it('ignores peers already in the same group', () => {
    const group: NodeGroup = {
      id: 'g-1',
      name: 'Orders',
      nodeIds: ['a', 'b'],
      collapsed: false,
      position: { x: 0, y: 0 },
      skipConfirmOnDrop: false,
    };
    // Drop a on b — both already co-members → not a create/join target for that group
    const target = findGroupDropTarget(
      'a',
      { x: positions.b.x + 5, y: positions.b.y + 5 },
      [group],
      ['a', 'b', 'c'],
      positions
    );
    // May still create with c if somehow overlapping, but not with b
    if (target?.kind === 'create') expect(target.withNodeId).not.toBe('b');
    if (target?.kind === 'join') expect(target.groupId).not.toBe('g-1');
  });
});

describe('expandedGroupFrame / memberBounds', () => {
  it('wraps member cards with title/padding', () => {
    const bounds = memberBounds(['a', 'b'], {
      a: { x: 100, y: 100 },
      b: { x: 400, y: 100 },
    });
    expect(bounds).toEqual({
      minX: 100,
      minY: 100,
      maxX: 400 + NODE_CARD_SIZE.width,
      maxY: 100 + NODE_CARD_SIZE.height,
    });
    const frame = expandedGroupFrame(['a', 'b'], {
      a: { x: 100, y: 100 },
      b: { x: 400, y: 100 },
    });
    expect(frame).not.toBeNull();
    expect(frame!.position.x).toBeLessThan(100);
    expect(frame!.position.y).toBeLessThan(100);
    expect(frame!.width).toBeGreaterThan(NODE_CARD_SIZE.width);
  });
});

describe('groupContainingNode', () => {
  it('finds the group that owns a node', () => {
    const groups: NodeGroup[] = [
      {
        id: 'g-1',
        name: 'Orders',
        nodeIds: ['a', 'b'],
        collapsed: false,
        position: { x: 0, y: 0 },
        skipConfirmOnDrop: false,
      },
    ];
    expect(groupContainingNode(groups, 'a')?.id).toBe('g-1');
    expect(groupContainingNode(groups, 'z')).toBeUndefined();
  });
});

describe('sortGroupMemberIds', () => {
  it('orders by canvas reading order (top then left), not input order', () => {
    // Simulate create with [dragged, target] where the later chain step was dragged onto the earlier one.
    expect(
      sortGroupMemberIds(['b', 'a'], {
        a: { x: 0, y: 0 },
        b: { x: 300, y: 0 },
      })
    ).toEqual(['a', 'b']);
  });

  it('uses y before x when members are stacked', () => {
    expect(
      sortGroupMemberIds(['lower', 'upper'], {
        upper: { x: 0, y: 0 },
        lower: { x: 0, y: 200 },
      })
    ).toEqual(['upper', 'lower']);
  });
});

describe('findUngroupedOutsidersInFrame', () => {
  it('flags an ungrouped card swallowed when a member drag grows the frame', () => {
    const group: NodeGroup = {
      id: 'g-1',
      name: 'Orders',
      nodeIds: ['a', 'b'],
      collapsed: false,
      position: { x: 0, y: 0 },
      skipConfirmOnDrop: false,
    };
    // b dragged right toward c — frame now wraps a..b and fully covers c
    const positions = {
      a: { x: 0, y: 0 },
      b: { x: 280, y: 0 },
      c: { x: 300, y: 0 },
    };
    const hits = findUngroupedOutsidersInFrame(group, ['a', 'b', 'c'], positions, [group]);
    expect(hits.map((h) => h.nodeId)).toEqual(['c']);
    expect(hits[0].ratio).toBeGreaterThanOrEqual(GROUP_OVERLAP_THRESHOLD);
  });

  it('ignores collapsed groups and nodes already in another group', () => {
    const g1: NodeGroup = {
      id: 'g-1',
      name: 'A',
      nodeIds: ['a', 'b'],
      collapsed: true,
      position: { x: 0, y: 0 },
      skipConfirmOnDrop: false,
    };
    expect(findUngroupedOutsidersInFrame(g1, ['a', 'b', 'c'], { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, c: { x: 10, y: 10 } }, [g1])).toEqual([]);
  });
});

describe('nudgeOutsideFrame', () => {
  it('moves a fully-inside card clear of the frame', () => {
    const frame = { position: { x: 0, y: 0 }, width: 500, height: 200 };
    const nudged = nudgeOutsideFrame({ x: 100, y: 50 }, frame);
    const stillInside =
      overlapRatio(
        { ...nudged, ...NODE_CARD_SIZE },
        { ...frame.position, width: frame.width, height: frame.height }
      ) >= GROUP_OVERLAP_THRESHOLD;
    expect(stillInside).toBe(false);
  });
});
