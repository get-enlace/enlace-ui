import { useState } from 'react';
import { Handle, Position, useStore, type NodeProps } from 'reactflow';
import { formatPresetLabel } from '@get-enlace/core';
import { useWorkflowStore } from '../../store/workflowStore.js';
import { DEFAULT_WAIT_DURATION_MS } from '../../store/slices/graphSlice.js';
import type { PresetsNode, RunStepStatus } from '../../types.js';
import { DeleteNodeIcon, LeaveGroupIcon, STATUS_BADGE_GLYPH } from '../chromeIcons.js';

/** Every `text/preset-kind` value the palette (OperationList.tsx) can drag — the only thing this card's own drop zone ever accepts. */
const KNOWN_PRESET_KINDS = new Set(['wait', 'assert']);

export interface PresetsNodeData {
  /** Carries the ordered `presets` this card renders. */
  node: PresetsNode;
  /** View-only chrome from the store's `presetsCollapsed` map — see WorkflowState's own comment. */
  collapsed: boolean;
  selected: boolean;
  /** Same source/meaning as WorkflowNodeCard's own `status` — the collection's own aggregate run status. */
  status?: RunStepStatus;
  groupId?: string;
  groupName?: string;
}

/**
 * The presets-collection kind (see ARCHITECTURE.md's "Preset nodes"
 * section) — a distinct visual model from `WorkflowNodeCard`/`GroupNodeCard`,
 * not a reuse of either: **collapsed** is a small diamond (chevron + preset
 * count + short summary); **expanded** is a box listing each preset in
 * order, reorderable by adjacent up/down swap only (never arbitrary drag),
 * with its own vertical connector lines between rows — plain chrome, not
 * real `WorkflowConnection`s/Handles, since presets never participate in the
 * main graph individually (see `Preset`'s own comment in `@get-enlace/core`).
 * Outside the collection it's a normal graph node: real target/source
 * `Handle`s, connections, and breakpoints work exactly as they do for any
 * other node. This is the *only* card a preset dropped from the palette ever
 * renders as — even a single preset gets this collection chrome, never
 * `WorkflowNodeCard`'s (see Canvas.tsx's `onDrop`).
 *
 * A preset row here is a *summary* only (icon + `formatPresetLabel`) —
 * every kind renders the same shape, so the card stays a fixed width
 * regardless of which presets it holds. The actual editor (Wait's
 * duration, Assert's checks) lives in NodeConfig.tsx, keyed by the store's
 * `selectedPresetId`; clicking a row here is just `selectPreset`.
 */
export function PresetsNodeCard({ data }: NodeProps<PresetsNodeData>) {
  const { node, collapsed, selected, status, groupId, groupName } = data;
  const presets = node.presets ?? [];
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const removeFromGroup = useWorkflowStore((s) => s.removeFromGroup);
  const setPresetsCollapsed = useWorkflowStore((s) => s.setPresetsCollapsed);
  const addPreset = useWorkflowStore((s) => s.addPreset);
  const removePreset = useWorkflowStore((s) => s.removePreset);
  const movePreset = useWorkflowStore((s) => s.movePreset);
  const selectedPresetId = useWorkflowStore((s) => s.selectedPresetId);
  const selectPreset = useWorkflowStore((s) => s.selectPreset);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  // Same reasoning as WorkflowNodeCard's own elementsSelectable read — this
  // card's buttons are plain DOM, not React Flow machinery, so the canvas
  // lock toggle needs to be checked explicitly rather than relying on RF's
  // native drag/select blocking to cover them too.
  const elementsSelectable = useStore((s) => s.elementsSelectable);
  const chromeDisabled = isRunning || !elementsSelectable;
  const badgeGlyph = status && STATUS_BADGE_GLYPH[status];
  const lockTitle = isRunning
    ? "Can't edit a collection while the workflow is running"
    : !elementsSelectable
      ? 'Canvas is locked — unlock it to edit collections'
      : undefined;

  const targetHandle = <Handle type="target" position={Position.Left} title="Drop here to connect" />;
  const sourceHandle = <Handle type="source" position={Position.Right} title="Drag to connect" />;

  // Drag a preset icon straight from the palette (OperationList.tsx) onto
  // this card to append it — the only way to add a preset to an *existing*
  // collection now (see the "+ Add Wait"/"+ Add Assert" buttons this
  // replaced: they don't scale past a couple of preset kinds). Deliberately
  // wired here, not on WorkflowNodeCard — dropping a preset "into" an
  // operation node isn't a thing; Canvas.tsx's own onDrop still handles a
  // preset dropped on empty canvas (or, today, over an unrelated node) by
  // creating a new collection there, same as always. `dataTransfer.getData`
  // is unreadable during dragover/dragenter in most browsers (security
  // restriction) — only `.types` is, so that's what gates the hover state;
  // the real kind is only read (and acted on) at the actual drop.
  const [isDragOver, setIsDragOver] = useState(false);
  const isPresetDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('text/preset-kind');
  const dropZoneProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isPresetDrag(e)) return;
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isPresetDrag(e)) return;
      e.preventDefault(); // required for onDrop to fire at all
    },
    onDragLeave: () => setIsDragOver(false),
    onDrop: (e: React.DragEvent) => {
      setIsDragOver(false);
      const presetKind = e.dataTransfer.getData('text/preset-kind');
      if (!KNOWN_PRESET_KINDS.has(presetKind)) return; // not a preset drag — let Canvas.tsx's own onDrop handle it
      e.preventDefault();
      e.stopPropagation(); // don't also let Canvas.tsx create a second, brand-new collection at this position
      if (chromeDisabled) return;
      addPreset(
        node.id,
        presetKind === 'wait' ? { kind: 'wait', durationMs: DEFAULT_WAIT_DURATION_MS } : { kind: 'assert', checks: [] }
      );
    },
  };

  if (collapsed) {
    // Hover-only detail — the visible chrome deliberately stays to "Presets"
    // + count (see the expanded titlebar's own comment); a per-preset
    // summary here would just repeat what expanding the card already shows.
    const summary = presets.length > 0 ? presets.map(formatPresetLabel).join(' · ') : 'Empty';
    return (
      <div className="workflow-node-shell">
        <div
          className={`presets-node presets-node--collapsed${selected ? ' presets-node--selected' : ''}${status ? ` presets-node--${status}` : ''}${isDragOver ? ' presets-node--drag-over' : ''}`}
          title={chromeDisabled ? undefined : 'Click to expand'}
          {...dropZoneProps}
        >
          {targetHandle}
          {badgeGlyph && (
            <span className={`presets-node__status-badge presets-node__status-badge--${status}`} aria-hidden="true">
              {badgeGlyph}
            </span>
          )}
          <div className="presets-node__diamond" aria-hidden="true" />
          <div className="presets-node__collapsed-body">
            <button
              type="button"
              className="nodrag nopan presets-node__chevron"
              disabled={chromeDisabled}
              title={lockTitle ?? 'Expand collection'}
              aria-label="Expand collection"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPresetsCollapsed(node.id, false);
              }}
            >
              ›
            </button>
            <span className="presets-node__step-count">{presets.length}</span>
            <span className="presets-node__summary" title={summary}>
              Presets
            </span>
          </div>
          {sourceHandle}
        </div>
        <button
          type="button"
          className="nodrag nopan workflow-node__remove-btn"
          disabled={chromeDisabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removeNode(node.id);
          }}
          title={lockTitle ?? 'Remove this collection'}
          aria-label="Remove this collection"
        >
          <DeleteNodeIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="workflow-node-shell">
      <div
        className={`presets-node presets-node--expanded${selected ? ' presets-node--selected' : ''}${status ? ` presets-node--${status}` : ''}${groupId ? ' presets-node--grouped' : ''}${isDragOver ? ' presets-node--drag-over' : ''}`}
        {...dropZoneProps}
      >
        {targetHandle}
        {badgeGlyph && (
          <span className={`presets-node__status-badge presets-node__status-badge--${status}`} aria-hidden="true">
            {badgeGlyph}
          </span>
        )}
        <div className="presets-node__titlebar">
          <button
            type="button"
            className="nodrag nopan presets-node__chevron"
            disabled={chromeDisabled}
            title={lockTitle ?? 'Collapse collection'}
            aria-label="Collapse collection"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setPresetsCollapsed(node.id, true);
            }}
          >
            ⌄
          </button>
          {/* Deliberately just "Presets" — the expanded list right below already
              shows every preset, so echoing their summary in the title would
              only repeat it (and keep growing unreadably as presets are added). */}
          <span className="presets-node__title">Presets</span>
          <span className="presets-node__step-count">{presets.length}</span>
        </div>
        {status === 'paused' && <div className="workflow-node__paused-label">⏸ Paused here</div>}
        {presets.length === 0 ? (
          <p className="presets-node__empty-hint">Drag a preset here to add it.</p>
        ) : (
          <ul className="nodrag nopan presets-node__steps">
            {presets.map((preset, index) => (
              <li
                key={preset.id}
                className={`presets-node__step${selectedPresetId === preset.id ? ' presets-node__step--selected' : ''}`}
              >
                <span className="presets-node__step-connector" aria-hidden="true" />
                {/* Every button in this row needs its click stopped from
                    bubbling to Canvas.tsx's ReactFlow onNodeClick — that
                    handler calls selectNode(node.id) on *any* click inside
                    the card, and selectNode always resets selectedPresetId
                    to null (see WorkflowState's own comment on it). Without
                    this, selectPreset's own state update would win the
                    click, then get immediately clobbered by the bubbled
                    onNodeClick right after — a preset was only ever
                    configurable once, right when addPreset auto-selected it
                    (that path sets the store directly, no click involved). */}
                <button
                  type="button"
                  className="nodrag nopan presets-node__step-select"
                  disabled={chromeDisabled}
                  aria-pressed={selectedPresetId === preset.id}
                  title={chromeDisabled ? undefined : 'Configure this preset'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectPreset(node.id, preset.id);
                  }}
                >
                  <span
                    className={`presets-node__step-icon${preset.kind === 'assert' ? ' presets-node__step-icon--assert' : ' presets-node__step-icon--wait'}`}
                    aria-hidden="true"
                  >
                    {preset.kind === 'wait' ? '⏱' : '✓'}
                  </span>
                  <span className="presets-node__step-label">{formatPresetLabel(preset)}</span>
                </button>
                <button
                  type="button"
                  className="presets-node__step-move"
                  disabled={chromeDisabled || index === 0}
                  aria-label={`Move preset ${index + 1} up`}
                  title="Move up"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    movePreset(node.id, preset.id, 'up');
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="presets-node__step-move"
                  disabled={chromeDisabled || index === presets.length - 1}
                  aria-label={`Move preset ${index + 1} down`}
                  title="Move down"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    movePreset(node.id, preset.id, 'down');
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="presets-node__step-remove"
                  disabled={chromeDisabled}
                  aria-label={`Remove preset ${index + 1}`}
                  title="Remove preset"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    removePreset(node.id, preset.id);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {sourceHandle}
      </div>
      {groupId && (
        <button
          type="button"
          className="nodrag nopan workflow-node__leave-group-btn"
          disabled={chromeDisabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removeFromGroup(groupId, node.id);
          }}
          title={lockTitle ?? `Remove from group${groupName ? ` "${groupName}"` : ''} — keeps the node on the canvas`}
          aria-label="Remove from group"
        >
          <LeaveGroupIcon />
        </button>
      )}
      <button
        type="button"
        className="nodrag nopan workflow-node__remove-btn"
        disabled={chromeDisabled}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          removeNode(node.id);
        }}
        title={lockTitle ?? 'Remove this collection'}
        aria-label="Remove this collection"
      >
        <DeleteNodeIcon />
      </button>
    </div>
  );
}
