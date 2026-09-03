import type { StateCreator } from 'zustand';
import { hydrateCollection } from '../../utils/workflowDocument.js';
import type { EnlaceCollection } from '../../types.js';
import { isLocked, type WorkflowState } from '../types.js';

export interface DocumentSlice {
  workflowName: string;
  replaceWorkflow: (collection: EnlaceCollection) => void;
  setWorkflowName: (name: string) => void;
}

export const createDocumentSlice: StateCreator<WorkflowState, [], [], DocumentSlice> = (set, get) => ({
  workflowName: 'Untitled',

  replaceWorkflow: (collection) => {
    if (isLocked(get())) return;
    const next = hydrateCollection(collection);
    const workflowName =
      collection.workflows[0]?.name?.trim() || collection.name?.trim() || 'Untitled';
    set({
      nodes: next.nodes,
      connections: next.connections,
      nodePositions: next.nodePositions,
      groups: next.groups,
      credentials: next.credentials,
      uploadedFiles: {},
      workflowName,
      selectedNodeId: null,
      runResult: null,
      stepStatusByNodeId: {},
      armedBreakpoints: new Set(),
      previewRequestByNodeId: {},
      activeControl: null,
      isDebugRun: false,
      debugConsoleOpen: false,
      error: null,
      credentialReview: null,
    });
  },

  setWorkflowName: (name) => set({ workflowName: name.trim() || 'Untitled' }),
});
