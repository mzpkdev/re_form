// Drawing: the 2D technical-drawing editor module. The pure, React-free domain
// core (schema, immutable document ops, projection/tessellation, JSON
// round-trip) lives alongside a thin reactive state layer (`documentStore` for
// the serialized doc + undo/redo, `editorStore` for ephemeral editor state).
// This barrel is the module's public entry — the mutation API is the STORE
// actions, not the raw pure ops. No UI or three.js here.

// Pure entity construction from drawn points (the testable core of the write
// path) and the interaction state machine that drives it.
export { buildEntity } from "./buildEntity"
// UI: the mountable editor view, the SVG canvas, and the tool palette.
export { DrawingCanvas } from "./DrawingCanvas"
export { DrawingEditor } from "./DrawingEditor"
// Pure document construction/query that remains public (the mutating ops are
// re-exported from the store above instead).
export { createDrawing, getEntity } from "./document"
// Document store: serialized doc + undo/redo. Its actions ARE the public
// mutation API, so `addEntity`/`updateEntity`/`removeEntity`/`removeEntities`
// here are the single-arg store actions, not the raw pure ops of the same name.
export {
    addEntity,
    canRedo,
    canUndo,
    commit,
    getDrawing,
    loadDrawing,
    newDrawing,
    redo,
    removeEntities,
    removeEntity,
    setGridSize,
    undo,
    updateEntity,
    useDrawing,
    useGridSize,
    useHistory
} from "./documentStore"
// Editor store: ephemeral, never-serialized editor state.
export {
    clearSelection,
    getActivePlane,
    getActiveTool,
    getPreview,
    getSelection,
    setActivePlane,
    setActiveTool,
    setPreview,
    setSelection,
    type Tool,
    useActivePlane,
    useActiveTool,
    usePreview,
    useSelection
} from "./editorStore"
export { GridControl } from "./GridControl"
// Pure pointer-vs-entity hit testing (the testable core of click selection).
export { hitTest } from "./hitTest"
export { PlaneSwitcher } from "./PlaneSwitcher"
export { flattenEntity, planeNormal, projectPoint, tessellateEntity, unprojectPoint } from "./project"
export { deserialize, serialize } from "./serialize"
export { constrainToAngle, snapToGrid } from "./snap"
export { Toolbar } from "./Toolbar"
export type { Arc, Circle, Drawing, Entity, Line, Plane, Polyline, Vec2, Vec3 } from "./types"
export { newId } from "./types"
export { useDrawTool } from "./useDrawTool"
