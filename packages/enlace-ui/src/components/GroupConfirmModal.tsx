import { useState } from 'react';
import { Modal } from './Modal.js';

export type GroupConfirmMode =
  | { kind: 'create'; withNodeLabel: string }
  | { kind: 'join'; groupName: string };

export interface GroupConfirmModalProps {
  mode: GroupConfirmMode;
  defaultName: string;
  onConfirm: (result: { name: string; skipConfirmOnDrop: boolean }) => void;
  onCancel: () => void;
}

/**
 * Shown after a ≥50% drop-overlap gesture. Cancel leaves anti-overlap snap
 * to the Canvas caller; confirm creates or joins a group.
 */
export function GroupConfirmModal({ mode, defaultName, onConfirm, onCancel }: GroupConfirmModalProps) {
  const [name, setName] = useState(defaultName);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const isCreate = mode.kind === 'create';

  return (
    <Modal title={isCreate ? 'Group nodes' : 'Add to group'} onClose={onCancel}>
      <p className="group-confirm__lead">
        {isCreate
          ? `Group with ${mode.withNodeLabel}?`
          : `Add to “${mode.groupName}”?`}
      </p>
      {isCreate && (
        <label className="tag-config-modal__field">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            aria-label="Group name"
          />
        </label>
      )}
      <label className="group-confirm__checkbox">
        <input
          type="checkbox"
          checked={skipConfirm}
          onChange={(e) => setSkipConfirm(e.target.checked)}
        />
        Don&apos;t ask when dropping into this group
      </label>
      <div className="group-confirm__actions">
        <button type="button" className="group-confirm__btn group-confirm__btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="group-confirm__btn group-confirm__btn--primary"
          onClick={() => onConfirm({ name: name.trim() || defaultName || 'Group', skipConfirmOnDrop: skipConfirm })}
        >
          {isCreate ? 'Group' : 'Add'}
        </button>
      </div>
    </Modal>
  );
}
