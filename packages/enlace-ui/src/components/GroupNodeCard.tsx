import { Handle, Position, useStore, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore.js';
import type { HttpMethod, NodeGroup, RunStepStatus } from '../types.js';

export interface GroupMemberSummary {
  nodeId: string;
  method: HttpMethod;
  path: string;
  label: string;
  /** Live run status — same source as WorkflowNodeCard (`stepStatusByNodeId`). */
  status?: RunStepStatus;
}

export interface GroupNodeData {
  group: NodeGroup;
  /** Expanded frame size; also used for collapsed mini-cluster height. */
  width: number;
  height: number;
  memberCount: number;
  /** Populated when collapsed — drives the mini-cluster member list. */
  members?: GroupMemberSummary[];
}

/** Same glyphs as WorkflowNodeCard — collapsed members are hidden, so this
 *  is the only place their run state can surface on the canvas. */
const STATUS_BADGE_GLYPH: Partial<Record<RunStepStatus, string>> = {
  'in-flight': '●',
  paused: '⏸',
  completed: '✓',
  failed: '!',
};

/** Prefer the status that most needs attention during/after a run. */
function aggregateMemberStatus(members: GroupMemberSummary[]): RunStepStatus | undefined {
  const priority: RunStepStatus[] = ['failed', 'paused', 'in-flight', 'completed'];
  for (const status of priority) {
    if (members.some((m) => m.status === status)) return status;
  }
  return undefined;
}

/**
 * Expanded = titled frame behind member cards.
 * Collapsed = style B mini cluster (method + path rows); members stay real
 * WorkflowNodes, just hidden while collapsed.
 */

function LeaveGroupIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2 2h4v6H2M6 5h3M7.5 3.5 9 5 7.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GroupNodeCard({ data, id }: NodeProps<GroupNodeData>) {
  const { group, width, height, memberCount, members = [] } = data;
  const isRunning = useWorkflowStore((s) => s.isRunning);
  // Same as WorkflowNodeCard: React Flow's lock blocks drag/select natively,
  // but our × / leave / rename chrome is plain DOM and must opt in.
  const elementsSelectable = useStore((s) => s.elementsSelectable);
  const chromeDisabled = isRunning || !elementsSelectable;
  const setGroupCollapsed = useWorkflowStore((s) => s.setGroupCollapsed);
  const ungroup = useWorkflowStore((s) => s.ungroup);
  const removeFromGroup = useWorkflowStore((s) => s.removeFromGroup);
  const setGroupName = useWorkflowStore((s) => s.setGroupName);
  const lockTitle = isRunning
    ? "Can't edit groups while the workflow is running"
    : !elementsSelectable
      ? 'Canvas is locked — unlock it to edit groups'
      : undefined;

  if (group.collapsed) {
    const groupStatus = aggregateMemberStatus(members);
    const groupStatusGlyph = groupStatus ? STATUS_BADGE_GLYPH[groupStatus] : undefined;
    const expand = () => {
      if (!chromeDisabled) setGroupCollapsed(group.id, false);
    };
    return (
      <div
        className={`node-group node-group--collapsed node-group--mini-cluster${groupStatus ? ` node-group--${groupStatus}` : ''}`}
        style={{ width, height }}
        title={chromeDisabled ? undefined : 'Double-click to expand'}
        onDoubleClick={(e) => {
          // Name field / chrome buttons own their own double-clicks (text select, etc.).
          if ((e.target as HTMLElement).closest('button, input, a')) return;
          e.stopPropagation();
          expand();
        }}
      >
        <Handle type="target" position={Position.Left} />
        {groupStatusGlyph && (
          <span className={`node-group__status-badge node-group__status-badge--${groupStatus}`} aria-hidden="true">
            {groupStatusGlyph}
          </span>
        )}
        <div className="node-group__titlebar">
          <button
            type="button"
            className="node-group__chevron"
            onClick={(e) => {
              e.stopPropagation();
              expand();
            }}
            disabled={chromeDisabled}
            title={lockTitle ?? 'Expand group'}
            aria-label={`Expand ${group.name}`}
          >
            ›
          </button>
          <input
            className="node-group__name"
            value={group.name}
            disabled={chromeDisabled}
            onChange={(e) => setGroupName(group.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Group name"
            title={lockTitle}
          />
          <span className="node-group__count">{memberCount}</span>
          <button
            type="button"
            className="node-group__ungroup"
            onClick={(e) => {
              e.stopPropagation();
              if (!chromeDisabled) ungroup(group.id);
            }}
            disabled={chromeDisabled}
            title={lockTitle ?? 'Ungroup'}
            aria-label="Ungroup"
          >
            ×
          </button>
        </div>
        <ul className="node-group__members">
          {members.map((m) => {
            const glyph = m.status ? STATUS_BADGE_GLYPH[m.status] : undefined;
            return (
              <li
                key={m.nodeId}
                className={`node-group__member${m.status && glyph ? ` node-group__member--${m.status}` : ''}`}
              >
                {glyph && (
                  <span
                    className={`node-group__member-status node-group__member-status--${m.status}`}
                    aria-hidden="true"
                    title={m.status}
                  >
                    {glyph}
                  </span>
                )}
                <span className={`method-badge method-badge--${m.method}`}>{m.method.toUpperCase()}</span>
                <span className="node-group__member-path" title={m.label}>
                  {m.path}
                </span>
                <button
                  type="button"
                  className="nodrag nopan node-group__member-leave"
                  disabled={chromeDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!chromeDisabled) removeFromGroup(group.id, m.nodeId);
                  }}
                  title={
                    lockTitle ?? `Remove ${m.label} from group — keeps the node on the canvas`
                  }
                  aria-label={`Remove ${m.label} from group`}
                >
                  <LeaveGroupIcon />
                </button>
              </li>
            );
          })}
        </ul>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    <div className="node-group node-group--expanded" style={{ width, height }}>
      <div className="node-group__titlebar node-group__titlebar--frame">
        <button
          type="button"
          className="node-group__chevron"
          onClick={(e) => {
            e.stopPropagation();
            if (!chromeDisabled) setGroupCollapsed(group.id, true);
          }}
          disabled={chromeDisabled}
          title={lockTitle ?? 'Collapse group'}
          aria-label={`Collapse ${group.name}`}
        >
          ⌄
        </button>
        <input
          className="node-group__name"
          value={group.name}
          disabled={chromeDisabled}
          onChange={(e) => setGroupName(group.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Group name"
          title={lockTitle}
        />
        <span className="node-group__count">{memberCount}</span>
        <button
          type="button"
          className="node-group__ungroup"
          onClick={(e) => {
            e.stopPropagation();
            if (!chromeDisabled) ungroup(group.id);
          }}
          disabled={chromeDisabled}
          title={lockTitle ?? 'Ungroup'}
          aria-label="Ungroup"
        >
          ×
        </button>
      </div>
      <span className="node-group__frame-id" hidden>
        {id}
      </span>
    </div>
  );
}
