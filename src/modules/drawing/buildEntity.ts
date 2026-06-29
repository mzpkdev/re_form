import type { Tool } from "./editorStore"
import { planeNormal, unprojectPoint } from "./project"
import { type Entity, newId, type Plane, type Vec2 } from "./types"

/**
 * Pure constructor: turn a tool plus the world-2D points captured on the active
 * plane into a finished `Entity` (3D world coords), or `null` when the input is
 * degenerate (a click with no drag, a zero-radius circle, a single-vertex
 * polyline). React-free and store-free by design — this is the testable heart of
 * the draw pipeline, and the one place the y-up coordinate contract is proven.
 *
 * `worldPoints2D` are already in world-2D (y-up) view space — the caller must
 * have undone the SVG `scale(1,-1)` flip (see `eventToWorld2D`). Each point is
 * lifted onto `plane` with `unprojectPoint`, so a line drawn on `top` from
 * [10,20]→[30,40] yields a=[10,0,-20], b=[30,0,-40], and a circle on `front`
 * carries normal=[0,0,1].
 *
 * `closed` only affects `polyline`: pass `true` to build a closed loop (polygon),
 * `false` (the default) for an open run. A closed polyline still needs ≥2 distinct
 * points; the caller is responsible for not handing in the duplicated start vertex.
 */
export const buildEntity = (tool: Tool, worldPoints2D: Vec2[], plane: Plane, closed = false): Entity | null => {
    const lift = (p: Vec2) => unprojectPoint(p, plane)
    switch (tool) {
        case "line": {
            if (worldPoints2D.length < 2) return null
            const [p0, p1] = worldPoints2D
            if (coincident(p0, p1)) return null
            return { id: newId(), type: "line", a: lift(p0), b: lift(p1) }
        }
        case "circle": {
            if (worldPoints2D.length < 2) return null
            const [center, rim] = worldPoints2D
            const radius = Math.hypot(rim[0] - center[0], rim[1] - center[1])
            if (radius < EPSILON) return null
            return { id: newId(), type: "circle", center: lift(center), radius, normal: planeNormal(plane) }
        }
        case "polyline": {
            const distinct = dedupeConsecutive(worldPoints2D)
            if (distinct.length < 2) return null
            return { id: newId(), type: "polyline", points: distinct.map(lift), closed }
        }
        default:
            // select / arc / anything else: no interactive construction yet.
            return null
    }
}

/** Two world-2D points closer than this (mm) are treated as the same point. */
const EPSILON = 1e-9

const coincident = (a: Vec2, b: Vec2): boolean => Math.hypot(b[0] - a[0], b[1] - a[1]) < EPSILON

/** Drop runs of identical-within-epsilon points so a stuttered click can't seed a zero-length segment. */
const dedupeConsecutive = (points: Vec2[]): Vec2[] => {
    const out: Vec2[] = []
    for (const p of points) {
        const last = out[out.length - 1]
        if (!last || !coincident(last, p)) out.push(p)
    }
    return out
}
