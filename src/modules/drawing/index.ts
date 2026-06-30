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
    subscribe,
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
// Extrude bridge: pure 2D-profile → 3D-solid (manifold) construction, plus the
// whole-drawing derived solid (each populated plane as an orthographic view,
// silhouettes extruded into bars and intersected).
export { drawingToManifold, extrudeProfileBetween, inferPlane } from "./extrude"
// File I/O UI: export/import the 2D drawing document as JSON.
export { FileControl } from "./FileControl"
export { GridControl } from "./GridControl"
// Pure pointer-vs-entity hit testing: click-pick (`hitTest`) and marquee
// box-select (`entitiesInBox`) — the testable cores of selection.
export { type Box, entitiesInBox, hitTest } from "./hitTest"
export { PlaneSwitcher } from "./PlaneSwitcher"
// Persistence: localStorage autosave + hydrate-once for the drawing document.
export { initPersistence, loadStoredDrawing, STORAGE_KEY, saveDrawing } from "./persistence"
export { flattenEntity, planeNormal, projectPoint, tessellateEntity, unprojectPoint } from "./project"
// Pure closed-region detection: connected-segment loops → contours per plane,
// plus the inverse — line/polyline entities that bound no region and so break
// the 3D reconstruction.
export { detectBrokenEntities, detectRegions } from "./regions"
export { deserialize, serialize } from "./serialize"
export { constrainToAngle, snapToGrid } from "./snap"
export { Toolbar } from "./Toolbar"
export type { Arc, Circle, Drawing, Entity, Line, Plane, Polyline, Vec2, Vec3 } from "./types"
export { newId } from "./types"
export { useDrawTool } from "./useDrawTool"
// Keymap: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z (and Ctrl+Y) redo — guarded so text
// inputs keep native editing.
export { useUndoRedoKeymap } from "./useUndoRedoKeymap"
