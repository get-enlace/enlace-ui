import { useState } from 'react';
import type { Operation } from '../types.js';

interface Props {
  operations: Operation[];
}

export function OperationList({ operations }: Props) {
  const [query, setQuery] = useState('');

  // operationId-only for now, per the spec's own operationId field (not
  // every operation has one — see the legend logic below). Matching on
  // path/method too is a natural follow-up, not in scope for this first
  // pass.
  const trimmedQuery = query.trim().toLowerCase();
  const filtered = trimmedQuery
    ? operations.filter((op) => op.operationId?.toLowerCase().includes(trimmedQuery))
    : operations;

  return (
    <aside className="operation-list">
      <h2>Operations</h2>
      <div className="operation-list__search">
        <input
          type="text"
          placeholder="Search by operationId…"
          aria-label="Search operations by operationId"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {trimmedQuery && filtered.length === 0 ? (
        <p className="operation-list__empty">No operations match &quot;{query}&quot;.</p>
      ) : (
        <ul>
          {filtered.map((op) => (
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
      )}
    </aside>
  );
}
