import type { Operation } from '../types.js';

interface Props {
  operations: Operation[];
}

export function OperationList({ operations }: Props) {
  return (
    <aside className="operation-list">
      <h2>Operations</h2>
      <ul>
        {operations.map((op) => (
          <li key={op.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/operation-id', op.id)}>
            {/* A real <fieldset>/<legend> — not a hand-positioned label — so the
                browser itself cuts the gap in the top border and reserves the
                right amount of space for it, instead of us guessing offsets. */}
            <fieldset className={`operation-list__item operation-list__item--${op.method}`}>
              {op.operationId && <legend className="operation-list__operation-id">{op.operationId}</legend>}
              <span className={`method-badge method-badge--${op.method}`}>{op.method.toUpperCase()}</span>
              <span className="operation-list__path">{op.path}</span>
            </fieldset>
          </li>
        ))}
      </ul>
    </aside>
  );
}
