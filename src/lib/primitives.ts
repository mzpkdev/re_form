import type { Manifold, ManifoldToplevel } from "manifold-3d"
import { assertValidSolid } from "./validate"

/**
 * Builder functions for functional-part primitives: cones/frustums, tubes,
 * morphological shells, and chamfered (draft-tapered) boxes.
 *
 * React-free domain logic. Every builder takes the initialised manifold-3d
 * toplevel (`wasm`) as its first argument, mirroring `buildPrimitive` in
 * edits.ts, and returns ONE new Manifold the caller owns. Each builder validates
 * its inputs first (throwing a clear Error on out-of-range dimensions), deletes
 * every intermediate Manifold/CrossSection it allocates, and runs
 * `assertValidSolid` before returning. Where a caller's `solid` is passed in it
 * is left intact (never deleted here). All measurements are in MILLIMETRES.
 */

/** Round shapes are tessellated at this segment count — matches CIRCULAR_SEGMENTS in edits.ts. */
const SEGMENTS = 48

/**
 * A cone or frustum centred at the origin, its axis along Z.
 *
 * `radiusTop === 0` yields a pointed cone (apex on +Z); a positive `radiusTop`
 * yields a truncated cone (frustum).
 */
export const makeCone = (
    wasm: ManifoldToplevel,
    {
        radiusBottom,
        radiusTop,
        height,
        segments
    }: { radiusBottom: number; radiusTop: number; height: number; segments?: number }
): Manifold => {
    if (!(radiusBottom > 0)) {
        throw new Error("makeCone: radiusBottom must be greater than 0")
    }
    if (!(radiusTop >= 0)) {
        throw new Error("makeCone: radiusTop must be greater than or equal to 0")
    }
    if (!(height > 0)) {
        throw new Error("makeCone: height must be greater than 0")
    }

    const result = wasm.Manifold.cylinder(height, radiusBottom, radiusTop, segments ?? SEGMENTS, true)
    assertValidSolid(result, "makeCone produced an invalid solid")
    return result
}

/**
 * A pipe with a through-bore (both ends open) centred at the origin, axis along Z.
 *
 * The outer wall is a cylinder of `outerRadius`; the inner bore is a slightly
 * taller cylinder of `outerRadius - wall` subtracted from it, so it pokes
 * through both end faces and leaves the tube hollow end-to-end.
 */
export const makeTube = (
    wasm: ManifoldToplevel,
    { outerRadius, wall, height, segments }: { outerRadius: number; wall: number; height: number; segments?: number }
): Manifold => {
    if (!(outerRadius > 0)) {
        throw new Error("makeTube: outerRadius must be greater than 0")
    }
    if (!(height > 0)) {
        throw new Error("makeTube: height must be greater than 0")
    }
    if (!(wall > 0)) {
        throw new Error("makeTube: wall must be greater than 0")
    }
    if (!(wall < outerRadius)) {
        throw new Error("makeTube: wall must be less than outerRadius")
    }

    const seg = segments ?? SEGMENTS
    const innerRadius = outerRadius - wall
    const outer = wasm.Manifold.cylinder(height, outerRadius, outerRadius, seg, true)
    // Bore is slightly taller than the outer wall so it clears both end faces => open at both ends.
    const inner = wasm.Manifold.cylinder(height + 0.1, innerRadius, innerRadius, seg, true)
    const result = outer.subtract(inner)
    outer.delete()
    inner.delete()
    assertValidSolid(result, "makeTube produced an invalid solid")
    return result
}

/**
 * Hollow an arbitrary solid, leaving a `wall`-mm-thick shell.
 *
 * This is a morphological (CLOSED) shell: the cavity is the solid eroded inward
 * by `wall` via a Minkowski difference with a sphere, then subtracted from the
 * original. There is NO opening — the shell fully encloses the cavity. Because
 * the erosion sweeps a sphere, inner corners are ROUNDED at radius `wall` rather
 * than left sharp (manifold-3d has no native shell/offset operation).
 *
 * Ownership: the caller owns `solid` and it is NOT deleted here; only the sphere
 * and the eroded-inset intermediate are deleted.
 */
export const makeShell = (
    wasm: ManifoldToplevel,
    { solid, wall, segments }: { solid: Manifold; wall: number; segments?: number }
): Manifold => {
    if (!(wall > 0)) {
        throw new Error("makeShell: wall must be greater than 0")
    }

    const sphere = wasm.Manifold.sphere(wall, segments ?? SEGMENTS)
    // Morphological erosion: shrink the solid inward by `wall` to form the cavity.
    const inset = solid.minkowskiDifference(sphere)
    const result = solid.subtract(inset)
    sphere.delete()
    inset.delete()
    assertValidSolid(result, "makeShell produced an invalid solid")
    return result
}

/**
 * A box whose top face tapers inward by `chamfer` per side, centred at the origin.
 *
 * This is the manifold-friendly draft/chamfer APPROXIMATION: the square base is
 * extruded with a linearly scaled top face, producing four sloped faces rather
 * than a true 45° edge-chamfer (a real edge-chamfer would need B-rep editing
 * that manifold-3d does not provide). The base is `sizeX × sizeY`; the top is
 * inset by `chamfer` on every side, so its dimensions are
 * `(sizeX - 2·chamfer) × (sizeY - 2·chamfer)`.
 */
export const makeChamferedBox = (
    wasm: ManifoldToplevel,
    { sizeX, sizeY, sizeZ, chamfer }: { sizeX: number; sizeY: number; sizeZ: number; chamfer: number }
): Manifold => {
    if (!(sizeX > 0)) {
        throw new Error("makeChamferedBox: sizeX must be greater than 0")
    }
    if (!(sizeY > 0)) {
        throw new Error("makeChamferedBox: sizeY must be greater than 0")
    }
    if (!(sizeZ > 0)) {
        throw new Error("makeChamferedBox: sizeZ must be greater than 0")
    }
    if (!(chamfer > 0)) {
        throw new Error("makeChamferedBox: chamfer must be greater than 0")
    }
    if (!(2 * chamfer < Math.min(sizeX, sizeY))) {
        throw new Error("makeChamferedBox: 2 * chamfer must be less than the smaller of sizeX and sizeY")
    }
    if (!(chamfer < sizeZ)) {
        throw new Error("makeChamferedBox: chamfer must be less than sizeZ")
    }

    const base = wasm.CrossSection.square([sizeX, sizeY], true)
    const result = base.extrude(sizeZ, 1, 0, [(sizeX - 2 * chamfer) / sizeX, (sizeY - 2 * chamfer) / sizeY], true)
    base.delete()
    assertValidSolid(result, "makeChamferedBox produced an invalid solid")
    return result
}
