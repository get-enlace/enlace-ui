import { useState } from 'react';
import type { Operation } from '../../types.js';

interface Props {
  operations: Operation[];
}

const UNTAGGED = '(untagged)';

function groupOperations(ops: Operation[]): Array<{ tag: string; operations: Operation[] }> {
  const order: string[] = [];
  const map = new Map<string, Operation[]>();

  for (const op of ops) {
    const tag = op.tags?.[0] ?? UNTAGGED;
    if (!map.has(tag)) {
      order.push(tag);
      map.set(tag, []);
    }
    map.get(tag)!.push(op);
  }

  // Named tags in declaration order, untagged always last.
  return order
    .filter((t) => t !== UNTAGGED)
    .concat(order.includes(UNTAGGED) ? [UNTAGGED] : [])
    .map((tag) => ({ tag, operations: map.get(tag)! }));
}

export function OperationList({ operations }: Props) {
  const [query, setQuery] = useState('');
  // Empty = all collapsed. Search temporarily expands every visible
  // (already-filtered) group; clearing the query returns to this set.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const trimmedQuery = query.trim().toLowerCase();
  // Path search when the query starts with '/', operationId search otherwise.
  // This keeps the two search modes distinct — typing "pet" searches operationIds;
  // typing "/pet" searches the path, so accidental path matches don't pollute
  // the operationId results.
  const filtered = trimmedQuery
    ? operations.filter((op) =>
        trimmedQuery.startsWith('/')
          ? op.path.toLowerCase().includes(trimmedQuery)
          : op.operationId?.toLowerCase().includes(trimmedQuery)
      )
    : operations;

  const groups = groupOperations(filtered);
  const multipleGroups = groups.length > 1 || (groups.length === 1 && groups[0].tag !== UNTAGGED);
  const searching = trimmedQuery.length > 0;

  const allTags = groups.map((g) => g.tag);
  const allExpanded = allTags.length > 0 && allTags.every((tag) => expanded.has(tag));

  const toggleGroup = (tag: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(allTags));
  };

  const renderItem = (op: Operation) => (
    <li key={op.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/operation-id', op.id)}>
      <fieldset className={`operation-list__item operation-list__item--${op.method}`}>
        {op.operationId && <legend className="operation-list__operation-id">{op.operationId}</legend>}
        <span className={`method-badge method-badge--${op.method}`}>{op.method.toUpperCase()}</span>
        <span className="operation-list__path">{op.path}</span>
      </fieldset>
    </li>
  );

  return (
    <aside className="operation-list">
      {/* Deliberately not a <ul>/<li> like the Operations list below — a
          single fixed preset today, and the two lists' `listitem` roles
          would otherwise collide in "how many operations matched" counts.
          Only real presets live here — there's no "collection" item to
          drag; dropping any preset onto the canvas always creates/uses a
          `kind: 'presets'` collection, even for just this one (see
          Canvas.tsx's onDrop). */}
      <section className="preset-list">
        <h2>Presets</h2>
        <div
          className="preset-list__item"
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/preset-kind', 'wait')}
        >
          <span className="preset-list__icon" aria-hidden="true">
            ⏱
          </span>
          <span className="preset-list__label">Wait</span>
        </div>
      </section>
      <div className="operation-list__heading">
        <h2>Operations</h2>
        {multipleGroups && !searching && (
          <button type="button" className="operation-list__toggle-all" onClick={toggleAll}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      <div className="operation-list__search">
        <input
          type="text"
          placeholder="Search by operationId or /path…"
          aria-label="Search operations by operationId"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {searching && filtered.length === 0 ? (
        <p className="operation-list__empty">No operations match &quot;{query}&quot;.</p>
      ) : multipleGroups ? (
        <div className="operation-list__groups">
          {groups.map(({ tag, operations: groupOps }) => {
            // While searching, every remaining group has a match — expand them
            // so the hits are visible without an extra click.
            const isExpanded = searching || expanded.has(tag);
            return (
              <div key={tag} className="operation-list__group">
                <button
                  type="button"
                  className={`operation-list__group-header${isExpanded ? '' : ' operation-list__group-header--collapsed'}`}
                  onClick={() => toggleGroup(tag)}
                  aria-expanded={isExpanded}
                >
                  <span className="operation-list__group-chevron">{isExpanded ? '⌄' : '›'}</span>
                  <span className="operation-list__group-name">{tag}</span>
                  <span className="operation-list__group-count">{groupOps.length}</span>
                </button>
                {isExpanded && <ul>{groupOps.map(renderItem)}</ul>}
              </div>
            );
          })}
        </div>
      ) : (
        <ul>{filtered.map(renderItem)}</ul>
      )}
    </aside>
  );
}
