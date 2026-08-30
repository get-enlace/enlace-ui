import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunControls } from './RunControls.js';

const idleProps = {
  isRunning: false,
  isDebugRun: false,
  pausedCount: 0,
  canStep: false,
  onRun: vi.fn(),
  onDebug: vi.fn(),
  onContinue: vi.fn(),
  onStep: vi.fn(),
  onStop: vi.fn(),
  stepTitle: 'Step',
};

describe('RunControls', () => {
  it('renders Run and Debug as a single segmented group', () => {
    render(<RunControls {...idleProps} />);
    expect(screen.getByRole('group', { name: 'Run controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Debug' })).toBeInTheDocument();
  });

  it('keeps Run and Debug as separate actions', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const onDebug = vi.fn();
    render(<RunControls {...idleProps} onRun={onRun} onDebug={onDebug} />);

    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onDebug).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Debug' }));
    expect(onDebug).toHaveBeenCalledTimes(1);
  });

  it('shows spinner + Stop while a plain run is in progress', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<RunControls {...idleProps} isRunning onStop={onStop} />);

    expect(screen.getByRole('group', { name: 'Run in progress' })).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Debug' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('swaps to Continue / Step / Stop while debugging', () => {
    render(<RunControls {...idleProps} isRunning isDebugRun pausedCount={1} canStep />);
    expect(screen.getByRole('group', { name: 'Debug controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
  });

  it('uses the same run-segment shell across idle, running, and debug modes', () => {
    const { rerender } = render(<RunControls {...idleProps} />);
    expect(screen.getByRole('group')).toHaveClass('run-segment');

    rerender(<RunControls {...idleProps} isRunning />);
    expect(screen.getByRole('group')).toHaveClass('run-segment');

    rerender(<RunControls {...idleProps} isRunning isDebugRun pausedCount={1} canStep />);
    expect(screen.getByRole('group')).toHaveClass('run-segment');
  });
});
