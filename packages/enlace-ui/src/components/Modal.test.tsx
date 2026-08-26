import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal.js';

describe('Modal', () => {
  it('renders its title and children', () => {
    render(
      <Modal title="Configure tag" onClose={() => {}}>
        <p>body content</p>
      </Modal>
    );
    expect(screen.getByText('Configure tag')).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Configure tag" onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked but not when the panel itself is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Configure tag" onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog.parentElement!); // the backdrop itself
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Configure tag" onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
