import { Handle, Position, useStore, type NodeProps } from 'reactflow';
import { formatPresetLabel, formatWaitDuration } from '@get-enlace/core';
import { useWorkflowStore } from '../../store/workflowStore.js';
import type { RunStepStatus, WorkflowNode } from '../../types.js';
import { DeleteNodeIcon, LeaveGroupIcon, STATUS_BADGE_GLYPH } from '../chromeIcons.js';

export interface PresetsNodeData {
  /** `kind: 'presets'` — carries the ordered `presets` this card renders. */
  node: WorkflowNode;
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
  const setPresetDurationMs = useWorkflowStore((s) => s.setPresetDurationMs);
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

  if (collapsed) {
    // Hover-only detail — the visible chrome deliberately stays to "Presets"
    // + count (see the expanded titlebar's own comment); a per-preset
    // summary here would just repeat what expanding the card already shows.
    const summary = presets.length > 0 ? presets.map(formatPresetLabel).join(' · ') : 'Empty';
    return (
      <div className="workflow-node-shell">
        <div
          className={`presets-node presets-node--collapsed${selected ? ' presets-node--selected' : ''}${status ? ` presets-node--${status}` : ''}`}
          title={chromeDisabled ? undefined : 'Click to expand'}
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
              onClick={() => setPresetsCollapsed(node.id, false)}
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
        className={`presets-node presets-node--expanded${selected ? ' presets-node--selected' : ''}${status ? ` presets-node--${status}` : ''}${groupId ? ' presets-node--grouped' : ''}`}
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
            onClick={() => setPresetsCollapsed(node.id, true)}
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
          <p className="presets-node__empty-hint">No presets yet — add one below.</p>
        ) : (
          <ul className="nodrag nopan presets-node__steps">
            {presets.map((preset, index) => (
              <li key={preset.id} className="presets-node__step">
                <span className="presets-node__step-connector" aria-hidden="true" />
                <span className="wait-node__icon" aria-hidden="true">
                  ⏱
                </span>
                <span className="presets-node__step-label">Wait</span>
                <input
                  type="number"
                  className="presets-node__step-duration"
                  min={0}
                  step={0.1}
                  disabled={chromeDisabled}
                  aria-label={`Preset ${index + 1} duration in seconds`}
                  title={formatWaitDuration(preset.durationMs)}
                  value={preset.durationMs / 1000}
                  onChange={(e) => {
                    const seconds = Number(e.target.value);
                    const nextMs = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
                    setPresetDurationMs(node.id, preset.id, nextMs);
                  }}
                />
                <button
                  type="button"
                  className="presets-node__step-move"
                  disabled={chromeDisabled || index === 0}
                  aria-label={`Move preset ${index + 1} up`}
                  title="Move up"
                  onClick={() => movePreset(node.id, preset.id, 'up')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="presets-node__step-move"
                  disabled={chromeDisabled || index === presets.length - 1}
                  aria-label={`Move preset ${index + 1} down`}
                  title="Move down"
                  onClick={() => movePreset(node.id, preset.id, 'down')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="presets-node__step-remove"
                  disabled={chromeDisabled}
                  aria-label={`Remove preset ${index + 1}`}
                  title="Remove preset"
                  onClick={() => removePreset(node.id, preset.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="nodrag nopan presets-node__add-step"
          disabled={chromeDisabled}
          onClick={() => addPreset(node.id, { kind: 'wait', durationMs: 1000 })}
        >
          + Add Wait
        </button>
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
