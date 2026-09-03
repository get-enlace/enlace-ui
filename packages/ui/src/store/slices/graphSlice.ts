import type { StateCreator } from 'zustand';
import { connectionKey } from '@get-enlace/core';
import { findOpenPosition } from '../../utils/nodePlacement.js';
import { expandedGroupFrame, sortGroupMemberIds } from '../../utils/groupGeometry.js';
import { randomId } from '../../utils/randomId.js';
import type { FieldValue, NodeGroup, RawBody, WorkflowConnection, WorkflowNode } from '../../types.js';
import {
  defaultPosition,
  isLocked,
  uploadedFileKey,
  type Position,
  type WorkflowState,
} from '../types.js';

export interface GraphSlice {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  nodePositions: Record<string, Position>;
  groups: NodeGroup[];
  selectedNodeId: string | null;
  uploadedFiles: Record<string, File>;
  addNode: (operationId: string, position?: Position) => string;
  addWaitNode: (position?: Position, durationMs?: number) => string;
  setNodeDurationMs: (nodeId: string, durationMs: number) => void;
  updateNodePosition: (nodeId: string, position: Position, options?: { avoidOverlap?: boolean }) => void;
  removeNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  setCredential: (nodeId: string, credentialId: string | null) => void;
  setFieldValue: (nodeId: string, fieldPath: string, value: FieldValue) => void;
  mergeFieldValues: (nodeId: string, values: Record<string, FieldValue>) => void;
  setCredentialExtraParamOverride: (nodeId: string, key: string, value: FieldValue | null) => void;
  setCredentialExtraParamOverridesEnabled: (nodeId: string, enabled: boolean) => void;
  setUploadedFile: (nodeId: string, fieldPath: string, file: File | null) => void;
  setRequestMode: (nodeId: string, mode: 'form' | 'raw') => void;
  setRawPath: (nodeId: string, rawPath: RawBody | null) => void;
  setRawQuery: (nodeId: string, rawQuery: RawBody | null) => void;
  setRawBody: (nodeId: string, rawBody: RawBody | null) => void;
  connectNodes: (fromNodeId: string, toNodeId: string) => void;
  disconnectNodes: (fromNodeId: string, toNodeId: string) => void;
  createGroup: (opts: {
    name: string;
    nodeIds: [string, string];
    draggedNodeId: string;
    draggedPosition: Position;
    skipConfirmOnDrop?: boolean;
  }) => string;
  joinGroup: (groupId: string, nodeId: string, position: Position, opts?: { skipConfirmOnDrop?: boolean }) => void;
  ungroup: (groupId: string) => void;
  removeFromGroup: (groupId: string, nodeId: string) => void;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  setGroupName: (groupId: string, name: string) => void;
  moveGroup: (groupId: string, position: Position) => void;
}

/** Default duration for a freshly-dropped Wait preset — 1s is long enough to be a deliberate pause without being annoying to test with, and short enough to trim on the spot. */
const DEFAULT_WAIT_DURATION_MS = 1000;

export const createGraphSlice: StateCreator<WorkflowState, [], [], GraphSlice> = (set, get) => ({
  nodes: [],
  connections: [],
  nodePositions: {},
  groups: [],
  selectedNodeId: null,
  uploadedFiles: {},

  addNode: (operationId, position) => {
    if (isLocked(get())) return '';
    const id = randomId();
    const node: WorkflowNode = { id, operationId, credentialId: null, fieldValues: {} };
    set((state) => {
      const desired = position ?? defaultPosition(state.nodes.length);
      const obstacles = Object.values(state.nodePositions);
      return {
        nodes: [...state.nodes, node],
        nodePositions: { ...state.nodePositions, [id]: findOpenPosition(desired, obstacles) },
        selectedNodeId: id,
      };
    });
    return id;
  },

  addWaitNode: (position, durationMs) => {
    if (isLocked(get())) return '';
    const id = randomId();
    const node: WorkflowNode = {
      id,
      kind: 'wait',
      credentialId: null,
      fieldValues: {},
      durationMs: durationMs ?? DEFAULT_WAIT_DURATION_MS,
    };
    set((state) => {
      const desired = position ?? defaultPosition(state.nodes.length);
      const obstacles = Object.values(state.nodePositions);
      return {
        nodes: [...state.nodes, node],
        nodePositions: { ...state.nodePositions, [id]: findOpenPosition(desired, obstacles) },
        selectedNodeId: id,
      };
    });
    return id;
  },

  setNodeDurationMs: (nodeId, durationMs) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, durationMs } : n)) };
    }),

  updateNodePosition: (nodeId, position, options) =>
    set((state) => {
      let next = position;
      if (options?.avoidOverlap === true) {
        const ownGroup = state.groups.find((g) => g.nodeIds.includes(nodeId));
        const skip = new Set<string>([nodeId, ...(ownGroup?.nodeIds ?? [])]);
        const obstacles = Object.entries(state.nodePositions)
          .filter(([id]) => !skip.has(id))
          .map(([, pos]) => pos);
        next = findOpenPosition(position, obstacles);
      }
      return { nodePositions: { ...state.nodePositions, [nodeId]: next } };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const nodePositions = { ...state.nodePositions };
      delete nodePositions[nodeId];

      const uploadedFiles = { ...state.uploadedFiles };
      const prefix = `${nodeId}::`;
      for (const key of Object.keys(uploadedFiles)) {
        if (key.startsWith(prefix)) delete uploadedFiles[key];
      }

      const nodes = state.nodes
        .filter((n) => n.id !== nodeId)
        .map((n) => {
          const fieldValues = { ...n.fieldValues };
          let changed = false;
          for (const [path, fv] of Object.entries(fieldValues)) {
            if (fv.source === 'mapped' && fv.fromNodeId === nodeId) {
              fieldValues[path] = { source: 'static', value: '' };
              changed = true;
            }
          }

          // Same dangling-reference cleanup as fieldValues above, but a
          // mapped override has no "static" fallback that makes sense here
          // (there's no value to fall back to but the credential's own,
          // which just means dropping the override entirely) — see
          // credentialExtraParamOverrides's own comment on WorkflowNode.
          let credentialExtraParamOverrides = n.credentialExtraParamOverrides;
          if (credentialExtraParamOverrides) {
            const next = { ...credentialExtraParamOverrides };
            let overridesChanged = false;
            for (const [key, fv] of Object.entries(next)) {
              if (fv.source === 'mapped' && fv.fromNodeId === nodeId) {
                delete next[key];
                overridesChanged = true;
              }
            }
            if (overridesChanged) {
              credentialExtraParamOverrides = next;
              changed = true;
            }
          }

          return changed ? { ...n, fieldValues, credentialExtraParamOverrides } : n;
        });

      // Drop the node from any group; dissolve groups left with < 2 members.
      const groups = state.groups
        .map((g) => (g.nodeIds.includes(nodeId) ? { ...g, nodeIds: g.nodeIds.filter((id) => id !== nodeId) } : g))
        .filter((g) => g.nodeIds.length >= 2);

      return {
        nodes,
        nodePositions,
        uploadedFiles,
        groups,
        connections: state.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setCredential: (nodeId, credentialId) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, credentialId } : n)) };
    }),

  setFieldValue: (nodeId, fieldPath, value) =>
    set((state) => {
      if (isLocked(state)) return state;
      const uploadedFiles = { ...state.uploadedFiles };
      const key = uploadedFileKey(nodeId, fieldPath);
      if (value.source !== 'file') delete uploadedFiles[key];
      return {
        uploadedFiles,
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, fieldValues: { ...n.fieldValues, [fieldPath]: value } } : n
        ),
      };
    }),

  mergeFieldValues: (nodeId, values) =>
    set((state) => {
      if (isLocked(state)) return state;
      const uploadedFiles = { ...state.uploadedFiles };
      for (const [fieldPath, value] of Object.entries(values)) {
        if (value.source !== 'file') delete uploadedFiles[uploadedFileKey(nodeId, fieldPath)];
      }
      return {
        uploadedFiles,
        nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, fieldValues: { ...n.fieldValues, ...values } } : n)),
      };
    }),

  // `null` clears the override (falls back to the credential's own
  // extraTokenParams value); a FieldValue sets/replaces it. See
  // WorkflowNode.credentialExtraParamOverrides's own comment in types.ts
  // for why this lives per-node rather than on the shared Credential.
  setCredentialExtraParamOverride: (nodeId, key, value) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const credentialExtraParamOverrides = { ...n.credentialExtraParamOverrides };
          if (value) credentialExtraParamOverrides[key] = value;
          else delete credentialExtraParamOverrides[key];
          return { ...n, credentialExtraParamOverrides };
        }),
      };
    }),

  // Deliberately leaves credentialExtraParamOverrides untouched either way —
  // this is a visibility/activation switch, not a delete action (see
  // WorkflowNode.credentialExtraParamOverridesEnabled's own comment).
  setCredentialExtraParamOverridesEnabled: (nodeId, enabled) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, credentialExtraParamOverridesEnabled: enabled } : n
        ),
      };
    }),

  setUploadedFile: (nodeId, fieldPath, file) =>
    set((state) => {
      if (isLocked(state)) return state;
      const key = uploadedFileKey(nodeId, fieldPath);
      const uploadedFiles = { ...state.uploadedFiles };
      if (file) uploadedFiles[key] = file;
      else delete uploadedFiles[key];

      return {
        uploadedFiles,
        nodes: state.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const fieldValues = { ...n.fieldValues };
          if (file) fieldValues[fieldPath] = { source: 'file', fileName: file.name };
          else delete fieldValues[fieldPath];
          return { ...n, fieldValues };
        }),
      };
    }),

  setRequestMode: (nodeId, mode) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, requestMode: mode } : n)) };
    }),

  setRawPath: (nodeId, rawPath) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, rawPath } : n)) };
    }),

  setRawQuery: (nodeId, rawQuery) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, rawQuery } : n)) };
    }),

  setRawBody: (nodeId, rawBody) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, rawBody } : n)) };
    }),

  connectNodes: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      if (fromNodeId === toNodeId) return state; // no self-loops
      const exists = state.connections.some((c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId);
      if (exists) return state;
      return { connections: [...state.connections, { fromNodeId, toNodeId }] };
    }),

  disconnectNodes: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const armedBreakpoints = new Set(state.armedBreakpoints);
      armedBreakpoints.delete(connectionKey(fromNodeId, toNodeId));
      return {
        connections: state.connections.filter((c) => !(c.fromNodeId === fromNodeId && c.toNodeId === toNodeId)),
        armedBreakpoints,
      };
    }),

  createGroup: ({ name, nodeIds, draggedNodeId, draggedPosition, skipConfirmOnDrop }) => {
    if (isLocked(get())) return '';
    const id = `g-${randomId()}`;
    set((state) => {
      let groups = state.groups
        .map((g) => ({
          ...g,
          nodeIds: g.nodeIds.filter((nid) => !nodeIds.includes(nid)),
        }))
        .filter((g) => g.nodeIds.length >= 2);

      const nodePositions = {
        ...state.nodePositions,
        [draggedNodeId]: draggedPosition,
      };
      const frame = expandedGroupFrame(nodeIds, nodePositions);
      const group: NodeGroup = {
        id,
        name: name.trim() || 'Group',
        nodeIds: sortGroupMemberIds(nodeIds, nodePositions),
        collapsed: false,
        position: frame?.position ?? draggedPosition,
        skipConfirmOnDrop: skipConfirmOnDrop ?? false,
      };
      groups = [...groups, group];
      return { groups, nodePositions };
    });
    return id;
  },

  joinGroup: (groupId, nodeId, position, opts) =>
    set((state) => {
      if (isLocked(state)) return state;
      const target = state.groups.find((g) => g.id === groupId);
      if (!target || target.nodeIds.includes(nodeId)) return state;

      let groups = state.groups
        .map((g) =>
          g.id === groupId ? g : { ...g, nodeIds: g.nodeIds.filter((id) => id !== nodeId) }
        )
        .filter((g) => g.id === groupId || g.nodeIds.length >= 2);

      const memberObstacles = Object.entries(state.nodePositions)
        .filter(([id]) => id !== nodeId && !target.nodeIds.includes(id))
        .map(([, pos]) => pos);
      // Keep the drop position relative to groupmates (may stay tight/overlapping);
      // only nudge clear of nodes *outside* this group.
      const settled = findOpenPosition(position, memberObstacles);
      const nodePositions = { ...state.nodePositions, [nodeId]: settled };

      groups = groups.map((g) => {
        if (g.id !== groupId) return g;
        const nodeIds = sortGroupMemberIds([...g.nodeIds, nodeId], nodePositions);
        const frame = expandedGroupFrame(nodeIds, nodePositions);
        return {
          ...g,
          nodeIds,
          position: frame?.position ?? g.position,
          skipConfirmOnDrop: opts?.skipConfirmOnDrop ?? g.skipConfirmOnDrop,
        };
      });

      return { groups, nodePositions };
    }),

  ungroup: (groupId) =>
    set((state) => {
      if (isLocked(state)) return state;
      return { groups: state.groups.filter((g) => g.id !== groupId) };
    }),

  removeFromGroup: (groupId, nodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const group = state.groups.find((g) => g.id === groupId);
      if (!group || !group.nodeIds.includes(nodeId)) return state;

      const remainingIds = group.nodeIds.filter((id) => id !== nodeId);
      const groups = state.groups
        .map((g) => (g.id === groupId ? { ...g, nodeIds: remainingIds } : g))
        .filter((g) => g.nodeIds.length >= 2);

      // If the released card still overlaps a former groupmate, nudge it
      // clear so the expanded frame no longer wraps it and the next
      // drag-end doesn't immediately re-offer "join this group".
      const nodePositions = { ...state.nodePositions };
      const pos = nodePositions[nodeId];
      if (pos && remainingIds.length > 0) {
        const obstacles = Object.entries(nodePositions)
          .filter(([id]) => id !== nodeId)
          .map(([, p]) => p);
        nodePositions[nodeId] = findOpenPosition(pos, obstacles);
      }

      // Re-anchor remaining group's chrome if it survived.
      const nextGroups = groups.map((g) => {
        if (g.id !== groupId) return g;
        const frame = expandedGroupFrame(g.nodeIds, nodePositions);
        return { ...g, position: frame?.position ?? g.position };
      });

      return { groups: nextGroups, nodePositions };
    }),

  setGroupCollapsed: (groupId, collapsed) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        groups: state.groups.map((g) => {
          if (g.id !== groupId) return g;
          const frame = expandedGroupFrame(g.nodeIds, state.nodePositions);
          return { ...g, collapsed, position: frame?.position ?? g.position };
        }),
      };
    }),

  setGroupName: (groupId, name) =>
    set((state) => {
      if (isLocked(state)) return state;
      return {
        groups: state.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || 'Group' } : g)),
      };
    }),

  moveGroup: (groupId, position) =>
    set((state) => {
      const group = state.groups.find((g) => g.id === groupId);
      if (!group) return state;
      // Expanded chrome is derived from member bounds each render — delta
      // against that frame origin, not a possibly-stale stored position.
      const frame = group.collapsed ? null : expandedGroupFrame(group.nodeIds, state.nodePositions);
      const origin = group.collapsed ? group.position : (frame?.position ?? group.position);
      const dx = position.x - origin.x;
      const dy = position.y - origin.y;
      if (dx === 0 && dy === 0) return state;
      const nodePositions = { ...state.nodePositions };
      for (const nid of group.nodeIds) {
        const pos = nodePositions[nid];
        if (pos) nodePositions[nid] = { x: pos.x + dx, y: pos.y + dy };
      }
      return {
        nodePositions,
        groups: state.groups.map((g) => (g.id === groupId ? { ...g, position } : g)),
      };
    }),
});
