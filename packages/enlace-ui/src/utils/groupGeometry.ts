import type { NodeGroup } from '../types.js';
import {
  collapsedGroupSize,
  GROUP_FRAME_PAD,
  GROUP_OVERLAP_THRESHOLD,
  GROUP_TITLE_HEIGHT,
  NODE_CARD_GAP,
  NODE_CARD_SIZE,
  overlapRatio,
  type NodeRect,
  type Position,
} from './nodePlacement.js';

export type GroupDropTarget =
  | { kind: 'create'; withNodeId: string; ratio: number }
  | { kind: 'join'; groupId: string; ratio: number };

function cardRect(position: Position): NodeRect {
  return { ...position, ...NODE_CARD_SIZE };
}

function collapsedGroupRect(group: NodeGroup): NodeRect {
  return { ...group.position, ...collapsedGroupSize(group.nodeIds.length) };
}

/** Bounding box of member cards (absolute canvas coords). */
export function memberBounds(
  nodeIds: string[],
  positions: Record<string, Position>
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const id of nodeIds) {
    const pos = positions[id];
    if (!pos) continue;
    any = true;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + NODE_CARD_SIZE.width);
    maxY = Math.max(maxY, pos.y + NODE_CARD_SIZE.height);
  }
  if (!any) return null;
  return { minX, minY, maxX, maxY };
}

/** Expanded frame origin + size wrapping the given members. */
export function expandedGroupFrame(
  nodeIds: string[],
  positions: Record<string, Position>
): { position: Position; width: number; height: number } | null {
  const bounds = memberBounds(nodeIds, positions);
  if (!bounds) return null;
  return {
    position: {
      x: bounds.minX - GROUP_FRAME_PAD,
      y: bounds.minY - GROUP_TITLE_HEIGHT - GROUP_FRAME_PAD,
    },
    width: bounds.maxX - bounds.minX + GROUP_FRAME_PAD * 2,
    height: bounds.maxY - bounds.minY + GROUP_TITLE_HEIGHT + GROUP_FRAME_PAD * 2,
  };
}

export function groupContainingNode(groups: NodeGroup[], nodeId: string): NodeGroup | undefined {
  return groups.find((g) => g.nodeIds.includes(nodeId));
}

/**
 * Reading order for collapsed member rows — top-to-bottom, then left-to-right —
 * so the list matches the expanded canvas layout, not drag/create order
 * (`[dragged, target]` would put the dropped card first).
 */
export function sortGroupMemberIds(
  nodeIds: string[],
  positions: Record<string, Position>
): string[] {
  return [...nodeIds].sort((a, b) => {
    const pa = positions[a];
    const pb = positions[b];
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    if (pa.y !== pb.y) return pa.y - pb.y;
    if (pa.x !== pb.x) return pa.x - pb.x;
    return a.localeCompare(b);
  });
}

/**
 * Ungrouped cards whose footprint sits mostly inside an *expanded* group's
 * frame. Happens when a member is dragged toward an outsider and the live
 * frame grows around them — UI looks grouped, but `nodeIds` never changed.
 */
export function findUngroupedOutsidersInFrame(
  group: NodeGroup,
  allNodeIds: string[],
  positions: Record<string, Position>,
  groups: NodeGroup[]
): { nodeId: string; ratio: number }[] {
  if (group.collapsed) return [];
  const frame = expandedGroupFrame(group.nodeIds, positions);
  if (!frame) return [];
  const frameRect: NodeRect = { ...frame.position, width: frame.width, height: frame.height };
  const members = new Set(group.nodeIds);
  const hits: { nodeId: string; ratio: number }[] = [];

  for (const id of allNodeIds) {
    if (members.has(id)) continue;
    if (groupContainingNode(groups, id)) continue;
    const pos = positions[id];
    if (!pos) continue;
    const ratio = overlapRatio(cardRect(pos), frameRect);
    if (ratio >= GROUP_OVERLAP_THRESHOLD) hits.push({ nodeId: id, ratio });
  }

  hits.sort((a, b) => b.ratio - a.ratio);
  return hits;
}

/** Push a card just clear of an expanded frame (nearest edge + gap). */
export function nudgeOutsideFrame(
  position: Position,
  frame: { position: Position; width: number; height: number }
): Position {
  const f = frame.position;
  const gap = NODE_CARD_GAP;
  const card = cardRect(position);
  const frameRect: NodeRect = { ...f, width: frame.width, height: frame.height };
  if (overlapRatio(card, frameRect) < GROUP_OVERLAP_THRESHOLD) return position;

  const cx = position.x + NODE_CARD_SIZE.width / 2;
  const cy = position.y + NODE_CARD_SIZE.height / 2;
  const distLeft = cx - f.x;
  const distRight = f.x + frame.width - cx;
  const distTop = cy - f.y;
  const distBottom = f.y + frame.height - cy;
  const min = Math.min(distLeft, distRight, distTop, distBottom);

  if (min === distRight) return { x: f.x + frame.width + gap, y: position.y };
  if (min === distLeft) return { x: f.x - NODE_CARD_SIZE.width - gap, y: position.y };
  if (min === distBottom) return { x: position.x, y: f.y + frame.height + gap };
  return { x: position.x, y: f.y - NODE_CARD_SIZE.height - gap };
}

/**
 * Best drop-to-group target for a card just released at `position`.
 * Prefers the highest overlap ≥ {@link GROUP_OVERLAP_THRESHOLD}.
 * Collapsed group chrome and peer cards are both candidates; a node already
 * in the same group is ignored (reordering inside a group is not a join).
 */
export function findGroupDropTarget(
  draggedNodeId: string,
  position: Position,
  groups: NodeGroup[],
  allNodeIds: string[],
  positions: Record<string, Position>
): GroupDropTarget | null {
  const dragged = cardRect(position);
  const ownGroup = groupContainingNode(groups, draggedNodeId);
  let best: GroupDropTarget | null = null;

  const consider = (candidate: GroupDropTarget) => {
    if (candidate.ratio < GROUP_OVERLAP_THRESHOLD) return;
    if (!best || candidate.ratio > best.ratio) best = candidate;
  };

  for (const group of groups) {
    if (ownGroup?.id === group.id) continue;

    if (group.collapsed) {
      consider({
        kind: 'join',
        groupId: group.id,
        ratio: overlapRatio(dragged, collapsedGroupRect(group)),
      });
      continue;
    }

    // Expanded: overlap any member (or the frame itself).
    const frame = expandedGroupFrame(group.nodeIds, positions);
    if (frame) {
      consider({
        kind: 'join',
        groupId: group.id,
        ratio: overlapRatio(dragged, { ...frame.position, width: frame.width, height: frame.height }),
      });
    }
    for (const memberId of group.nodeIds) {
      const pos = positions[memberId];
      if (!pos) continue;
      consider({
        kind: 'join',
        groupId: group.id,
        ratio: overlapRatio(dragged, cardRect(pos)),
      });
    }
  }

  for (const nodeId of allNodeIds) {
    if (nodeId === draggedNodeId) continue;
    if (groupContainingNode(groups, nodeId)) continue; // covered via join above
    const pos = positions[nodeId];
    if (!pos) continue;
    consider({
      kind: 'create',
      withNodeId: nodeId,
      ratio: overlapRatio(dragged, cardRect(pos)),
    });
  }

  return best;
}
