import { create } from 'zustand';
import type { WorkflowState } from './types.js';
import { createCredentialsSlice } from './slices/credentialsSlice.js';
import { createDocumentSlice } from './slices/documentSlice.js';
import { createGraphSlice } from './slices/graphSlice.js';
import { createRunSlice } from './slices/runSlice.js';
import { createSpecSlice } from './slices/specSlice.js';

export type { Position, CredentialReview, WorkflowState } from './types.js';
export { uploadedFileKey } from './types.js';

export const useWorkflowStore = create<WorkflowState>()((...a) => ({
  ...createSpecSlice(...a),
  ...createGraphSlice(...a),
  ...createCredentialsSlice(...a),
  ...createRunSlice(...a),
  ...createDocumentSlice(...a),
}));
