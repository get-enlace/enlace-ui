/**
 * Group by UI surface, not by tech type.
 * Surfaces: Canvas/, Chrome/, Credentials/, DebugPane/, NodeConfig/, Operations/;
 * App imports via this barrel only.
 * Siblings inside a surface import each other directly (avoid barrel cycles).
 * Shared primitives (Modal, chromeIcons) stay at this folder root.
 */
export { Canvas } from './Canvas/index.js';
export { ChromeSettingsMenu, RunControls, WorkflowSwitcher } from './Chrome/index.js';
export { DebugPane } from './DebugPane/index.js';
export { NodeConfig, NodeConfigShell, NODE_CONFIG_DEFAULT_WIDTH } from './NodeConfig/index.js';
export { OperationList } from './Operations/index.js';
