import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { RawBodyEditor, buildJsonAutocompleteExtensions } from './RawBodyEditor.js';
import type { Operation, RawBody, WorkflowNode } from '../types.js';

function node(id: string, operationId: string): WorkflowNode {
  return { id, operationId, credentialId: null, fieldValues: {} };
}

const ops: Operation[] = [
  { id: 'GET /orders/{id}', method: 'get', path: '/orders/{id}', parameters: [], requestBodySchema: null, responseSchema: null },
];

describe('RawBodyEditor', () => {
  it('renders the initial template text inside the CodeMirror doc', async () => {
    const rawBody: RawBody = { template: '{"name":"widget"}', tags: {} };
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} operations={ops} />
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
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[a]} operations={ops} />
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
      return <RawBodyEditor rawBody={rawBody} onChange={setRawBody} ancestorNodes={[validNode]} operations={ops} />;
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
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} operations={ops} />
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
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} operations={ops} />
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
      <RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[a]} operations={ops} />
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

  it('deletes the chip and its tag when "Remove mapping" is confirmed', async () => {
    const a = node('node-a', 'GET /orders/{id}');
    const rawBody: RawBody = {
      template: '{"name":"{{enlace:tag1}}"}',
      tags: { tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'item.title' } },
    };
    const onChange = vi.fn();
    const { container } = render(
      <RawBodyEditor rawBody={rawBody} onChange={onChange} ancestorNodes={[a]} operations={ops} />
    );
    const chip = await waitFor(() => {
      const el = container.querySelector('.tag-chip');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(chip);
    fireEvent.click(await screen.findByText('Remove mapping'));

    expect(onChange).toHaveBeenCalledWith({ template: '{"name":""}', tags: {} });
  });

  it('activates CodeMirror\'s dark theme facet, so the base theme\'s caret is visible against our dark background', async () => {
    // Regression test for a real bug: CodeMirror defaults to its *light*
    // base theme (caret-color: black) unless told otherwise. Our CSS
    // paints this editor with a near-black background to match the app's
    // dark palette, so an un-flipped editor has a black-on-black,
    // effectively invisible caret — it blinks, it's just never seen.
    const rawBody: RawBody = { template: '{"a":1}', tags: {} };
    const { container } = render(<RawBodyEditor rawBody={rawBody} onChange={() => {}} ancestorNodes={[]} operations={ops} />);
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
});
