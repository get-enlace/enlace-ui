import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperationList } from './OperationList.js';
import type { Operation } from '../types.js';

function makeOperation(overrides: Partial<Operation>): Operation {
  return {
    id: 'GET /pet',
    method: 'get',
    path: '/pet',
    parameters: [],
    requestBodySchema: null,
    responseSchema: null,
    ...overrides,
  };
}

describe('OperationList', () => {
  it('renders each operation\'s method and path', () => {
    render(
      <OperationList
        operations={[
          makeOperation({ id: 'GET /pet', method: 'get', path: '/pet' }),
          makeOperation({ id: 'POST /pet', method: 'post', path: '/pet' }),
        ]}
      />
    );

    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getAllByText('/pet')).toHaveLength(2);
  });

  it('shows the operationId as a legend when the spec declares one, omits it otherwise', () => {
    render(
      <OperationList
        operations={[
          makeOperation({ id: 'POST /pet', operationId: 'addPet' }),
          makeOperation({ id: 'GET /pet/{id}', operationId: undefined }),
        ]}
      />
    );

    expect(screen.getByText('addPet')).toBeInTheDocument();
    // No operationId means no <legend> at all — not an empty one.
    expect(document.querySelectorAll('legend')).toHaveLength(1);
  });

  it('sets the operation id as drag data on dragstart, so Canvas can read it on drop', () => {
    render(<OperationList operations={[makeOperation({ id: 'POST /pet' })]} />);

    const item = screen.getByText('/pet').closest('li')!;
    const dataTransfer = { setData: vi.fn() };
    fireEvent.dragStart(item, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/operation-id', 'POST /pet');
  });
});
