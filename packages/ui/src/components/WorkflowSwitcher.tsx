import { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';

/**
 * Chrome-center workflow name. Click the name to rename; the chevron is a
 * stub for a future multi-workflow picker (switch / add) without a second
 * header row that would steal canvas height.
 *
 * Uses `workflowName` (canvas document), not the OpenAPI `info.title`.
 */
export function WorkflowSwitcher() {
  const name = useWorkflowStore((s) => s.workflowName);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  function startEditing() {
    setDraft(name);
    setEditing(true);
  }

  function commit(value: string) {
    setWorkflowName(value);
    setEditing(false);
  }

  return (
    <div className="workflow-switcher">
      {editing ? (
        <input
          ref={inputRef}
          className="workflow-switcher__input"
          value={draft}
          aria-label="Workflow name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              // Restore before blur so onBlur commits the original name
              // (draft state may still be stale in this handler).
              e.currentTarget.value = name;
              setDraft(name);
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="workflow-switcher__name-btn"
          aria-label={`Workflow: ${name}`}
          title="Rename workflow"
          onClick={startEditing}
        >
          <span className="workflow-switcher__name">{name}</span>
        </button>
      )}
      <button
        type="button"
        className="workflow-switcher__chevron"
        disabled
        title="Multiple workflows coming later"
        aria-label="Switch workflow"
      >
        ▾
      </button>
    </div>
  );
}
