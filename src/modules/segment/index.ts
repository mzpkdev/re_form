// Segment: split an imported CAD-like STL into selectable shape groups (bodies →
// faces → primitives) and export them. The React-free pipeline core (weld +
// adjacency, sampling, body decomposition, region growing, orchestration) lives
// alongside a thin reactive state layer (`groupsStore` for the current groups,
// `selectionStore` for the ephemeral selection). This barrel is the module's
// public entry. UI surface (`SegmentPanel`, `useSegmentation`) is added by later
// milestones; only what exists today is re-exported.

// Groups store: the current ShapeGroup[] + delete-on-replace discipline. Its
// actions are the public mutation API for grouping state.
export { getGroups, setGroups, useGroups, useGroupsVersion } from "./groupsStore"
// Panel shell: the app-shell entry point for the segment feature.
export { SegmentPanel } from "./SegmentPanel"
// Forked 3D viewport: renders one selectable mesh per ShapeGroup from the stores.
export { SegmentViewport } from "./SegmentViewport"
// Top-level orchestrator: geometry + params → Segmentation.
export { segment } from "./segment"
// Selection store: ephemeral, never-serialized selected group ids.
export { clearSelection, getSelection, setSelection, useSelection } from "./selectionStore"
// Data model (§5) + internal pipeline types.
export type {
    ConeParams,
    CylinderParams,
    MeshTopology,
    OrientedCloud,
    PlaneParams,
    RegionResult,
    Segmentation,
    SegmentationParams,
    SegmentInput,
    ShapeGroup,
    ShapeKind,
    ShapeParams,
    SphereParams
} from "./types"
// Async seam: on-demand mutation that runs the pipeline and publishes groups.
export { defaultParams, useSegmentation } from "./useSegmentation"
