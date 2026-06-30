// Closed-form primitive constructors (from minimal oriented-point sets, §6.3) +
// least-squares refit + the geometry helpers the RANSAC inlier test needs. All
// pure, deterministic, React-free. Operates on ORIENTED POINTS: a position
// `[x,y,z]` plus a unit normal `[x,y,z]`. The shape representation is the §5
// `*Params` type for each kind — there is no parallel type.
//
// Math notes (the parts that are load-bearing or numerically touchy):
//  • Sphere from 2 points → center is the least-squares closest point to the two
//    oriented lines `pᵢ + t·nᵢ`; solving `(Σ Pᵢ) c = Σ Pᵢ pᵢ` with
//    `Pᵢ = I − nᵢnᵢᵀ` (projector onto the plane ⟂ nᵢ). Singular ⇔ normals
//    parallel ⇒ null.
//  • Cylinder axis is `normalize(n₀ × n₁)` (NOT a cross of positions); the 2D
//    center is where the two in-plane normal rays meet. Near-parallel normals ⇒
//    null.
//  • Cone apex is the intersection of the 3 tangent planes `nᵢ·(x−pᵢ)=0`
//    (solve the 3×3 system); axis bisects the apex→point directions and the
//    half-angle is their common angle to it. Degenerate planes/directions ⇒ null.
//  • LM refit (sphere/cylinder/cone) frames the geometric distance of each point
//    as a residual the optimizer drives to zero: x = point index, y = 0,
//    fn(params)(i) = pointDistance(shapeFromParams(params), points[i]).

import { levenbergMarquardt } from "ml-levenberg-marquardt"
import { EigenvalueDecomposition, Matrix } from "ml-matrix"
import type { ConeParams, CylinderParams, PlaneParams, SphereParams } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// vec3 — a tiny pure helper set over readonly [x,y,z] tuples. Kept local so the
// fitters stay React/three-free; three.js Vector3 would mutate-in-place and
// allocate handles we'd have to manage, which is overkill here.
// ─────────────────────────────────────────────────────────────────────────────

export type Vec3 = [number, number, number]

const EPS = 1e-9

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
]
const length = (a: Vec3): number => Math.sqrt(dot(a, a))

/** Unit vector, or `null` when `a` is too short to normalize reliably. */
const normalize = (a: Vec3): Vec3 | null => {
    const len = length(a)
    if (len < EPS) return null
    return [a[0] / len, a[1] / len, a[2] / len]
}

// ─────────────────────────────────────────────────────────────────────────────
// Closed-form constructors from minimal oriented sets (§6.3).
// ─────────────────────────────────────────────────────────────────────────────

/** Plane through `p` with unit normal `n`: `normal·x = offset`, `offset = n·p`. */
export const fitPlane = (p: Vec3, n: Vec3): PlaneParams => {
    const normal = normalize(n) ?? [0, 0, 1]
    return { kind: "plane", normal, offset: dot(normal, p) }
}

/**
 * Sphere from 2 oriented points. Center ≈ the point closest (least squares) to
 * the two oriented lines `pᵢ + t·nᵢ`; radius = mean distance from center to the
 * points. Returns `null` when the two normals are parallel (the lines don't pin
 * a unique closest point).
 */
export const fitSphere = (p0: Vec3, n0: Vec3, p1: Vec3, n1: Vec3): SphereParams | null => {
    const u0 = normalize(n0)
    const u1 = normalize(n1)
    if (!u0 || !u1) return null

    // Σ Pᵢ c = Σ Pᵢ pᵢ, with Pᵢ = I − nᵢnᵢᵀ (projector ⟂ nᵢ). 3×3 solve.
    const a = Matrix.zeros(3, 3)
    const b = Matrix.zeros(3, 1)
    for (const [p, u] of [
        [p0, u0],
        [p1, u1]
    ] as const) {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const proj = (r === c ? 1 : 0) - u[r] * u[c]
                a.set(r, c, a.get(r, c) + proj)
                b.set(r, 0, b.get(r, 0) + proj * p[c])
            }
        }
    }

    const center = solve3(a, b)
    if (!center) return null

    const r = (length(sub(center, p0)) + length(sub(center, p1))) / 2
    if (r < EPS) return null
    return { kind: "sphere", center, radius: r }
}

/**
 * Cylinder from 2 oriented points. Axis `a = normalize(n₀ × n₁)`; project both
 * points and their normals onto the plane ⟂ a, then intersect the two in-plane
 * normal rays to get the 2D center, lifted back to a point on the axis. Radius =
 * in-plane distance from that center to a point. `null` on near-parallel normals.
 */
export const fitCylinder = (p0: Vec3, n0: Vec3, p1: Vec3, n1: Vec3): CylinderParams | null => {
    const u0 = normalize(n0)
    const u1 = normalize(n1)
    if (!u0 || !u1) return null

    const axis = normalize(cross(u0, u1))
    if (!axis) return null // parallel normals → no unique cylinder

    // Project positions and normals onto the plane ⟂ axis.
    const q0 = projectToPlane(p0, axis)
    const q1 = projectToPlane(p1, axis)
    const m0p = projectToPlane(u0, axis)
    const m1p = projectToPlane(u1, axis)
    const m0 = normalize(m0p)
    const m1 = normalize(m1p)
    if (!m0 || !m1) return null

    // Intersect the rays q0 + s·m0 and q1 + t·m1 (all in 3D but coplanar). Solve
    // the 2×2 least-squares for [s, t]: q0 + s·m0 = q1 + t·m1.
    const w = sub(q0, q1)
    const a00 = dot(m0, m0)
    const a01 = -dot(m0, m1)
    const a11 = dot(m1, m1)
    const b0 = -dot(m0, w)
    const b1 = dot(m1, w)
    const det = a00 * a11 - a01 * a01
    if (Math.abs(det) < EPS) return null

    const s = (b0 * a11 - a01 * b1) / det
    const center2d = add(q0, scale(m0, s))

    const radius = (length(sub(center2d, q0)) + length(sub(center2d, q1))) / 2
    if (radius < EPS) return null
    return { kind: "cylinder", axis, point: center2d, radius }
}

/**
 * Cone from 3 oriented points. Apex = intersection of the 3 tangent planes
 * `nᵢ·(x−pᵢ)=0` (a 3×3 solve). Axis bisects the unit apex→point directions
 * (`normalize((d₀−d₁)×(d₀−d₂))`, oriented apex→base); half-angle = common angle
 * of those directions to the axis. `null` if the planes don't meet in a point or
 * the directions are degenerate/coplanar.
 */
export const fitCone = (p0: Vec3, n0: Vec3, p1: Vec3, n1: Vec3, p2: Vec3, n2: Vec3): ConeParams | null => {
    const u0 = normalize(n0)
    const u1 = normalize(n1)
    const u2 = normalize(n2)
    if (!u0 || !u1 || !u2) return null

    // Apex: N·x = b, rows nᵢ, bᵢ = nᵢ·pᵢ.
    const n = new Matrix([u0, u1, u2] as number[][])
    const b = Matrix.columnVector([dot(u0, p0), dot(u1, p1), dot(u2, p2)])
    const apex = solve3(n, b)
    if (!apex) return null

    const d0 = normalize(sub(p0, apex))
    const d1 = normalize(sub(p1, apex))
    const d2 = normalize(sub(p2, apex))
    if (!d0 || !d1 || !d2) return null

    // Axis ⟂ (d0−d1) and ⟂ (d0−d2): the directions sit on a cone about it.
    let axis = normalize(cross(sub(d0, d1), sub(d0, d2)))
    if (!axis) return null
    // Orient apex→base (positive dot with the sample directions).
    if (dot(axis, d0) < 0) axis = scale(axis, -1)

    const cosHalf = clamp(dot(axis, d0), -1, 1)
    const halfAngle = Math.acos(cosHalf)
    // Reject the degenerate flat (≈plane) and full (≈line) cases.
    if (halfAngle < EPS || halfAngle > Math.PI / 2 - EPS) return null

    return { kind: "cone", apex, axis, halfAngle }
}

// ─────────────────────────────────────────────────────────────────────────────
// Refit by least squares over a shape's inlier points.
// ─────────────────────────────────────────────────────────────────────────────

/** A flat oriented cloud or an array of point tuples — refit only needs positions. */
const pointAt = (points: PointSource, i: number): Vec3 => {
    if (points instanceof Float32Array) {
        const j = i * 3
        return [points[j], points[j + 1], points[j + 2]]
    }
    return points[i]
}
const pointCount = (points: PointSource): number =>
    points instanceof Float32Array ? Math.floor(points.length / 3) : points.length

/** Positions for refit: an xyz-interleaved `Float32Array` or `Vec3[]`. */
export type PointSource = Float32Array | Vec3[]

/**
 * Refit a plane to inlier points by PCA: the unit normal is the covariance
 * eigenvector for the smallest eigenvalue; offset = `normal·centroid`. The
 * returned normal's sign is left as the eigenvector's (callers that need a
 * consistent orientation flip it against a reference normal themselves).
 */
export const refitPlane = (points: PointSource): PlaneParams => {
    const count = pointCount(points)
    if (count === 0) return { kind: "plane", normal: [0, 0, 1], offset: 0 }

    const centroid = centroidOf(points)
    // Covariance 3×3 (symmetric).
    const cov = Matrix.zeros(3, 3)
    for (let i = 0; i < count; i++) {
        const d = sub(pointAt(points, i), centroid)
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) cov.set(r, c, cov.get(r, c) + d[r] * d[c])
        }
    }

    const evd = new EigenvalueDecomposition(cov, { assumeSymmetric: true })
    const values = evd.realEigenvalues
    let minIdx = 0
    for (let i = 1; i < values.length; i++) if (values[i] < values[minIdx]) minIdx = i
    const vec = evd.eigenvectorMatrix
    const normal = normalize([vec.get(0, minIdx), vec.get(1, minIdx), vec.get(2, minIdx)]) ?? [0, 0, 1]
    return { kind: "plane", normal, offset: dot(normal, centroid) }
}

/** LM-refine a sphere from a closed-form initial guess, minimizing |‖p−c‖−r|. */
export const refitSphere = (init: SphereParams, points: PointSource): SphereParams => {
    const count = pointCount(points)
    if (count < 4) return init
    const x = indices(count)
    const y = new Float64Array(count) // target residual 0
    const fn =
        ([cx, cy, cz, r]: number[]) =>
        (i: number): number => {
            const p = pointAt(points, i)
            return Math.abs(Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz)) - r
        }
    const out = runLM(x, y, fn, [init.center[0], init.center[1], init.center[2], init.radius])
    if (!out) return init
    const [cx, cy, cz, r] = out
    if (!Number.isFinite(r) || r <= EPS) return init
    return { kind: "sphere", center: [cx, cy, cz], radius: r }
}

/**
 * LM-refine a cylinder from a closed-form guess. Parameterizes the axis by two
 * spherical angles (θ azimuth, φ polar) so it stays unit; the on-axis point is
 * the in-plane center (px,py expressed relative to the initial axis frame is
 * avoided — we optimize the full 3D point and project distances). Minimizes the
 * radial residual `|dist⟂(p, axis line) − r|`.
 */
export const refitCylinder = (init: CylinderParams, points: PointSource): CylinderParams => {
    const count = pointCount(points)
    if (count < 5) return init
    const x = indices(count)
    const y = new Float64Array(count)
    const [it, ip] = axisToAngles(init.axis)
    const fn =
        ([theta, phi, px, py, pz, r]: number[]) =>
        (i: number): number => {
            const axis = anglesToAxis(theta, phi)
            const p = pointAt(points, i)
            const rel = sub(p, [px, py, pz])
            const axialLen = dot(rel, axis)
            const radial = sub(rel, scale(axis, axialLen))
            return length(radial) - r
        }
    const out = runLM(x, y, fn, [it, ip, init.point[0], init.point[1], init.point[2], init.radius])
    if (!out) return init
    const [theta, phi, px, py, pz, r] = out
    if (!Number.isFinite(r) || r <= EPS) return init
    const axis = anglesToAxis(theta, phi)
    return { kind: "cylinder", axis, point: [px, py, pz], radius: r, axialRange: init.axialRange }
}

/**
 * LM-refine a cone from a closed-form guess. Optimizes apex (3), axis angles (2),
 * and half-angle (1); residual = perpendicular distance from the point to the
 * cone surface (`sin` projection of the apex→point vector relative to the cone
 * angle).
 */
export const refitCone = (init: ConeParams, points: PointSource): ConeParams => {
    const count = pointCount(points)
    if (count < 6) return init
    const x = indices(count)
    const y = new Float64Array(count)
    const [it, ip] = axisToAngles(init.axis)
    const fn =
        ([ax, ay, az, theta, phi, half]: number[]) =>
        (i: number): number => {
            const axis = anglesToAxis(theta, phi)
            const v = sub(pointAt(points, i), [ax, ay, az])
            return coneDistance(v, axis, half)
        }
    const out = runLM(x, y, fn, [init.apex[0], init.apex[1], init.apex[2], it, ip, init.halfAngle])
    if (!out) return init
    const [ax, ay, az, theta, phi, half] = out
    if (!Number.isFinite(half) || half <= EPS || half >= Math.PI / 2) return init
    return {
        kind: "cone",
        apex: [ax, ay, az],
        axis: anglesToAxis(theta, phi),
        halfAngle: half,
        axialRange: init.axialRange
    }
}

/** Dispatch refit by the params' `kind`. Plane ignores `params` (pure PCA). */
export function refit(params: PlaneParams, points: PointSource): PlaneParams
export function refit(params: SphereParams, points: PointSource): SphereParams
export function refit(params: CylinderParams, points: PointSource): CylinderParams
export function refit(params: ConeParams, points: PointSource): ConeParams
export function refit(
    params: PlaneParams | SphereParams | CylinderParams | ConeParams,
    points: PointSource
): PlaneParams | SphereParams | CylinderParams | ConeParams {
    switch (params.kind) {
        case "plane":
            return refitPlane(points)
        case "sphere":
            return refitSphere(params, points)
        case "cylinder":
            return refitCylinder(params, points)
        case "cone":
            return refitCone(params, points)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers for the RANSAC dual inlier test.
//   pointDistance(params, p)  → perpendicular distance from p to the surface.
//   surfaceNormal(params, p)  → the surface's unit normal nearest p.
// ─────────────────────────────────────────────────────────────────────────────

/** Perpendicular distance from point `p` to the surface described by `params`. */
export const pointDistance = (params: PlaneParams | SphereParams | CylinderParams | ConeParams, p: Vec3): number => {
    switch (params.kind) {
        case "plane":
            return Math.abs(dot(params.normal, p) - params.offset)
        case "sphere":
            return Math.abs(length(sub(p, params.center)) - params.radius)
        case "cylinder": {
            const rel = sub(p, params.point)
            const axial = dot(rel, params.axis)
            const radial = sub(rel, scale(params.axis, axial))
            return Math.abs(length(radial) - params.radius)
        }
        case "cone":
            return Math.abs(coneDistance(sub(p, params.apex), params.axis, params.halfAngle))
    }
}

/**
 * The surface's unit normal nearest `p` (the orientation of the surface at the
 * closest point). For the dual inlier test M3.3 compares `|n_p · this|`, so the
 * sign convention (outward vs inward) is irrelevant — the magnitude is what
 * matters.
 */
export const surfaceNormal = (params: PlaneParams | SphereParams | CylinderParams | ConeParams, p: Vec3): Vec3 => {
    switch (params.kind) {
        case "plane":
            return [...params.normal]
        case "sphere": {
            // At p == center the normal is undefined; fall back to a fixed axis.
            return normalize(sub(p, params.center)) ?? [0, 0, 1]
        }
        case "cylinder": {
            const rel = sub(p, params.point)
            const axial = dot(rel, params.axis)
            const radial = sub(rel, scale(params.axis, axial))
            return normalize(radial) ?? perpendicularTo(params.axis)
        }
        case "cone": {
            // Surface normal = component of (apex→p) ⟂ to the surface generator
            // line, rotated toward/away the axis by the half-angle. Build it from
            // the radial direction and the axis: n = cosθ·r̂ − sinθ·â (points
            // outward for an apex→base axis).
            const v = sub(p, params.apex)
            const axial = dot(v, params.axis)
            const radial = sub(v, scale(params.axis, axial))
            const rhat = normalize(radial) ?? perpendicularTo(params.axis)
            const cos = Math.cos(params.halfAngle)
            const sin = Math.sin(params.halfAngle)
            return normalize(sub(scale(rhat, cos), scale(params.axis, sin))) ?? rhat
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal numeric helpers.
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Project a vector onto the plane through the origin with unit normal `axis`. */
const projectToPlane = (v: Vec3, axis: Vec3): Vec3 => sub(v, scale(axis, dot(v, axis)))

/** Any unit vector perpendicular to `axis` (fallback when a radial dir vanishes). */
const perpendicularTo = (axis: Vec3): Vec3 => {
    const ref: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    return normalize(cross(axis, ref)) ?? [1, 0, 0]
}

/**
 * Signed perpendicular distance from a point (given as `v = p − apex`) to a cone
 * surface with unit `axis` and `halfAngle`. The cone's surface is the set of
 * points whose angle to the axis equals the half-angle; the distance is
 * `‖v‖·sin(angle − halfAngle)` measured perpendicular to the nearest generator.
 */
const coneDistance = (v: Vec3, axis: Vec3, halfAngle: number): number => {
    const len = length(v)
    if (len < EPS) return 0
    const axial = dot(v, axis)
    const angle = Math.acos(clamp(axial / len, -1, 1))
    return len * Math.sin(angle - halfAngle)
}

/** Solve a 3×3 `A x = b` via ml-matrix; `null` if (near-)singular. */
const solve3 = (a: Matrix, b: Matrix): Vec3 | null => {
    // Cramer's rule keeps the singularity test explicit and avoids ml-matrix
    // throwing on a singular system.
    const m = a.to2DArray()
    const det = det3(m)
    if (Math.abs(det) < EPS) return null
    const rhs = [b.get(0, 0), b.get(1, 0), b.get(2, 0)]
    const col = (k: number): number => {
        const c = m.map((row) => row.slice()) as number[][]
        for (let r = 0; r < 3; r++) c[r][k] = rhs[r]
        return det3(c)
    }
    return [col(0) / det, col(1) / det, col(2) / det]
}

const det3 = (m: number[][]): number =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])

const centroidOf = (points: PointSource): Vec3 => {
    const count = pointCount(points)
    let sx = 0
    let sy = 0
    let sz = 0
    for (let i = 0; i < count; i++) {
        const p = pointAt(points, i)
        sx += p[0]
        sy += p[1]
        sz += p[2]
    }
    return [sx / count, sy / count, sz / count]
}

/** Axis (unit) → spherical angles [azimuth θ, polar φ] used by LM. */
const axisToAngles = (axis: Vec3): [number, number] => {
    const u = normalize(axis) ?? [0, 0, 1]
    const phi = Math.acos(clamp(u[2], -1, 1))
    const theta = Math.atan2(u[1], u[0])
    return [theta, phi]
}

const anglesToAxis = (theta: number, phi: number): Vec3 => {
    const s = Math.sin(phi)
    return [s * Math.cos(theta), s * Math.sin(theta), Math.cos(phi)]
}

const indices = (count: number): Float64Array => {
    const x = new Float64Array(count)
    for (let i = 0; i < count; i++) x[i] = i
    return x
}

/**
 * Run ml-levenberg-marquardt against an index→residual model. `x` is the point
 * index, `y` is all-zero (we minimize the residual directly), and the predicted
 * value is the geometric distance. Returns the fitted params or `null` if LM
 * throws (e.g. timeout / non-finite).
 */
const runLM = (
    x: Float64Array,
    y: Float64Array,
    fn: (params: number[]) => (i: number) => number,
    initialValues: number[]
): number[] | null => {
    try {
        const result = levenbergMarquardt(
            { x: Array.from(x), y: Array.from(y) },
            fn as (params: number[]) => (xi: number) => number,
            {
                initialValues,
                maxIterations: 100,
                damping: 1e-3,
                gradientDifference: 1e-6,
                errorTolerance: 1e-12
            }
        )
        return result.parameterValues
    } catch {
        return null
    }
}
