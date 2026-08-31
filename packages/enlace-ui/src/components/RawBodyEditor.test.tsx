import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { RawBodyEditor, buildJsonAutocompleteExtensions, buildTagAutoCloneExtension, cloneTagsEffect } from './RawBodyEditor.js';
import { buildNodeLabels } from '../utils/nodeLabel.js';
import type { BodyTag, Operation, RawBody, WorkflowNode } from '../types.js';

function node(id: string, operationId: string): WorkflowNode {
  return { id, operationId, credentialId: null, fieldValues: {} };
}

const ops: Operation[] = [
  { id: 'GET /orders/{id}', method: 'get', path: '/orders/{id}', parameters: [], requestBodySchema: null, responseSchema: null },
];
const opsById = new Map(ops.map((o) => [o.id, o]));
// The real caller (NodeInspector) computes this across the *whole* workflow, but for these
// tests the ancestor set given to each node's render is the whole workflow anyway.
const labelsFor = (nodes: WorkflowNode[]) => buildNodeLabels(nodes, opsById);

describe('RawBodyEditor', () => {
  it('renders the initial template text inside the CodeMirror doc', async () => {
    const rawBody: RawBody = { template: '{"name":"widget"}', tags: {} };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} />
    );
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('widget');
    });
  });

  it('renders a tag chip for a placeholder present in the template', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const rawBody: RawBody = {
      template: '{"name":"{{enlace:tag1}}"}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' } },
    };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[a]} nodeLabels={labelsFor([a])} />
    );
    await waitFor(() => {
      expect(container.querySelector('.tag-chip')).toBeTruthy();
    });
    expect(container.querySelector('.tag-chip')?.textContent).toContain('item.title');
  });

  it('un-marks a chip as broken once its source is repointed to a valid, connected node', async () => {
    // Reproduces a reported bug: fix a broken mapping (pick a new,
    // reachable source node in the edit modal, save) and the chip should
    // go back to its normal color — not stay red.
    const validNode = node('node-b', 'GET /orders/{id}');

    function Harness() {
      const [rawBody, setRawBody] = useState<RawBody>({
        template: '{"name":"{{enlace:tag1}}"}',
        tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-deleted', jsonPath: 'item.title' } },
      });
      return <RawBodyEditor rawBody={rawBody} onChange={setRawBody} ancestorNodes={[validNode]} nodeLabels={labelsFor([validNode])} />;
    }

    const { container } = render(<Harness />);
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(chip.classList.contains('tag-chip--broken')).toBe(true);

    fireEvent.click(chip);
    const requestSelect = await screen.findByLabelText('Request');
    fireEvent.change(requestSelect, { target: { value: 'node-b' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      const fixed = container.querySelector('.tag-chip')!;
      expect(fixed.classList.contains('tag-chip--broken')).toBe(false);
    });
  });

  it('renders a distinct "broken" chip when the tag\'s source node no longer exists on the canvas', async () => {
    // e.g. a mapping was made, then the source node was deleted.
    const rawBody: RawBody = {
      template: '{"name":"{{enlace:tag1}}"}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-deleted', jsonPath: 'item.title' } },
    };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(chip.classList.contains('tag-chip--broken')).toBe(true);
    expect(chip.textContent).toContain('missing');
    expect(chip.getAttribute('title')).toMatch(/no longer exists/);
  });

  it('renders a non-interactive "unrecognized" chip for a placeholder with no registered tag config', async () => {
    // e.g. hand-typed or copy-pasted text that happens to match the tag
    // syntax but has no BodyTag behind it at all.
    const rawBody: RawBody = { template: '{"name":"{{enlace:ghost}}"}', tags: {} };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(chip.classList.contains('tag-chip--broken')).toBe(true);
    expect(chip.textContent).toBe('Unrecognized tag');
    expect((chip as HTMLElement).style.cursor).toBe('default');

    // No config to edit — clicking it must not open a modal.
    fireEvent.click(chip);
    expect(screen.queryByText('Edit mapping')).not.toBeInTheDocument();
  });

  it('opens the edit modal (with a delete option) when a chip is clicked', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const rawBody: RawBody = {
      template: '{"name":"{{enlace:tag1}}"}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' } },
    };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[a]} nodeLabels={labelsFor([a])} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(chip);
    expect(await screen.findByText('Edit mapping')).toBeInTheDocument();
    expect(screen.getByText('Remove mapping')).toBeInTheDocument();
  });

  it('returns focus to the editor once the tag popup closes, so a stray Delete/Backspace does not wipe the still-selected node', async () => {
    // Reproduces a reported bug: select a node, open the raw editor, click
    // a chip to configure it, save/close the popup — the node is still
    // selected (as intended, so editing can continue), but keyboard focus
    // was landing nowhere in particular. React Flow's own Delete/Backspace
    // handler only backs off for a focused input/textarea/contenteditable;
    // CodeMirror's content is exactly that, so restoring focus there is
    // what makes React Flow's existing guard actually apply again.
    const a = node('node-a', 'GET /orders/{id}');
    const rawBody: RawBody = {
      template: '{"name":"{{enlace:tag1}}"}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' } },
    };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[a]} nodeLabels={labelsFor([a])} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    const content = container.querySelector('.cm-content') as HTMLElement;

    fireEvent.click(chip);
    expect(await screen.findByText('Edit mapping')).toBeInTheDocument();
    // While the modal is open, focus is inside it, not the editor.
    expect(content).not.toBe(document.activeElement);

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.queryByText('Edit mapping')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(content);
  });

  it('also returns focus to the editor when the tag popup is cancelled, not just saved', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const rawBody: RawBody = {
      template: '{"name":"{{enlace:tag1}}"}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' } },
    };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[a]} nodeLabels={labelsFor([a])} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    const content = container.querySelector('.cm-content') as HTMLElement;

    fireEvent.click(chip);
    await screen.findByText('Edit mapping');
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => expect(screen.queryByText('Edit mapping')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(content);
  });

  it('deletes the chip and its tag when "Remove mapping" is confirmed', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const rawBody: RawBody = {
      template: '{"name":"{{enlace:tag1}}"}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' } },
    };
    const onChange = vi.fn();
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={onChange} ancestorNodes={[a]} nodeLabels={labelsFor([a])} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    const content = container.querySelector('.cm-content') as HTMLElement;
    fireEvent.click(chip);
    fireEvent.click(await screen.findByText('Remove mapping'));

    expect(onChange).toHaveBeenCalledWith({ template: '{"name":""}', tags: {} });
    // Same fix as the Save/Cancel paths — deleting the mapping closes the
    // popup too, and must return focus to the editor for the same reason.
    expect(document.activeElement).toBe(content);
  });

  it('activates CodeMirror\'s dark theme facet, so the base theme\'s caret is visible against our dark background', async () => {
    // Regression test for a real bug: CodeMirror defaults to its *light*
    // base theme (caret-color: black) unless told otherwise. Our CSS
    // paints this editor with a near-black background to match the app's
    // dark palette, so an un-flipped editor has a black-on-black,
    // effectively invisible caret — it blinks, it's just never seen.
    const rawBody: RawBody = { template: '{"a":1}', tags: {} };
    const { container } = render(<RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} />);
    const content = await waitFor(() => {
      const el = container.querySelector('.cm-content');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(getComputedStyle(content).caretColor).toBe('rgb(255, 255, 255)');
  });

  it('mounts the tag-autocomplete popup on document.body rather than inside a clipped ancestor', async () => {
    // Regression test for a real bug: the autocomplete popup is (by
    // default) appended as a plain child of the editor's own root element
    // and positioned `fixed` — but our wrapper CSS sets `overflow: hidden`
    // (for the rounded-corner look), which clips any DOM descendant
    // regardless of `position`, making the popup render invisibly instead
    // of just not appearing. `buildJsonAutocompleteExtensions` fixes this
    // via `tooltips({ parent: document.body })`; this test reproduces the
    // exact clipped-wrapper scenario and checks the popup escapes it.
    const clippedWrapper = document.createElement('div');
    clippedWrapper.style.overflow = 'hidden';
    document.body.appendChild(clippedWrapper);

    const doc = '{"name": ""}';
    const cursor = doc.indexOf('""') + 1; // between the empty string's quotes

    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: buildJsonAutocompleteExtensions(() => {}),
      }),
      parent: clippedWrapper,
    });

    function typeChar(ch: string) {
      const head = view.state.selection.main.head;
      view.dispatch({
        changes: { from: head, insert: ch },
        selection: { anchor: head + ch.length },
        annotations: Transaction.userEvent.of('input.type'),
      });
    }

    typeChar('{');
    typeChar('{');

    // autocompletion() debounces activation (activateOnTypingDelay, 100ms
    // by default) before it queries sources and renders the popup.
    await waitFor(() => {
      expect(completionStatus(view.state)).toBe('active');
    }, { timeout: 2000 });
    await waitFor(() => {
      expect(document.body.querySelector('.cm-tooltip-autocomplete')).toBeTruthy();
    });

    const tooltip = document.body.querySelector('.cm-tooltip-autocomplete')!;
    expect(clippedWrapper.contains(tooltip)).toBe(false);
    expect(document.body.contains(tooltip)).toBe(true);

    view.destroy();
    clippedWrapper.remove();
  });

  it('reports only the typed "{{" trigger text for replacement, preserving surrounding literal text', async () => {
    // Composing a chip with surrounding literal text in the same field
    // ("Bearer {{token}}", "order-{{id}}") is a real, common need —
    // prefixing/suffixing a mapped value — so accepting the option must
    // only ever touch the `{{...` text you actually typed, never the rest
    // of the field. (The one trap this reopens — typing `{{` inside Raw
    // mode's leftover schema-example placeholder text without clearing it
    // first — is a copy-editing rough edge, not a correctness one:
    // utils/bodyTags.ts's `resolveTagsInValue` still resolves an embedded
    // tag correctly at request time regardless of mode.)
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);

    const doc = '{"auth": "Bearer "}';
    const cursor = doc.indexOf('Bearer ') + 'Bearer '.length; // right after "Bearer ", before the closing quote

    let reported: { type: string; from: number; to: number } | null = null;

    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: buildJsonAutocompleteExtensions((type, from, to) => {
          reported = { type, from, to };
        }),
      }),
      parent: wrapper,
    });

    function typeChar(ch: string) {
      const head = view.state.selection.main.head;
      view.dispatch({
        changes: { from: head, insert: ch },
        selection: { anchor: head + ch.length },
        annotations: Transaction.userEvent.of('input.type'),
      });
    }

    typeChar('{');
    typeChar('{');

    await waitFor(() => expect(completionStatus(view.state)).toBe('active'));
    // acceptCompletion no-ops for `interactionDelay` (75ms by default)
    // after the popup opens, to avoid an accidental accept-on-open.
    await waitFor(() => expect(acceptCompletion(view)).toBe(true));

    expect(reported).not.toBeNull();
    // The reported span covers only the two typed braces — "Bearer " (the
    // prefix already in the field) is left completely alone.
    expect(reported!.from).toBe(cursor);
    expect(reported!.to).toBe(cursor + 2);
    // Accepting the option is inert on its own — nothing is deleted until
    // a tag is actually confirmed (see RawBodyEditor's handleInsertConfirm).
    expect(view.state.doc.toString()).toBe('{"auth": "Bearer {{"}');

    view.destroy();
    wrapper.remove();
  });

  it('gives a pasted duplicate of an existing tag id its own independent, cloned tag instead of aliasing the original', () => {
    // Reproduces a reported bug: copy a tag chip, paste its placeholder
    // text into another field, then edit the "new" one's jsonPath — and
    // the *original* chip's jsonPath changed too. A chip's placeholder is
    // just plain document text to CodeMirror, so pasting it literally
    // duplicates the *reference*: both occurrences shared tag1's one
    // config, so editing "the pasted one" was really editing the shared
    // config. buildTagAutoCloneExtension is what fixes this — it must give
    // the pasted occurrence a fresh id and its own cloned config.
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);

    const originalTag: BodyTag = { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' };
    const tags: Record<string, BodyTag> = { tag1: originalTag };
    const clonedBatches: Record<string, BodyTag>[] = [];

    const view = new EditorView({
      state: EditorState.create({
        doc: '{"a":"{{enlace:tag1}}","b":""}',
        extensions: [
          json(),
          buildTagAutoCloneExtension(() => tags),
          EditorView.updateListener.of((update) => {
            for (const tr of update.transactions) {
              for (const effect of tr.effects) {
                if (effect.is(cloneTagsEffect)) clonedBatches.push(effect.value);
              }
            }
          }),
        ],
      }),
      parent: wrapper,
    });

    // Simulate pasting "{{enlace:tag1}}" into "b"'s empty string — a paste
    // reduces to the same insert-change transaction as typing (see the
    // typeChar helper elsewhere in this file), so dispatching one directly
    // is a faithful stand-in for the real paste event.
    const pasteAt = view.state.doc.toString().lastIndexOf('""') + 1;
    view.dispatch({
      changes: { from: pasteAt, insert: '{{enlace:tag1}}' },
      annotations: Transaction.userEvent.of('input.paste'),
    });

    const ids = [...view.state.doc.toString().matchAll(/\{\{enlace:([a-zA-Z0-9_-]+)\}\}/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('tag1'); // untouched occurrence keeps the original id
    expect(ids[1]).not.toBe('tag1'); // pasted occurrence got a fresh, independent id

    // The clone must actually be an independent copy of the original's
    // config (right type/source/path) — not just a different id with
    // nothing behind it.
    expect(clonedBatches).toHaveLength(1);
    const [clonedId, clonedTag] = Object.entries(clonedBatches[0])[0];
    expect(clonedId).toBe(ids[1]);
    expect(clonedTag).toEqual({ ...originalTag, id: clonedId });

    view.destroy();
    wrapper.remove();
  });

  it('does not clone a tag id typed or moved without ever being duplicated (only >1 occurrence triggers it)', () => {
    // Guards against false positives: a plain edit near an existing
    // placeholder, or a genuine single-occurrence tag, must never trigger
    // cloning — only an actual second occurrence of a known id should.
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);

    const tags: Record<string, BodyTag> = {
      tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' },
    };
    const clonedBatches: Record<string, BodyTag>[] = [];

    const view = new EditorView({
      state: EditorState.create({
        doc: '{"a":"{{enlace:tag1}}"}',
        extensions: [
          json(),
          buildTagAutoCloneExtension(() => tags),
          EditorView.updateListener.of((update) => {
            for (const tr of update.transactions) {
              for (const effect of tr.effects) {
                if (effect.is(cloneTagsEffect)) clonedBatches.push(effect.value);
              }
            }
          }),
        ],
      }),
      parent: wrapper,
    });

    // An unrelated edit elsewhere in the same doc (typing a character) —
    // still only one occurrence of tag1 afterward.
    view.dispatch({
      changes: { from: 1, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    });

    expect(view.state.doc.toString()).toBe('{x"a":"{{enlace:tag1}}"}');
    expect(clonedBatches).toHaveLength(0);

    view.destroy();
    wrapper.remove();
  });

  describe('readOnly', () => {
    it('makes the CodeMirror doc non-editable and rejects a programmatic edit transaction', async () => {
      const rawBody: RawBody = { template: '{"name":"widget"}', tags: {} };
      const { container } = render(
        <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} readOnly />
      );
      await waitFor(() => {
        expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
      });
    });

    it('is editable (the default) when readOnly is omitted', async () => {
      const rawBody: RawBody = { template: '{"name":"widget"}', tags: {} };
      const { container } = render(
        <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} />
      );
      await waitFor(() => {
        expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('true');
      });
    });

    it('reconfigures live when the readOnly prop flips, without tearing down the editor (e.g. losing the typed doc)', async () => {
      function Harness() {
        const [readOnly, setReadOnly] = useState(false);
        const rawBody: RawBody = { template: '{"name":"widget"}', tags: {} };
        return (
          <>
            <button onClick={() => setReadOnly((v) => !v)}>toggle</button>
            <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} nodeLabels={labelsFor([])} readOnly={readOnly} />
          </>
        );
      }
      const { container } = render(<Harness />);
      await waitFor(() => {
        expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('true');
      });

      fireEvent.click(screen.getByText('toggle'));
      await waitFor(() => {
        expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
      });
      // Same editor instance, same content — a reconfigure, not a remount.
      expect(container.querySelector('.cm-content')?.textContent).toContain('widget');
    });
  });
});
