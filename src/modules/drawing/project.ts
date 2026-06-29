import type { Arc, Circle, Entity, Plane, Vec2, Vec3 } from "./types"

/**
 * Orthographic projection + tessellation for the drawing editor.
 *
 * v1 SIMPLIFICATION: the three principal planes pass through the origin
 * (front → z=0, top → y=0, side → x=0). The project/unproject conventions are
 * a documented v1 contract — every other phase builds on these exact mappings:
 *
 *   front (z=0):  project [x,y,z] -> [x,  y]   ;  unproject [u,v] -> [u, v,  0]
 *   top   (y=0):  project [x,y,z] -> [x, -z]   ;  unproject [u,v] -> [u, 0, -v]
 *   side  (x=0):  project [x,y,z] -> [-z, y]   ;  unproject [u,v] -> [0, v, -u]
 *
 * project/unproject are inverses ON the active plane: for any in-plane world
 * point `p`, unproject(project(p)) === p, and for any view point `q`,
 * project(unproject(q)) === q. Out-of-plane depth is discarded by project (it
 * is an orthographic view), which is what makes cross-plane geometry collapse
 * to an edge-on line.
 */

/** Project a world point onto the active plane's 2D view space. */
export const projectPoint = (p: Vec3, plane: Plane): Vec2 => {
    const [x, y, z] = p
    switch (plane) {
        case "front":
            return [x, y]
        case "top":
            return [x, -z]
        case "side":
            return [-z, y]
    }
}

/** Lift a 2D view point back onto the active plane through the origin. */
export const unprojectPoint = (p: Vec2, plane: Plane): Vec3 => {
    const [u, v] = p
    switch (plane) {
        case "front":
            return [u, v, 0]
        case "top":
            return [u, 0, -v]
        case "side":
            return [0, v, -u]
    }
}

/**
 * The unit normal of a principal plane in world space. An entity drawn ON a
 * plane lies in that plane, so a circle/arc minted there takes this as its
 * `normal`. Matches the v1 plane contract: front is the z=0 plane (normal +Z),
 * top the y=0 plane (normal +Y), side the x=0 plane (normal +X).
 */
export const planeNormal = (plane: Plane): Vec3 => {
    switch (plane) {
        case "front":
            return [0, 0, 1]
        case "top":
            return [0, 1, 0]
        case "side":
            return [1, 0, 0]
    }
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
]

const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2])

const normalize = (v: Vec3): Vec3 => {
    const len = length(v)
    if (len === 0) return [0, 0, 0]
    return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * An orthonormal pair spanning the plane perpendicular to `normal`. Picks a
 * reference axis that is not parallel to the normal, so the cross products are
 * well-conditioned for any orientation.
 */
const inPlaneBasis = (normal: Vec3): { uAxis: Vec3; vAxis: Vec3 } => {
    const n = normalize(normal)
    const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const uAxis = normalize(cross(n, ref))
    const vAxis = cross(n, uAxis)
    return { uAxis, vAxis }
}

/** Sample a circle/arc at angle `theta` (radians) in the plane ⟂ its normal. */
const arcPoint = (entity: Circle | Arc, uAxis: Vec3, vAxis: Vec3, theta: number): Vec3 => {
    const [cx, cy, cz] = entity.center
    const r = entity.radius
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    return [
        cx + r * (cosT * uAxis[0] + sinT * vAxis[0]),
        cy + r * (cosT * uAxis[1] + sinT * vAxis[1]),
        cz + r * (cosT * uAxis[2] + sinT * vAxis[2])
    ]
}

const DEG_TO_RAD = Math.PI / 180

/**
 * Flatten any entity to a 3D polyline. `segments` (default 64) controls the
 * fidelity of curved entities; lines and polylines ignore it.
 */
export const tessellateEntity = (entity: Entity, segments = 64): { points: Vec3[]; closed: boolean } => {
    switch (entity.type) {
        case "line":
            return { points: [entity.a, entity.b], closed: false }
        case "polyline":
            return { points: [...entity.points], closed: entity.closed }
        case "circle": {
            const { uAxis, vAxis } = inPlaneBasis(entity.normal)
            const points: Vec3[] = []
            for (let i = 0; i < segments; i++) {
                const theta = (i / segments) * Math.PI * 2
                points.push(arcPoint(entity, uAxis, vAxis, theta))
            }
            return { points, closed: true }
        }
        case "arc": {
            const { uAxis, vAxis } = inPlaneBasis(entity.normal)
            const start = entity.startDeg * DEG_TO_RAD
            const end = entity.endDeg * DEG_TO_RAD
            const points: Vec3[] = []
            // segments edges -> segments + 1 samples, inclusive of both ends.
            for (let i = 0; i <= segments; i++) {
                const theta = start + ((end - start) * i) / segments
                points.push(arcPoint(entity, uAxis, vAxis, theta))
            }
            return { points, closed: false }
        }
    }
}

/**
 * Flatten an entity straight to 2D view space: tessellate in 3D, then project
 * each sample onto `plane`. This is THE function the renderer consumes — every
 * view, including edge-on cross-plane geometry, falls out of it.
 */
export const flattenEntity = (entity: Entity, plane: Plane, segments = 64): { points: Vec2[]; closed: boolean } => {
    const { points, closed } = tessellateEntity(entity, segments)
    return { points: points.map((p) => projectPoint(p, plane)), closed }
}
