/**
 * Group by UI surface, not by tech type.
 * Example: bottom pane → components/DebugPane/ (shell + Results + Console).
 * Later slices: Canvas/, Credentials/, Inspector/ the same way.
 * App imports only the surface entry via components/index.ts.
 */
export { Canvas } from './Canvas/index.js';
export { ChromeSettingsMenu } from './ChromeSettingsMenu.js';
export { DebugPane } from './DebugPane/index.js';
export { InspectorShell, INSPECTOR_DEFAULT_WIDTH } from './InspectorShell.js';
export { NodeInspector } from './NodeInspector.js';
export { OperationList } from './OperationList.js';
export { RunControls } from './RunControls.js';
export { WorkflowSwitcher } from './WorkflowSwitcher.js';
