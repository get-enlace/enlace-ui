import type { StateCreator } from 'zustand';
import { connectionKey, executeChain } from '@get-enlace/core';
import { referencedIncompleteCredentials } from '../../utils/workflowDocument.js';
import type { RunControl, RunResult, RunStepRequest, RunStepStatus } from '../../types.js';
import { isLocked, type WorkflowState } from '../types.js';

export interface RunSlice {
  runResult: RunResult | null;
  stepStatusByNodeId: Record<string, RunStepStatus>;
  armedBreakpoints: Set<string>;
  previewRequestByNodeId: Record<string, RunStepRequest>;
  activeControl: RunControl | null;
  isRunning: boolean;
  isDebugRun: boolean;
  debugConsoleOpen: boolean;
  error: string | null;
  toggleBreakpoint: (fromNodeId: string, toNodeId: string) => void;
  continueExecution: () => void;
  stepNode: (nodeId: string) => void;
  stopExecution: () => void;
  clearResults: () => void;
  run: (options?: { useBreakpoints?: boolean }) => Promise<void>;
}

export const createRunSlice: StateCreator<WorkflowState, [], [], RunSlice> = (set, get) => ({
  runResult: null,
  stepStatusByNodeId: {},
  armedBreakpoints: new Set(),
  previewRequestByNodeId: {},
  activeControl: null,
  isRunning: false,
  isDebugRun: false,
  debugConsoleOpen: false,
  error: null,

  toggleBreakpoint: (fromNodeId, toNodeId) =>
    set((state) => {
      if (isLocked(state)) return state;
      const key = connectionKey(fromNodeId, toNodeId);
      const armedBreakpoints = new Set(state.armedBreakpoints);
      if (armedBreakpoints.has(key)) armedBreakpoints.delete(key);
      else armedBreakpoints.add(key);
      return { armedBreakpoints };
    }),

  continueExecution: () => get().activeControl?.continue(),
  stepNode: (nodeId) => get().activeControl?.step(nodeId),
  stopExecution: () => get().activeControl?.stop(),

  clearResults: () => {
    if (get().isRunning) return;
    set({
      // Keep runResult — TagConfigModal / mapping chips still need last responses.
      stepStatusByNodeId: {},
      previewRequestByNodeId: {},
      error: null,
      debugConsoleOpen: false,
    });
  },

  run: async (options) => {
    const useBreakpoints = options?.useBreakpoints ?? false;
    const { nodes, armedBreakpoints, credentials } = get();
    const incomplete = referencedIncompleteCredentials(nodes, credentials);
    if (incomplete.length > 0) {
      const names = incomplete.map((c) => `"${c.name}"`).join(', ');
      set({
        error:
          incomplete.length === 1
            ? `Credential ${names} needs a secret before this chain can run.`
            : `Credentials ${names} need a secret before this chain can run.`,
      });
      return;
    }

    set({
      isRunning: true,
      isDebugRun: useBreakpoints,
      // Debug opens the REPL; a plain Run closes any leftover debug console.
      debugConsoleOpen: useBreakpoints,
      error: null,
      runResult: { steps: [] },
      stepStatusByNodeId: nodes.reduce<Record<string, RunStepStatus>>((acc, n) => {
        acc[n.id] = 'pending';
        return acc;
      }, {}),
      // Cleared here, not in the `finally` below — a paused/skipped node's
      // preview, and the statuses above, are meant to survive right up
      // until the *next* run starts (real review value on their own), not
      // just until this run happens to finish. Only activeControl resets
      // on completion (below): it's a live handle into a call that's now
      // over, not session state worth keeping around.
      previewRequestByNodeId: {},
      // activeControl deliberately NOT cleared here — it's re-set once
      // executeChain's onControl fires, a moment after this.
    });
    try {
      const { connections, operations, credentials, baseUrl, uploadedFiles } = get();
      if (!baseUrl) {
        throw new Error('Could not determine a target base URL — add a `servers` entry to the OpenAPI spec.');
      }
      const operationsById = new Map(operations.map((o) => [o.id, o]));
      const credentialsById = new Map(credentials.map((c) => [c.id, c]));
      const result = await executeChain({ nodes, connections }, operationsById, credentialsById, {
        baseUrl,
        uploadedFiles,
        // Streams progress into the store as each node settles, instead of
        // only setting `runResult` once at the very end — see
        // components/DebugPane/, which renders `runResult.steps` live.
        onEvent: (event) => {
          set((state) => ({
            stepStatusByNodeId: { ...state.stepStatusByNodeId, [event.nodeId]: event.status },
            runResult: event.step
              ? { steps: [...(state.runResult?.steps ?? []), event.step] }
              : state.runResult,
            previewRequestByNodeId: event.request
              ? { ...state.previewRequestByNodeId, [event.nodeId]: event.request }
              : state.previewRequestByNodeId,
          }));
        },
        // Always capture RunControl so Stop works for plain Run and Debug.
        // Breakpoints are only snapshotted for Debug — a plain Run never
        // pauses, so Continue/Step stay unused (chrome uses isDebugRun to
        // pick spinner+Stop vs Continue/Step/Stop).
        onControl: (control) => set({ activeControl: control }),
        ...(useBreakpoints
          ? {
              // Snapshotted at the start of this run — arming/disarming a
              // breakpoint mid-run has no effect on a run already in
              // progress (see ChainExecutorOptions.armedBreakpoints's own
              // doc comment).
              armedBreakpoints: new Set(armedBreakpoints),
            }
          : {}),
      });
      set({ runResult: result });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isRunning: false, isDebugRun: false, activeControl: null, debugConsoleOpen: false });
    }
  },
});
