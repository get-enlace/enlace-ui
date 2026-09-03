/**
 * Group by UI surface, not by tech type.
 * Surfaces: Canvas/, DebugPane/, Inspector/; App imports via this barrel only.
 * Siblings inside a surface import each other directly (avoid barrel cycles).
 */
export { Canvas } from './Canvas/index.js';
export { ChromeSettingsMenu } from './ChromeSettingsMenu.js';
export { DebugPane } from './DebugPane/index.js';
export { InspectorShell, INSPECTOR_DEFAULT_WIDTH, NodeInspector } from './Inspector/index.js';
export { OperationList } from './OperationList.js';
export { RunControls } from './RunControls.js';
export { WorkflowSwitcher } from './WorkflowSwitcher.js';
