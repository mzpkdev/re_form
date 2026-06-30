import type { ManifoldToplevel } from "manifold-3d"
import type * as THREE from "three"

/** Discriminated by `kind`; only the matching params field is populated. */
export type ShapeKind =
    | "plane"
    | "cylinder"
    | "sphere"
    | "cone"
    | "patch" // smooth region-grown surface, non-parametric (e.g. a fillet)
    | "body" // whole-solid grouping from Tier 1 (optional container)
    | "unknown" // leftover bucket — guarantees completeness

export interface PlaneParams {
    kind: "plane"
    normal: [number, number, number] // unit
    offset: number // d, with normal·x = offset
}
export interface CylinderParams {
    kind: "cylinder"
    axis: [number, number, number] // unit direction
    point: [number, number, number] // a point on the axis
    radius: number
    axialRange?: [number, number] // min/max inlier projection onto axis (extent)
}
export interface SphereParams {
    kind: "sphere"
    center: [number, number, number]
    radius: number
}
export interface ConeParams {
    kind: "cone"
    apex: [number, number, number]
    axis: [number, number, number] // unit, apex→base
    halfAngle: number // radians
    axialRange?: [number, number]
}
export type ShapeParams =
    | PlaneParams
    | CylinderParams
    | SphereParams
    | ConeParams
    | { kind: "patch" }
    | { kind: "body" }
    | { kind: "unknown" }

export interface ShapeGroup {
    id: string // stable uuid
    kind: ShapeKind
    label: string // user-editable ("Top face", "Bore Ø8")
    color: [number, number, number] // highlight rendering; assign distinct hues

    /** SOURCE OF TRUTH for membership; disjoint across groups; union = all faces. */
    triangleIndices: Int32Array

    params: ShapeParams // fitted primitive, or patch/body/unknown
    fitRms?: number // RMS point-to-surface distance over inliers
    inlierCount?: number
    bbox: { min: [number, number, number]; max: [number, number, number] }
    centroid?: [number, number, number]
    parentId?: string | null // body→feature hierarchy (optional)
}

export interface SegmentationParams {
    epsilon: number // distance inlier tolerance (absolute; derived from D)
    cosNormal: number // normal-deviation threshold, cos(α)
    minPoints: number // smallest acceptable primitive (inlier floor)
    probability: number // RANSAC miss-probability
    thetaCrease: number // sharp-edge dihedral threshold (rad)
    thetaGrow: number // region-grow smoothness threshold (rad)
    enabled: { plane: boolean; cylinder: boolean; sphere: boolean; cone: boolean }
    seed: number // RNG seed → deterministic results
}

export interface Segmentation {
    groups: ShapeGroup[]
    triangleCount: number // F; invariant: Σ group.triangleIndices.length === F
    params: SegmentationParams
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal pipeline types (not part of §5; consumed by mesh/sample/decompose/
// regionGrow/segment). The interop boundary stays three.js + manifold.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Welded, indexed mesh + flat per-face normals + face adjacency. Produced by
 * `weldAndAnalyze` (`mesh.ts`) and consumed by every downstream tier.
 *
 * ADJACENCY REPRESENTATION (chosen here; `mesh.ts`/M0.2 must implement exactly
 * this): `faceAdjacency` is an `Int32Array` of length `faceCount * 3`. The three
 * slots for face `f` live at `[3f, 3f+1, 3f+2]` and hold the neighbour face
 * index across each of the face's three edges, in the edge order
 * (v0→v1, v1→v2, v2→v0) where v0/v1/v2 are `triangles[3f .. 3f+2]`.
 *   • slot value `>= 0`  → the single face sharing that edge (manifold edge).
 *   • slot value `-1`    → boundary edge: 0 other faces share it (open border).
 *   • slot value `-2`    → non-manifold edge: >2 faces share it. Treated as a
 *                          HARD boundary (region growing/decompose must NOT cross
 *                          it). `mesh.ts` records the actual incident faces of
 *                          such edges in `nonManifoldEdges` for any consumer that
 *                          needs them; the adjacency slot itself stays `-2`.
 *
 * `dihedral(a, b)` returns the unsigned dihedral angle (radians, in `[0, π]`)
 * between the flat normals of faces `a` and `b` — `acos(clamp(nₐ·n_b, -1, 1))`.
 * Defined for any two faces (it only reads `faceNormals`); region growing calls
 * it on adjacent faces. Exposed as a method here so the topology is a single
 * self-contained handle; M0.2 may equivalently back it with a free `dihedral`
 * function as long as this method is present and behaves as documented.
 */
export interface MeshTopology {
    /** Welded vertex positions, xyz-interleaved. Length `vertexCount * 3`. */
    positions: Float32Array
    /** Indexed triangles, 3 vertex indices per face. Length `faceCount * 3`. */
    triangles: Uint32Array
    /** Flat per-face unit normals, xyz-interleaved. Length `faceCount * 3`. */
    faceNormals: Float32Array
    faceCount: number
    vertexCount: number
    /** Bounding-box diagonal length — the scale all tolerances are fractions of. */
    D: number
    /** Per-edge neighbour faces; see the type doc for the slot/sentinel scheme. */
    faceAdjacency: Int32Array
    /**
     * Edges shared by >2 faces, as a set of edge keys (`min(vi,vj)*V + max(vi,vj)`,
     * V = `vertexCount`). The matching `faceAdjacency` slots are `-2`. Empty for a
     * clean manifold mesh.
     */
    nonManifoldEdges: Set<number>
    /** Unsigned dihedral angle (radians) between two faces' flat normals. */
    dihedral: (faceA: number, faceB: number) => number
}

/**
 * Oriented point cloud sampled off a `MeshTopology` (`sample.ts`). One or more
 * points per face, each carrying the exact flat face normal. `pointToTri` is the
 * backmap from point index → source triangle index (always in `[0, faceCount)`).
 */
export interface OrientedCloud {
    /** Point positions, xyz-interleaved. Length `pointCount * 3`. */
    position: Float32Array
    /** Per-point unit normals (the source face normal), xyz-interleaved. */
    normal: Float32Array
    /** point index → source triangle index; every entry in `[0, faceCount)`. */
    pointToTri: Int32Array
}

/**
 * Result of one region-growing pass (`regionGrow.ts`): the grown patches as
 * arrays of triangle indices, plus the triangles left unlabelled. `patches` and
 * `remaining` are disjoint and together cover the faces that were `-1` on entry.
 */
export interface RegionResult {
    patches: Int32Array[]
    remaining: Int32Array
}

/**
 * Input to the top-level `segment` orchestrator (`segment.ts`). `wasm` is the
 * memoized manifold singleton (optional — Tier 1 decompose needs it; the
 * non-manifold fallback and Tiers 2–3 do not). `tiers` flips which stages run.
 */
export interface SegmentInput {
    geometry: THREE.BufferGeometry
    wasm?: ManifoldToplevel
    params: SegmentationParams
    tiers: { bodies: boolean; regions: boolean; primitives: boolean }
}
