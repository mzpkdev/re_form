import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d"
import { unprojectPoint } from "./project"
import { detectRegions } from "./regions"
import type { Drawing, Plane, Vec2, Vec3 } from "./types"

/**
 * The 2D-drawing → 3D-solid bridge, by orthographic-VIEW reconstruction.
 *
 * Each principal plane is treated as an orthographic VIEW: a view's silhouette,
 * extruded along that view's normal across the whole part, is a "bar" (a square
 * tube for a square silhouette). The solid is the INTERSECTION of every view's
 * bar — the region that lies inside all the drawn silhouettes at once. This is
 * classic three-view reconstruction: the intersection is the maximal solid whose
 * orthographic silhouettes match the drawings (three 2×2 squares on
 * front/top/side ⇒ a 2×2×2 cube). At least two distinct views are required; a
 * single silhouette cannot bound the third axis, so it yields no solid.
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

/** The world-axis index the local +z extrusion direction maps to, per plane. */
const normalAxis = (plane: Plane): 0 | 1 | 2 => {
    switch (plane) {
        case "front":
            return 2 // +z
        case "top":
            return 1 // +y
        case "side":
            return 0 // +x
    }
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
 * Orient a locally-extruded solid (base at local z=0, growing +z) onto its
 * plane so its extrusion runs along the plane's normal, freeing the input:
 *   - front → identity (the drawing plane already is z=0, extruding +z)
 *   - top   → rotate [-90, 0, 0] (local +z → world +y)
 *   - side  → rotate [0, 90, 0]  (local +z → world +x)
 */
const orientToPlane = (local: Manifold, plane: Plane): Manifold => {
    switch (plane) {
        case "front":
            return local
        case "top": {
            const rotated = local.rotate([-90, 0, 0])
            local.delete()
            return rotated
        }
        case "side": {
            const rotated = local.rotate([0, 90, 0])
            local.delete()
            return rotated
        }
    }
}

/**
 * Extrude a closed 2D view-space contour into a solid that spans the world
 * interval `[lo, hi]` along its plane's normal.
 *
 * Normalizes the contour's winding to counter-clockwise (a clockwise contour has
 * negative signed area, which the default "Positive" fill rule drops to an empty
 * cross-section), builds a `CrossSection`, extrudes it `hi - lo` deep (base at
 * local z=0, growing +z), shifts it to start at local z=`lo`, then orients it
 * onto the plane (see `orientToPlane`). So a local point `(u, v, w)` lands at
 * `unprojectPoint([u, v], plane) + w * planeNormal(plane)`, and `w ∈ [lo, hi]`
 * becomes the world span along the normal axis.
 *
 * Every intermediate handle (the `CrossSection`, the pre-translate/pre-rotate
 * `Manifold`s) is freed; only the final `Manifold` is returned and the caller
 * owns it. Throws on fewer than 3 points or a non-positive span; manifold itself
 * throws on a self-intersecting/degenerate contour.
 */
export const extrudeProfileBetween = (
    wasm: ManifoldToplevel,
    contour2D: Vec2[],
    plane: Plane,
    lo: number,
    hi: number
): Manifold => {
    if (contour2D.length < 3) {
        throw new Error("Profile must have at least 3 points to extrude.")
    }
    if (!(hi > lo)) {
        throw new Error("Extrude span must have hi greater than lo.")
    }

    const cross = new wasm.CrossSection(normalizeWinding(contour2D))
    const extruded = cross.extrude(hi - lo)
    cross.delete()
    // Shift the base from local z=0 to local z=lo, so the solid spans [lo, hi].
    const shifted = extruded.translate([0, 0, lo])
    extruded.delete()
    return orientToPlane(shifted, plane)
}

/**
 * Build the 3D solid RECONSTRUCTED from a whole drawing's orthographic views.
 *
 * `detectRegions` finds every closed region (connected-segment loops) and the
 * plane it lies on. Regions are grouped by plane; each plane with ≥1 region is a
 * VIEW. The reconstruction needs at least TWO distinct views — one silhouette
 * alone leaves the third axis unbounded — so a drawing with fewer than two
 * populated planes (or no closed region at all) returns `null`, leaving any
 * imported solid untouched.
 *
 * For each view: union its regions' contours into a single silhouette
 * `CrossSection`, then extrude that silhouette into a BAR spanning the whole part
 * along the view's normal (`[bboxMin[axis] - M, bboxMax[axis] + M]`, M a small
 * margin) via `extrudeProfileBetween`. The margin only avoids coincident-cap
 * degeneracy where bars meet — it lies along the normal and is trimmed away by
 * the other views, so it never affects the result. INTERSECTING all the bars
 * yields the reconstructed solid (three 2×2 squares ⇒ a 2×2×2 cube).
 *
 * Every per-view `CrossSection`, every intermediate union, every bar, and both
 * inputs of each intersection are freed; only the final `Manifold` survives and
 * the CALLER owns it. React-free — `Manifold` is the interop boundary.
 */
export const drawingToManifold = (wasm: ManifoldToplevel, doc: Drawing): Manifold | null => {
    const regions = detectRegions(doc)
    if (regions.length === 0) {
        return null
    }

    // Group regions by their view-plane; only populated planes are views.
    const byPlane = new Map<Plane, Vec2[][]>()
    for (const { plane, contour } of regions) {
        const bucket = byPlane.get(plane)
        if (bucket) {
            bucket.push(contour)
        } else {
            byPlane.set(plane, [contour])
        }
    }
    // A single silhouette cannot bound the axis along its own normal.
    if (byPlane.size < 2) {
        return null
    }

    // Global 3D bounding box over every region point (lifted to world space),
    // so each view's bar can span the whole part along its normal.
    const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
    const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
    for (const { plane, contour } of regions) {
        for (const p of contour) {
            const w = unprojectPoint(p, plane)
            for (let i = 0; i < 3; i++) {
                if (w[i] < min[i]) min[i] = w[i]
                if (w[i] > max[i]) max[i] = w[i]
            }
        }
    }
    // A small margin along the normal only (trimmed away by the other views): a
    // fraction of the bbox diagonal, floored at 1 mm, so it scales with the part.
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
    const margin = Math.max(1, diagonal * 0.01)

    // One bar per view: union the view's silhouettes into a single contour set,
    // extrude across the part, orient onto the plane.
    const bars: Manifold[] = []
    for (const [plane, contours] of byPlane) {
        const axis = normalAxis(plane)
        const lo = min[axis] - margin
        const hi = max[axis] + margin
        bars.push(extrudeSilhouetteBar(wasm, contours, plane, lo, hi))
    }

    // Intersect every bar, freeing both inputs of each step so only the running
    // result stays live; the final handle is the reconstructed solid.
    let result = bars[0]
    for (let i = 1; i < bars.length; i++) {
        const next = bars[i]
        const merged = result.intersect(next)
        result.delete()
        next.delete()
        result = merged
    }
    return result
}

/**
 * One view's BAR: union the view's silhouette contours into a single
 * `CrossSection` (so overlapping/touching regions become one outline), then
 * extrude+orient it across `[lo, hi]` along the plane's normal. Each contour's
 * own `CrossSection` and every intermediate union is freed; the caller owns the
 * returned `Manifold`. With a single contour this is just `extrudeProfileBetween`.
 */
const extrudeSilhouetteBar = (
    wasm: ManifoldToplevel,
    contours: Vec2[][],
    plane: Plane,
    lo: number,
    hi: number
): Manifold => {
    if (contours.length === 1) {
        return extrudeProfileBetween(wasm, contours[0], plane, lo, hi)
    }

    let silhouette: CrossSection = new wasm.CrossSection(normalizeWinding(contours[0]))
    for (let i = 1; i < contours.length; i++) {
        const next = new wasm.CrossSection(normalizeWinding(contours[i]))
        const merged = silhouette.add(next)
        silhouette.delete()
        next.delete()
        silhouette = merged
    }
    const extruded = silhouette.extrude(hi - lo)
    silhouette.delete()
    const shifted = extruded.translate([0, 0, lo])
    extruded.delete()
    return orientToPlane(shifted, plane)
}

/** A copy of `contour` wound counter-clockwise (reversed when signed area < 0). */
const normalizeWinding = (contour: Vec2[]): Vec2[] => {
    const out = contour.map(([x, y]): Vec2 => [x, y])
    if (signedArea(out) < 0) {
        out.reverse()
    }
    return out
}
