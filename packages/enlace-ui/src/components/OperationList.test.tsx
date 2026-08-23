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

  describe('search', () => {
    const operations = [
      makeOperation({ id: 'POST /pet', operationId: 'addPet' }),
      makeOperation({ id: 'GET /pet/{id}', operationId: 'getPetById' }),
      // No operationId at all — can never match a search, per the
      // operationId-only scope of this first pass.
      makeOperation({ id: 'DELETE /pet/{id}', operationId: undefined }),
    ];

    it('shows every operation when the search box is empty', () => {
      render(<OperationList operations={operations} />);
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('filters by a case-insensitive operationId substring', () => {
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations by operationId'), {
        target: { value: 'PET' },
      });

      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByText('addPet')).toBeInTheDocument();
      expect(screen.getByText('getPetById')).toBeInTheDocument();
    });

    it('narrows further on a more specific query', () => {
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations by operationId'), {
        target: { value: 'addPet' },
      });

      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('addPet')).toBeInTheDocument();
    });

    it('shows an empty-state message, not an empty list, when nothing matches', () => {
      render(<OperationList operations={operations} />);

      fireEvent.change(screen.getByLabelText('Search operations by operationId'), {
        target: { value: 'nonexistent' },
      });

      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      expect(screen.getByText('No operations match "nonexistent".')).toBeInTheDocument();
    });
  });
});
