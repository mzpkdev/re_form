import type { Manifold, ManifoldToplevel } from "manifold-3d"

/**
 * Number of circular segments used when approximating a sphere for 3D offsets.
 * Higher is rounder (and slower); 48 matches the project default.
 */
const SEGMENTS = 48

/**
 * Per-side radial clearance presets, in millimetres. These describe how much
 * gap to leave between two mating parts on each side of the interface (so the
 * total diametral allowance is twice the value).
 *
 * - `press` — interference / press-in fit: the parts are nominally tight and
 *   are pushed together; the tiny value absorbs printer over-extrusion.
 * - `snug` — close sliding fit: assembles by hand with light resistance.
 * - `slip` — free sliding fit: drops together with obvious play.
 */
export const FIT_PRESETS = { press: 0.1, snug: 0.2, slip: 0.4 } as const

/** A named clearance preset. */
export type Fit = keyof typeof FIT_PRESETS

/**
 * Resolve the per-side radial clearance (mm) for a fit.
 *
 * `printerOffset` is a user-calibratable, per-printer/material correction added
 * on top of the nominal preset. It is purely empirical — dial it in from a test
 * print — and defaults to 0.
 */
export const clearanceFor = (fit: Fit, printerOffset = 0): number => FIT_PRESETS[fit] + printerOffset

/**
 * Size a hole to receive a peg of the given radius (or half-size) for a fit.
 * The hole is grown by the clearance so the peg can enter.
 *
 * Works for any radial half-dimension — a circular radius or half the width of
 * a square pocket.
 */
export const holeForPeg = (pegRadius: number, fit: Fit, printerOffset = 0): number =>
    pegRadius + clearanceFor(fit, printerOffset)

/**
 * Size a peg to enter a hole of the given radius (or half-size) for a fit.
 * The peg is shrunk by the clearance so it fits inside.
 *
 * Works for any radial half-dimension — a circular radius or half the width of
 * a square tab. Throws if the resulting peg would be non-positive.
 */
export const pegForHole = (holeRadius: number, fit: Fit, printerOffset = 0): number => {
    const radius = holeRadius - clearanceFor(fit, printerOffset)
    if (radius <= 0) {
        throw new Error(
            `pegForHole: clearance (${clearanceFor(fit, printerOffset)}mm) is >= hole radius (${holeRadius}mm); peg would have non-positive radius`
        )
    }
    return radius
}

/**
 * Grow a solid outward by `delta` mm in every direction (3D offset / dilation),
 * implemented as a Minkowski sum with a sphere of radius `delta`.
 *
 * Note: the Minkowski sum rounds off convex edges and corners by `delta`, so
 * this is an approximation of a true offset, not an exact parallel surface.
 *
 * The caller retains ownership of `m` (it is not deleted). A NEW handle is
 * returned for the caller to delete. `delta === 0` returns a fresh copy.
 */
export const growManifold = (wasm: ManifoldToplevel, m: Manifold, delta: number): Manifold => {
    if (delta === 0) {
        return m.translate([0, 0, 0])
    }
    const tool = wasm.Manifold.sphere(Math.abs(delta), SEGMENTS)
    try {
        return m.minkowskiSum(tool)
    } finally {
        tool.delete()
    }
}

/**
 * Shrink a solid inward by `delta` mm in every direction (3D offset / erosion),
 * implemented as a Minkowski difference with a sphere of radius `delta`.
 *
 * Note: the Minkowski difference rounds off convex edges and corners by
 * `delta`, so this is an approximation of a true inward offset.
 *
 * The caller retains ownership of `m` (it is not deleted). A NEW handle is
 * returned for the caller to delete. `delta === 0` returns a fresh copy.
 */
export const shrinkManifold = (wasm: ManifoldToplevel, m: Manifold, delta: number): Manifold => {
    if (delta === 0) {
        return m.translate([0, 0, 0])
    }
    const tool = wasm.Manifold.sphere(Math.abs(delta), SEGMENTS)
    try {
        return m.minkowskiDifference(tool)
    } finally {
        tool.delete()
    }
}

/**
 * Measure the minimum gap (mm) between two solids, for verifying that an
 * achieved clearance matches the intended fit. The result is clamped to
 * `searchLength`, so keep that comfortably above the expected gap.
 */
export const measureGap = (a: Manifold, b: Manifold, searchLength = 10): number => a.minGap(b, searchLength)
