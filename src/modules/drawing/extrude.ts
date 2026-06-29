import type { Manifold, ManifoldToplevel } from "manifold-3d"
import { projectPoint, unprojectPoint } from "./project"
import { detectRegions } from "./regions"
import type { Drawing, Plane, Polyline, Vec2, Vec3 } from "./types"

/**
 * The 2D-drawing → 3D-solid bridge: turn a closed profile drawn on a principal
 * plane into a manifold solid, oriented so the solid's base coincides with the
 * drawn profile and it extrudes along the plane's +normal.
 *
 * v1 SIMPLIFICATION (matching `project.ts`): the principal planes pass through
 * the origin, so the orienting transforms are pure rotations about the origin.
 * That is what lets a local extruded point `(u, v, w)` land exactly at
 * `unprojectPoint([u, v], plane) + w * planeNormal(plane)`. React-free domain
 * logic — `Manifold` is the interop boundary, and the caller owns the result.
 */

/** Coordinate-equality tolerance for deciding which plane a profile lies on. */
const PLANE_EPSILON = 1e-6

/** Shoelace signed area of a closed 2D contour; negative means clockwise. */
const signedArea = (pts: Vec2[]): number => {
    let area = 0
    for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]
        const [x2, y2] = pts[(i + 1) % pts.length]
        area += x1 * y2 - x2 * y1
    }
    return area / 2
}

/**
 * The principal plane a profile lies on, or `null` when it is not flat against
 * any of them (skew, or off the origin-plane in the off-axis coordinate). v1
 * planes pass through the origin, so "lies on plane" means the off-plane
 * coordinate is ~0 for every point: front → all |z| < ε, top → all |y| < ε,
 * side → all |x| < ε. Front is checked first, so a profile on an axis shared by
 * two planes (e.g. a line on the x-axis, where both z and y are 0) resolves to
 * the plane whose in-view axes keep its extent — for a real ≥3-point profile the
 * three tests are mutually exclusive.
 */
export const inferPlane = (points: Vec3[]): Plane | null => {
    if (points.every(([, , z]) => Math.abs(z) < PLANE_EPSILON)) {
        return "front"
    }
    if (points.every(([, y]) => Math.abs(y) < PLANE_EPSILON)) {
        return "top"
    }
    if (points.every(([x]) => Math.abs(x) < PLANE_EPSILON)) {
        return "side"
    }
    return null
}

/**
 * Extrude a closed profile into a solid `depthMm` deep along the plane's normal.
 *
 * Projects the profile's 3D points to the plane's 2D view space, builds a
 * `CrossSection` from that single contour, extrudes it (base at z=0, growing
 * +z), then rotates so the result sits where it was drawn:
 *   - front → identity (the drawing plane already is z=0, extruding +z)
 *   - top   → rotate [-90, 0, 0] (local +z → world +y)
 *   - side  → rotate [0, 90, 0]  (local +z → world +x)
 *
 * Every intermediate handle (the `CrossSection`, the pre-rotation `Manifold`) is
 * freed; only the final `Manifold` is returned and the caller owns it. Throws on
 * a non-closed profile, fewer than 3 points, or a non-positive depth; manifold
 * itself throws on a self-intersecting/degenerate contour.
 */
export const profileToManifold = (
    wasm: ManifoldToplevel,
    profile: Polyline,
    plane: Plane,
    depthMm: number
): Manifold => {
    if (!profile.closed) {
        throw new Error("Profile must be a closed polyline to extrude.")
    }
    if (profile.points.length < 3) {
        throw new Error("Profile must have at least 3 points to extrude.")
    }
    if (!(depthMm > 0)) {
        throw new Error("Extrude depth must be greater than 0.")
    }

    const contour = profile.points.map((p) => projectPoint(p, plane))
    // A clockwise contour has negative signed area, which the default "Positive"
    // fill rule drops to an empty cross-section. Normalize to counter-clockwise so
    // a profile drawn in either direction yields a solid.
    if (signedArea(contour) < 0) {
        contour.reverse()
    }
    const cross = new wasm.CrossSection(contour)
    const solid = cross.extrude(depthMm)
    cross.delete()

    switch (plane) {
        case "front":
            return solid
        case "top": {
            const rotated = solid.rotate([-90, 0, 0])
            solid.delete()
            return rotated
        }
        case "side": {
            const rotated = solid.rotate([0, 90, 0])
            solid.delete()
            return rotated
        }
    }
}

/**
 * Build the 3D solid DERIVED from a whole drawing: detect every closed region
 * (connected-segment loops, see `detectRegions`), extrude each by
 * `doc.extrudeDepth` along its plane's normal, and UNION them into a single solid.
 *
 * Each region's contour is lifted from its plane's 2D view space back to a 3D
 * closed `Polyline` (so `profileToManifold` re-projects it consistently) before
 * extrusion. Every per-region handle and every intermediate union result is
 * freed; only the final unioned `Manifold` survives and the CALLER owns it.
 * Returns `null` when the drawing has no closed region (so the caller can leave an
 * imported solid untouched). React-free — `Manifold` is the interop boundary.
 */
export const drawingToManifold = (wasm: ManifoldToplevel, doc: Drawing): Manifold | null => {
    const regions = detectRegions(doc)
    if (regions.length === 0) {
        return null
    }

    const solids = regions.map(({ plane, contour }) => {
        const profile: Polyline = {
            id: "region",
            type: "polyline",
            closed: true,
            points: contour.map((p) => unprojectPoint(p, plane))
        }
        return profileToManifold(wasm, profile, plane, doc.extrudeDepth)
    })

    // Reduce the per-region solids into one via boolean union, freeing both inputs
    // of each union (the running accumulator and the next solid) once consumed, so
    // only the final handle remains live.
    let result = solids[0]
    for (let i = 1; i < solids.length; i++) {
        const next = solids[i]
        const merged = result.add(next)
        result.delete()
        next.delete()
        result = merged
    }
    return result
}
