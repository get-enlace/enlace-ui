import { useEffect, type ReactNode } from 'react';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra content in the header, right-aligned before the close button (e.g. an action button). */
  headerExtra?: ReactNode;
}

/**
 * The first centered modal in the codebase — everything else that overlays
 * the canvas (CredentialsPanel) is an edge-anchored drawer instead. Reused
 * by TagConfigModal and NodeInspector's Raw->Form conversion warning.
 * Backdrop click and Escape both close it, mirroring CredentialsPanel's
 * existing Escape-key handling.
 */
export function Modal({ title, onClose, children, headerExtra }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">{title}</span>
          {headerExtra}
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
