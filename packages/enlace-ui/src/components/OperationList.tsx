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
          <li
            key={op.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/operation-id', op.id)}
            className={`operation-list__item operation-list__item--${op.method}`}
          >
            <span className={`method-badge method-badge--${op.method}`}>{op.method.toUpperCase()}</span>
            <span className="operation-list__path">{op.path}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
