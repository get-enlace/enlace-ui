import { useEffect, useRef, useState } from 'react';
import { Annotation, Compartment, EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
  tooltips,
} from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { makeTagPlaceholder, tagPattern } from '@get-enlace/core';
import { randomId } from '../utils/randomId.js';
import type { BodyTag, BodyTagType, RawBody, WorkflowNode } from '../types.js';
import { TagConfigModal } from './TagConfigModal.js';

export interface RawBodyEditorProps {
  rawBody: RawBody;
  onChange: (rawBody: RawBody) => void;
  ancestorNodes: WorkflowNode[];
  /** Precomputed by the caller across the *whole* workflow (see utils/nodeLabel.ts's
   * buildNodeLabels) — not just `ancestorNodes` — so a tag chip's label always matches what the
   * same node shows on its canvas card and in every other picker. */
  nodeLabels: Map<string, string>;
  /**
   * Rejects edits at the CodeMirror level (`EditorState.readOnly`), not
   * just by the caller ignoring `onChange` — this editor isn't a plain
   * controlled React input, so it manages its own document imperatively;
   * blocking the store update alone would leave a keystroke visibly
   * "stick" in the editor with no way for it to ever resync back to the
   * true (unchanged) `rawBody.template`, since the resync effect below
   * only fires when that prop actually changes. See NodeInspector.tsx,
   * the only caller, for why this is ever true (a run in progress).
   */
  readOnly?: boolean;
  /** When false, skip the per-editor "{{" tip — NodeInspector shows one shared hint under Request. */
  showHint?: boolean;
}

// `json()` only supplies the parser/language — it applies no color on its
// own; without a `syntaxHighlighting` extension the doc renders as flat,
// unstyled text regardless of language support. Colors reuse the app's
// existing method-badge palette (styles.css) rather than a generic
// code-theme, so the editor reads as part of the same system: property
// names in the same blue as a GET badge, string values in the same green
// as a POST badge, numbers/booleans in PUT's orange, null in the
// cookie-credential purple, punctuation muted.
const jsonHighlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--color-get)' },
  { tag: t.string, color: 'var(--color-post)' },
  { tag: [t.number, t.bool], color: 'var(--color-put)' },
  { tag: t.null, color: 'var(--color-cookie)' },
  { tag: [t.separator, t.squareBracket, t.brace], color: 'var(--color-text-muted)' },
]);

/** Transactions we dispatch ourselves as part of an already-complete state update (tag inserted/removed) — the update listener skips reporting these, since the caller already has the authoritative combined {template, tags} to report in one go. */
const scripted = Annotation.define<boolean>();
/** Dispatched with no document change, purely to make the chip decoration plugin recompute labels after a tag's config (not its placeholder text) changes. */
const refreshChips = StateEffect.define<void>();
/** Carries the freshly cloned tag(s) a paste produced (see buildTagAutoCloneExtension) from the transactionFilter that computed them through to the updateListener below, which is the only place with access to the rest of rawBody.tags needed to merge them in. Exported so a test can inspect a clone's content directly, same as buildJsonAutocompleteExtensions is exported for CodeMirror-level testing. */
export const cloneTagsEffect = StateEffect.define<Record<string, BodyTag>>();

function tagLabel(tag: BodyTag, nodesById: Map<string, WorkflowNode>, nodeLabels: Map<string, string>): string {
  const label = nodesById.has(tag.sourceNodeId) ? nodeLabels.get(tag.sourceNodeId)! : '(missing)';

  if (tag.type === 'response_header') return `${label} → header ${tag.headerName ?? ''}`;
  if (tag.type === 'response_raw') return `${label} → raw body`;
  return `${label} → ${tag.jsonPath || 'body'}`;
}

interface ChipConfig {
  tags: Record<string, BodyTag>;
  nodesById: Map<string, WorkflowNode>;
  nodeLabels: Map<string, string>;
  onClickChip: (tagId: string) => void;
}

class TagChipWidget extends WidgetType {
  constructor(
    readonly tagId: string,
    readonly label: string,
    /** True when the tag's source node no longer exists on the canvas (deleted after the mapping was made), or the placeholder references a tag id with no config at all — either way, this mapping is broken and needs attention, not a normal, healthy chip. */
    readonly broken: boolean,
    /** Null for an unrecognized tag id — there's no BodyTag to edit, so the chip is a plain (non-clickable) warning rather than an entry point into the config modal. */
    readonly onClick: ((tagId: string) => void) | null
  ) {
    super();
  }
  eq(other: TagChipWidget) {
    return other.tagId === this.tagId && other.label === this.label && other.broken === this.broken;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.broken ? 'tag-chip tag-chip--broken' : 'tag-chip';
    span.textContent = this.label;
    if (this.onClick) {
      span.title = this.broken
        ? 'This mapping\'s source node no longer exists — click to fix or remove it'
        : 'Click to edit this mapping';
      // Keep CodeMirror from placing the cursor inside the widget on mousedown.
      span.addEventListener('mousedown', (e) => e.preventDefault());
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClick!(this.tagId);
      });
    } else {
      span.title = 'Unrecognized tag reference — no mapping is configured for this';
      span.style.cursor = 'default'; // nothing to click into — overrides .tag-chip's default pointer cursor
    }
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

function buildDecorations(text: string, config: ChipConfig): DecorationSet {
  const ranges = [];
  for (const match of text.matchAll(tagPattern())) {
    const tagId = match[1];
    const tag = config.tags[tagId];
    const from = match.index ?? 0;
    const to = from + match[0].length;

    if (!tag) {
      // Orphaned placeholder — text matches the tag syntax but no config
      // is registered for it (e.g. hand-typed, or copy-pasted from
      // elsewhere). Flagged rather than hidden or rendered as a normal
      // chip, but there's nothing to open a config modal for.
      ranges.push(Decoration.replace({ widget: new TagChipWidget(tagId, 'Unrecognized tag', true, null) }).range(from, to));
      continue;
    }

    const broken = !config.nodesById.has(tag.sourceNodeId);
    const label = tagLabel(tag, config.nodesById, config.nodeLabels);
    ranges.push(Decoration.replace({ widget: new TagChipWidget(tagId, label, broken, config.onClickChip) }).range(from, to));
  }
  return Decoration.set(ranges);
}

function chipPlugin(configRef: { current: ChipConfig }) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state.doc.toString(), configRef.current);
      }
      update(update: ViewUpdate) {
        const forced = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshChips)));
        if (update.docChanged || forced) {
          this.decorations = buildDecorations(update.state.doc.toString(), configRef.current);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/**
 * Autocomplete source: typing `{{` while the cursor is inside a JSON
 * string literal offers a single "Response" entry point — since every tag
 * type maps from an upstream response, splitting that into three
 * separately-typed options up front just made you commit to one before
 * you'd even picked a request to map from. Picking it opens the config
 * modal defaulted to `response_body` (the common case); the modal's own
 * "Map" dropdown (see TagConfigModal.tsx) is where the type actually gets
 * chosen/changed, mirroring the reference tool's "Function to Perform" +
 * "Attribute" split. The placeholder itself is inserted only once that
 * modal is confirmed (see handleInsertConfirm), replacing only the typed
 * `{{...` trigger text — not the whole enclosing string.
 *
 * That's deliberate, not an oversight: composing a chip with surrounding
 * literal text in the same field (`"Bearer {{token}}"`, `"order-{{id}}"`)
 * is a real, common need — prefixing/suffixing a mapped value — and
 * forcing the whole field to become just the chip would make that
 * impossible to build through this discoverable flow. The one trap this
 * reopens (typing `{{` inside Raw mode's schema-example placeholder text,
 * e.g. `"string"`, without clearing it first, leaves the chip embedded in
 * leftover text you probably didn't mean to keep) is a copy-editing rough
 * edge, not a correctness one: utils/bodyTags.ts's `resolveTagsInValue`
 * resolves an embedded tag correctly at request time regardless of mode,
 * so the worst case is a field that looks cluttered, never one that
 * silently sends an unresolved placeholder.
 */
function tagCompletionSource(onTrigger: (type: BodyTagType, from: number, to: number) => void) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\{\{\w*/);
    if (!match) return null;

    const node = syntaxTree(context.state).resolveInner(match.from, -1);
    if (node.name !== 'String') return null;

    return {
      from: match.from,
      to: match.to,
      // CodeMirror's default fuzzy-match filtering compares the option's
      // *label* against the literal typed text (here, "{{") and drops
      // anything that doesn't match — fine for normal word completion, but
      // "Response → Map from..." has nothing to do with the `{{` trigger
      // text, so the default filter would silently discard it and close
      // the popup before it's ever seen.
      filter: false,
      options: [
        {
          label: 'Response → Map from...',
          // No document edit here — accepting the option only opens the
          // config modal; the typed `{{` is left untouched until the
          // modal is confirmed, so canceling leaves the document exactly
          // as it was mid-edit rather than having already deleted
          // something.
          apply: (_view, _completion, from, to) => onTrigger('response_body', from, to),
        },
      ],
    };
  };
}

/**
 * The doc-shape-independent half of the editor's extensions — split out
 * from the component so a test can build a real `EditorView` against them
 * directly (see RawBodyEditor.test.tsx's tooltip-clipping regression
 * test), without needing React or the chip-decoration plumbing that
 * depends on per-node config.
 */
export function buildJsonAutocompleteExtensions(
  onTriggerTag: (type: BodyTagType, from: number, to: number) => void
): Extension[] {
  return [
    json(),
    syntaxHighlighting(jsonHighlightStyle),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    autocompletion({ override: [tagCompletionSource(onTriggerTag)] }),
    EditorView.lineWrapping,
    // CodeMirror defaults to its *light* base theme (caret-color: black)
    // unless told otherwise — our CSS paints this editor with a near-
    // black background to match the app's dark palette, so without this
    // the caret is black-on-black and never visible, even though it's
    // there and blinking. This flips the `dark` facet so the base
    // theme's `&dark` caret/selection/active-line defaults (white caret,
    // etc.) apply instead.
    EditorView.theme({}, { dark: true }),
    // Autocomplete's popup is (by default) appended as a plain child of
    // the editor's own root element and positioned `fixed` — but our
    // wrapper CSS sets `overflow: hidden` (for the rounded-corner look),
    // which clips any DOM descendant regardless of its `position`, so
    // the popup would render completely invisible instead of just
    // missing. Mounting tooltips on `document.body` instead is
    // CodeMirror's documented fix for an editor that lives inside a
    // clipping/scrolling container.
    tooltips({ parent: document.body }),
  ];
}

/**
 * A tag chip's placeholder text (`{{enlace:<id>}}`) is, to CodeMirror, just
 * plain document text — copying a chip and pasting it into another field
 * copies that literal text, id and all, rather than the config it renders.
 * Left alone, that produces two placeholders sharing one `BodyTag` entry:
 * editing "the pasted one" is really editing the one shared config, so the
 * original chip silently changes too. Every *other* way of getting a
 * placeholder into the doc (typing `{{` through the autocomplete flow, see
 * tagCompletionSource above) always mints a fresh id, so this is reachable
 * only via copy-paste — and nobody pasting a chip expects aliasing.
 *
 * This transactionFilter runs on every doc-changing transaction (including
 * paste) and, whenever it finds a placeholder id repeated in the resulting
 * document, rewrites every occurrence past the first to a freshly minted id
 * with its own cloned copy of the original tag's config — as part of the
 * *same* transaction (`sequential: true` interprets the rename's positions
 * against the document the first spec just produced, not the pre-paste
 * one), so the doc and its tags never observably pass through the aliased
 * state. The clone itself travels to the updateListener via `cloneTagsEffect`,
 * since only the listener has `rawBody.tags` in scope to merge it into.
 *
 * `getExistingTags` is read fresh on every transaction (not captured once)
 * so this always clones from the current config, not a stale closure.
 */
export function buildTagAutoCloneExtension(getExistingTags: () => Record<string, BodyTag>): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(scripted)) return tr;

    const existingTags = getExistingTags();
    const newText = tr.newDoc.toString();
    const seenIds = new Set<string>();
    const renameChanges: { from: number; to: number; insert: string }[] = [];
    const cloned: Record<string, BodyTag> = {};

    for (const match of newText.matchAll(tagPattern())) {
      const id = match[1];
      if (!seenIds.has(id)) {
        seenIds.add(id);
        continue;
      }
      const original = existingTags[id];
      if (!original) continue; // orphaned/unrecognized id — nothing to clone from

      const newId = randomId();
      cloned[newId] = { ...original, id: newId };
      const from = match.index ?? 0;
      renameChanges.push({ from, to: from + match[0].length, insert: makeTagPlaceholder(newId) });
    }

    if (renameChanges.length === 0) return tr;
    return [tr, { changes: renameChanges, effects: cloneTagsEffect.of(cloned), sequential: true }];
  });
}

export function RawBodyEditor({
  rawBody,
  onChange,
  ancestorNodes,
  nodeLabels,
  readOnly = false,
  showHint = true,
}: RawBodyEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const configRef = useRef<ChipConfig>(null as unknown as ChipConfig);
  const liveRef = useRef({ rawBody, onChange });
  liveRef.current = { rawBody, onChange };
  // A single Compartment slot, reconfigured (not rebuilt) whenever
  // `readOnly` changes — see the effect below. Stable for the component's
  // whole lifetime, same as viewRef; both are recreated together on
  // remount, which is fine since a Compartment has no state of its own
  // beyond being a handle into one EditorView's extension tree.
  const readOnlyCompartmentRef = useRef(new Compartment());

  const [pendingInsert, setPendingInsert] = useState<{ type: BodyTagType; from: number; to: number } | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);

  const nodesById = new Map(ancestorNodes.map((n) => [n.id, n]));

  configRef.current = {
    tags: rawBody.tags,
    nodesById,
    nodeLabels,
    onClickChip: (tagId) => setEditingTagId(tagId),
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(scripted))) return;

      const clonedTags: Record<string, BodyTag> = {};
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(cloneTagsEffect)) Object.assign(clonedTags, effect.value);
        }
      }

      const template = update.state.doc.toString();
      const presentIds = new Set([...template.matchAll(tagPattern())].map((m) => m[1]));
      const mergedTags = { ...liveRef.current.rawBody.tags, ...clonedTags };
      const tags = Object.fromEntries(Object.entries(mergedTags).filter(([id]) => presentIds.has(id)));
      liveRef.current.onChange({ template, tags });
    });

    const chipPluginType = chipPlugin(configRef);

    const extensions: Extension[] = [
      ...buildJsonAutocompleteExtensions((type, from, to) => setPendingInsert({ type, from, to })),
      buildTagAutoCloneExtension(() => liveRef.current.rawBody.tags),
      chipPluginType,
      EditorView.atomicRanges.of((view) => view.plugin(chipPluginType)?.decorations ?? Decoration.none),
      updateListener,
      // Both together, not just readOnly alone — readOnly blocks the
      // transactions a keystroke/paste would produce, but leaves the doc
      // itself contenteditable; editable(false) is what actually stops the
      // caret/focus/IME too. CodeMirror's own recommended combination for
      // "fully read-only", per its docs.
      readOnlyCompartmentRef.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    ];

    const view = new EditorView({
      doc: liveRef.current.rawBody.template,
      extensions,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external template changes (e.g. Form -> Raw regeneration, or a
  // fresh node selection) into the editor. A no-op when the last change
  // originated from this editor itself, since the doc already matches.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === rawBody.template) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: rawBody.template },
      annotations: scripted.of(true),
    });
  }, [rawBody.template]);

  // Toggling readOnly is a reconfigure, not a rebuild — the compartment
  // slot (registered once at mount, above) is the whole point of using one
  // instead of just conditionally including EditorState.readOnly.of(...)
  // in the initial extensions list, which would need the view torn down
  // and rebuilt (losing cursor position, undo history, scroll) every time
  // a run starts or ends.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  // Tag metadata (jsonPath/sourceNodeId/headerName) can change without the
  // placeholder text changing at all — force the chip widgets to re-render
  // with fresh labels in that case.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshChips.of() });
  }, [rawBody.tags]);

  /**
   * Returns keyboard focus to this field's own CodeMirror doc once its tag
   * popup closes — for any reason: confirm, delete, or cancel.
   *
   * Reproduces a reported bug otherwise: React Flow's built-in Delete/
   * Backspace handler (useGlobalKeyHandler) listens on the whole document
   * and only backs off when the *currently focused* element is an input/
   * textarea/contenteditable (see @reactflow/core's isInputDOMNode). A tag
   * chip's own mousedown handler calls preventDefault() specifically to
   * stop CodeMirror from placing the cursor inside it (see TagChipWidget
   * above) — which also means clicking a chip never gives the editor real
   * DOM focus in the first place. So once its popup closes, focus is
   * sitting nowhere in particular (document.body), which isn't an "input"
   * as far as that guard is concerned: the still-selected node it was
   * opened from stays fully delete-eligible, and any stray Delete/
   * Backspace keystroke — on a Mac, the key labeled "delete" *is*
   * Backspace — wipes the node the user only meant to stop editing.
   * CodeMirror's content is a real contenteditable element, which that
   * guard already recognizes and protects; this just makes sure focus
   * actually lands there again instead of nowhere.
   */
  function refocusEditor() {
    viewRef.current?.focus();
  }

  function handleInsertConfirm(tag: BodyTag) {
    const view = viewRef.current;
    if (!view || !pendingInsert) return;
    const docLength = view.state.doc.length;
    // Clamp defensively — the modal is a blocking overlay so the doc
    // shouldn't change while it's open, but if it somehow did, replacing
    // a stale out-of-range span would throw rather than degrade.
    const from = Math.min(pendingInsert.from, docLength);
    const to = Math.min(Math.max(pendingInsert.to, from), docLength);
    view.dispatch({
      changes: { from, to, insert: makeTagPlaceholder(tag.id) },
      annotations: scripted.of(true),
    });
    onChange({ template: view.state.doc.toString(), tags: { ...rawBody.tags, [tag.id]: tag } });
    setPendingInsert(null);
    refocusEditor();
  }

  function findTagSpan(text: string, tagId: string): { from: number; to: number } | null {
    const match = new RegExp(`\\{\\{enlace:${tagId}\\}\\}`).exec(text);
    if (!match) return null;
    return { from: match.index, to: match.index + match[0].length };
  }

  function handleEditConfirm(tag: BodyTag) {
    onChange({ template: rawBody.template, tags: { ...rawBody.tags, [tag.id]: tag } });
    setEditingTagId(null);
    refocusEditor();
  }

  function handleDelete() {
    const view = viewRef.current;
    if (!view || !editingTagId) return;
    const span = findTagSpan(view.state.doc.toString(), editingTagId);
    if (span) {
      view.dispatch({ changes: { from: span.from, to: span.to, insert: '' }, annotations: scripted.of(true) });
    }
    const tags = { ...rawBody.tags };
    delete tags[editingTagId];
    onChange({ template: view.state.doc.toString(), tags });
    setEditingTagId(null);
    refocusEditor();
  }

  function handleCancelInsert() {
    setPendingInsert(null);
    refocusEditor();
  }

  function handleCancelEdit() {
    setEditingTagId(null);
    refocusEditor();
  }

  const editingTag = editingTagId ? rawBody.tags[editingTagId] : undefined;

  return (
    <div className="raw-body-editor">
      {showHint && (
        <div className="raw-body-editor__hint">
          Type <code>{'{{'}</code> inside a string to map a value from an upstream response.
        </div>
      )}
      <div className={`raw-body-editor__codemirror${readOnly ? ' raw-body-editor__codemirror--readonly' : ''}`} ref={containerRef} />

      {pendingInsert && (
        <TagConfigModal
          ancestorNodes={ancestorNodes}
          nodeLabels={nodeLabels}
          initialType={pendingInsert.type}
          onConfirm={handleInsertConfirm}
          onCancel={handleCancelInsert}
        />
      )}

      {editingTag && (
        <TagConfigModal
          ancestorNodes={ancestorNodes}
          nodeLabels={nodeLabels}
          initialType={editingTag.type}
          initialTag={editingTag}
          onConfirm={handleEditConfirm}
          onDelete={handleDelete}
          onCancel={handleCancelEdit}
        />
      )}
    </div>
  );
}
