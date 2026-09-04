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

/**
 * The other icon family in the app — bigger buttons (credential cards, the
 * node inspector), 24×24 viewBox rendered at 14×14, 2px stroke,
 * `currentColor` throughout so each follows whatever text color its button
 * already has. Shared here (rather than defined per-file, which is how
 * CredentialCard.tsx/CredentialTypeFields.tsx/NodeConfig.tsx used to each
 * have their own copies — TrashIcon existed twice, with two different
 * paths) so every consumer draws the exact same glyph for the same concept.
 */
export function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

/** Stroked lock — same outline style as the eye icons above. */
export function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
