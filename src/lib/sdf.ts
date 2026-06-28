import type { Vec3 } from "./model"

/**
 * A signed-distance function: returns the signed distance from a point to a
 * surface — negative inside, ~0 on the surface, positive outside. These follow
 * the standard Inigo Quilez formulas. Everything is React-, three- and
 * manifold-free; the mesher calls these many times so they stay allocation-light.
 */
export type Sdf = (p: Vec3) => number

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

const length = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z)

// linear interpolation: a at h=0, b at h=1
const mix = (a: number, b: number, h: number): number => a + (b - a) * h

// ---------------------------------------------------------------------------
// primitives — centered at origin; position/orient them with the transforms below
// ---------------------------------------------------------------------------

export const sphere =
    (radius: number): Sdf =>
    (p: Vec3): number =>
        length(p[0], p[1], p[2]) - radius

/** Approximate ellipsoid SDF: (length(p / r) - 1) * min(r). Not exact, but cheap and stable. */
export const ellipsoid =
    (radii: Vec3): Sdf =>
    (p: Vec3): number => {
        const k = length(p[0] / radii[0], p[1] / radii[1], p[2] / radii[2])
        return (k - 1) * Math.min(radii[0], radii[1], radii[2])
    }

export const box =
    (halfExtents: Vec3): Sdf =>
    (p: Vec3): number => {
        const qx = Math.abs(p[0]) - halfExtents[0]
        const qy = Math.abs(p[1]) - halfExtents[1]
        const qz = Math.abs(p[2]) - halfExtents[2]
        const outside = length(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
        const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0)
        return outside + inside
    }

export const roundBox = (halfExtents: Vec3, radius: number): Sdf => {
    const inner = box([halfExtents[0] - radius, halfExtents[1] - radius, halfExtents[2] - radius])
    return (p: Vec3): number => inner(p) - radius
}

/** Rounded line segment (capsule) from a to b with the given radius. */
export const capsule =
    (a: Vec3, b: Vec3, radius: number): Sdf =>
    (p: Vec3): number => {
        const pax = p[0] - a[0]
        const pay = p[1] - a[1]
        const paz = p[2] - a[2]
        const bax = b[0] - a[0]
        const bay = b[1] - a[1]
        const baz = b[2] - a[2]
        const baLenSq = bax * bax + bay * bay + baz * baz
        const h = baLenSq === 0 ? 0 : clamp((pax * bax + pay * bay + paz * baz) / baLenSq, 0, 1)
        return length(pax - bax * h, pay - bay * h, paz - baz * h) - radius
    }

/** Capped cylinder, axis along +Y, centered at the origin. */
export const cylinder =
    (height: number, radius: number): Sdf =>
    (p: Vec3): number => {
        const dx = length(p[0], 0, p[2]) - radius
        const dy = Math.abs(p[1]) - height / 2
        const outside = length(Math.max(dx, 0), Math.max(dy, 0), 0)
        const inside = Math.min(Math.max(dx, dy), 0)
        return outside + inside
    }

// ---------------------------------------------------------------------------
// boolean ops
// ---------------------------------------------------------------------------

export const union =
    (...sdfs: Sdf[]): Sdf =>
    (p: Vec3): number => {
        let d = Number.POSITIVE_INFINITY
        for (const sdf of sdfs) {
            const v = sdf(p)
            if (v < d) d = v
        }
        return d
    }

export const intersect =
    (...sdfs: Sdf[]): Sdf =>
    (p: Vec3): number => {
        let d = Number.NEGATIVE_INFINITY
        for (const sdf of sdfs) {
            const v = sdf(p)
            if (v > d) d = v
        }
        return d
    }

export const subtract =
    (a: Sdf, b: Sdf): Sdf =>
    (p: Vec3): number =>
        Math.max(a(p), -b(p))

/** Polynomial smin: smooth minimum with smoothing radius k. */
const smin = (a: number, b: number, k: number): number => {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
    return mix(b, a, h) - k * h * (1 - h)
}

/** Smooth union: folds the polynomial smin pairwise. With k<=0 it behaves like `union`. */
export const smoothUnion =
    (k: number, ...sdfs: Sdf[]): Sdf =>
    (p: Vec3): number => {
        if (sdfs.length === 0) return Number.POSITIVE_INFINITY
        let d = sdfs[0](p)
        for (let i = 1; i < sdfs.length; i++) {
            const v = sdfs[i](p)
            d = k <= 0 ? Math.min(d, v) : smin(d, v, k)
        }
        return d
    }

/** Smooth subtraction: smin-based variant — smin(a, -b) with negated k. */
export const smoothSubtract =
    (k: number, a: Sdf, b: Sdf): Sdf =>
    (p: Vec3): number => {
        const da = a(p)
        const db = b(p)
        if (k <= 0) return Math.max(da, -db)
        return -smin(-da, db, k)
    }

// ---------------------------------------------------------------------------
// transforms — operate by transforming the query point
// ---------------------------------------------------------------------------

export const translated =
    (sdf: Sdf, offset: Vec3): Sdf =>
    (p: Vec3): number =>
        sdf([p[0] - offset[0], p[1] - offset[1], p[2] - offset[2]])

/**
 * Rotate the SOLID by euler angles (degrees) applied X→Y→Z, matching manifold's
 * `.rotate` convention. We evaluate the inner sdf at the inverse-rotated point
 * (R^-1 = R^T for a rotation) so the shape appears rotated by R.
 */
export const rotated = (sdf: Sdf, eulerDegrees: Vec3): Sdf => {
    const deg = Math.PI / 180
    const cx = Math.cos(eulerDegrees[0] * deg)
    const sx = Math.sin(eulerDegrees[0] * deg)
    const cy = Math.cos(eulerDegrees[1] * deg)
    const sy = Math.sin(eulerDegrees[1] * deg)
    const cz = Math.cos(eulerDegrees[2] * deg)
    const sz = Math.sin(eulerDegrees[2] * deg)

    // R = Rz * Ry * Rx (column-vector convention; applies x first, then y, then z)
    const r00 = cz * cy
    const r01 = cz * sy * sx - sz * cx
    const r02 = cz * sy * cx + sz * sx
    const r10 = sz * cy
    const r11 = sz * sy * sx + cz * cx
    const r12 = sz * sy * cx - cz * sx
    const r20 = -sy
    const r21 = cy * sx
    const r22 = cy * cx

    // Inverse of a rotation is its transpose: multiply p by R^T.
    return (p: Vec3): number =>
        sdf([
            r00 * p[0] + r10 * p[1] + r20 * p[2],
            r01 * p[0] + r11 * p[1] + r21 * p[2],
            r02 * p[0] + r12 * p[1] + r22 * p[2]
        ])
}

/** Uniform scale by `factor`: sdf(p / factor) * factor (keeps the distance metric correct). */
export const scaled =
    (sdf: Sdf, factor: number): Sdf =>
    (p: Vec3): number =>
        sdf([p[0] / factor, p[1] / factor, p[2] / factor]) * factor
