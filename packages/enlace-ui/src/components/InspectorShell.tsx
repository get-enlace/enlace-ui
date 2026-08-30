import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const DEFAULT_WIDTH = 240; // match ops list column for a balanced first paint
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;

export interface InspectorShellProps {
  children: ReactNode;
  onCollapse: () => void;
  /** Reports width so the parent grid column can match. */
  onWidthChange?: (width: number) => void;
}

/**
 * Right-column chrome around NodeInspector: left-edge collapse (mid-seam)
 * and drag-resize. Width is owned here and pushed up for the app grid.
 */
export function InspectorShell({ children, onCollapse, onWidthChange }: InspectorShellProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    onWidthChange?.(width);
  }, [width, onWidthChange]);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startWidth: width };
    },
    [width]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      // Dragging left grows the inspector; right shrinks it.
      const delta = dragRef.current.startX - e.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div className="inspector-shell">
      <div
        className="inspector-shell__resize"
        onPointerDown={onResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        title="Drag to resize"
      />
      <button
        type="button"
        className="inspector-shell__collapse"
        onClick={onCollapse}
        title="Hide inspector"
        aria-label="Hide inspector"
      >
        ›
      </button>
      {children}
    </div>
  );
}

export { DEFAULT_WIDTH as INSPECTOR_DEFAULT_WIDTH };
