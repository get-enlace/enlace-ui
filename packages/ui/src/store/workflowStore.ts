import { create } from 'zustand';
import type { WorkflowState } from './types.js';
import { createAiSlice } from './slices/aiSlice.js';
import { createCredentialsSlice } from './slices/credentialsSlice.js';
import { createDocumentSlice } from './slices/documentSlice.js';
import { createGraphSlice } from './slices/graphSlice.js';
import { createRunSlice } from './slices/runSlice.js';
import { createSpecSlice } from './slices/specSlice.js';

export type { Position, CredentialReview, WorkflowState } from './types.js';
export { uploadedFileKey } from './types.js';
export { aiSuggestionKey } from './slices/aiSlice.js';
export type { AiSuggestionEntry } from './slices/aiSlice.js';

export const useWorkflowStore = create<WorkflowState>()((...a) => ({
  ...createSpecSlice(...a),
  ...createGraphSlice(...a),
  ...createCredentialsSlice(...a),
  ...createRunSlice(...a),
  ...createDocumentSlice(...a),
  ...createAiSlice(...a),
}));
