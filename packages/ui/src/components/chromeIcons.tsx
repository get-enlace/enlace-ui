import type { RunStepStatus } from '../types.js';

/**
 * Run-status glyphs shared by canvas badges, collapsed groups, and Results.
 * Failed is `!`, not an `×`/`✕` — nude delete chrome already uses `×`, so
 * a red X badge would read as a second cancel affordance.
 */
export const RUN_STATUS_GLYPH: Record<RunStepStatus, string> = {
  pending: '○',
  'in-flight': '●',
  paused: '⏸',
  completed: '✓',
  failed: '!',
  skipped: '–',
};

/** Canvas corner badges — only statuses worth calling out at a glance. */
export const STATUS_BADGE_GLYPH: Partial<Record<RunStepStatus, string>> = {
  'in-flight': RUN_STATUS_GLYPH['in-flight'],
  paused: RUN_STATUS_GLYPH.paused,
  completed: RUN_STATUS_GLYPH.completed,
  failed: RUN_STATUS_GLYPH.failed,
};

/** Nude corner chrome — same 10×10 stroke weight for leave-group and delete. */
export function LeaveGroupIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2 2h4v6H2M6 5h3M7.5 3.5 9 5 7.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeleteNodeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2.5 2.5 7.5 7.5M7.5 2.5 2.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
