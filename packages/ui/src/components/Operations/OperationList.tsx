import { useState } from 'react';
import type { Operation } from '../../types.js';

interface Props {
  operations: Operation[];
}

const UNTAGGED = '(untagged)';

// No-shift character (unlike '@'/'#'/'!') — and neither a path (always
// starts with '/') nor an operationId can plausibly start with '.', so it
// never collides with a real match in either other mode.
const PRESET_SEARCH_TRIGGER = '.';

/** Every preset the palette grid can drag — same two kinds PresetsNodeCard.tsx/graphSlice.ts know about, named here for search matching. */
const PRESET_DEFS: Array<{ kind: 'wait' | 'assert'; label: string; icon: string }> = [
  { kind: 'wait', label: 'Wait', icon: '⏱' },
  { kind: 'assert', label: 'Assert', icon: '✓' },
];

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
  const searching = trimmedQuery.length > 0;
  // Three search modes, one search box: a leading '/' searches operation
  // paths only (unchanged from before presets joined this search); a
  // leading PRESET_SEARCH_TRIGGER searches preset names only; anything
  // else is a combined operationId + preset-name search, so plain typing
  // finds either kind without needing a prefix. Each trigger is exclusive
  // of the other results — a path search shows no presets, a preset
  // search shows no operations — same reasoning the original path/operationId
  // split already had: keep the modes distinct so an accidental match in
  // the "wrong" field doesn't pollute results.
  const isPathSearch = trimmedQuery.startsWith('/');
  const isPresetSearch = !isPathSearch && trimmedQuery.startsWith(PRESET_SEARCH_TRIGGER);
  const presetMatchText = isPresetSearch ? trimmedQuery.slice(PRESET_SEARCH_TRIGGER.length) : trimmedQuery;

  const filtered = !searching
    ? operations
    : isPresetSearch
      ? []
      : operations.filter((op) =>
          isPathSearch ? op.path.toLowerCase().includes(trimmedQuery) : op.operationId?.toLowerCase().includes(trimmedQuery)
        );

  const filteredPresets = !searching
    ? PRESET_DEFS
    : isPathSearch
      ? []
      : PRESET_DEFS.filter((p) => p.label.toLowerCase().includes(presetMatchText));

  // Only reached when both are empty (see the render below) — worded per
  // mode so a preset-only search never says "No operations match", etc.
  const emptyMessage = isPathSearch
    ? `No operations match "${query}".`
    : isPresetSearch
      ? `No presets match "${query}".`
      : `No operations or presets match "${query}".`;

  const groups = groupOperations(filtered);
  const multipleGroups = groups.length > 1 || (groups.length === 1 && groups[0].tag !== UNTAGGED);

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
      {/* One search box up top governs both sections below it (see the three
          modes computed above) — search reads as "search this whole panel",
          not "search Operations", so it belongs above both, not wedged
          between them. */}
      <div className="operation-list__search">
        <input
          type="text"
          placeholder="Search by operationId or preset, /path…, .preset…"
          aria-label="Search operations and presets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {/* Icon-grid "library" — not the Operations list's row-per-item shape
          below: a small, fixed set of presets, meant to scan at a glance
          rather than read. Each cell's name is a hover tooltip (`title`) +
          `aria-label`, not visible text. Only real presets live here —
          there's no "collection" item to drag; dropping any preset onto the
          canvas always creates/uses a `kind: 'presets'` collection, even for
          just this one (see Canvas.tsx's onDrop). Hidden entirely (not just
          emptied) once a search excludes every preset — same "a group with
          no matches just doesn't render" behavior Operations' own tag
          groups already have below, rather than showing an empty header. */}
      {filteredPresets.length > 0 && (
        <section className="preset-list">
          <h2>Presets</h2>
          <div className="preset-grid">
            {filteredPresets.map((preset) => (
              <div
                key={preset.kind}
                className="preset-grid__item"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/preset-kind', preset.kind)}
                title={preset.label}
                aria-label={preset.label}
              >
                <span className={`preset-grid__icon preset-grid__icon--${preset.kind}`} aria-hidden="true">
                  {preset.icon}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="operation-list__heading">
        <h2>Operations</h2>
        {multipleGroups && !searching && (
          <button type="button" className="operation-list__toggle-all" onClick={toggleAll}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      {searching && filtered.length === 0 && filteredPresets.length === 0 ? (
        <p className="operation-list__empty">{emptyMessage}</p>
      ) : filtered.length === 0 ? null : multipleGroups ? (
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
