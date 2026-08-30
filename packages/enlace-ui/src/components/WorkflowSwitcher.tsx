import { useWorkflowStore } from '../store/workflowStore.js';

/**
 * Chrome-center workflow name. Today there is only one workflow — the control
 * reserves the multi-workflow home (picker / add) without a second header row
 * that would steal canvas height. The chevron signals that expansion comes later.
 */
export function WorkflowSwitcher() {
  const specInfo = useWorkflowStore((s) => s.specInfo);
  const name = specInfo?.title?.trim() || 'Untitled';

  return (
    <button
      type="button"
      className="workflow-switcher"
      aria-label={`Workflow: ${name}`}
      title="Multiple workflows coming later"
      disabled
    >
      <span className="workflow-switcher__name">{name}</span>
      <span className="workflow-switcher__chevron" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}
