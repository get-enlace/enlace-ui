import type { GroupDropTarget } from '../../utils/groupGeometry.js';

export type PendingGroup =
  | { kind: 'create'; draggedNodeId: string; position: { x: number; y: number }; withNodeId: string }
  | { kind: 'join'; draggedNodeId: string; position: { x: number; y: number }; groupId: string };

export function suggestGroupName(peerLabel: string): string {
  const cleaned = peerLabel.replace(/\s*#\d+$/, '').trim();
  if (!cleaned) return 'Group';
  return cleaned;
}

/** Narrow GroupDropTarget into a PendingGroup prompt payload. */
export function pendingFromDropTarget(
  draggedNodeId: string,
  position: { x: number; y: number },
  target: GroupDropTarget
): PendingGroup {
  if (target.kind === 'join') {
    return { kind: 'join', draggedNodeId, position, groupId: target.groupId };
  }
  return { kind: 'create', draggedNodeId, position, withNodeId: target.withNodeId };
}
