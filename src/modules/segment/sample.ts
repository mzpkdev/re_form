import type { MeshTopology, OrientedCloud, SegmentationParams } from "./types"

/**
 * Build an oriented point cloud from a welded mesh: one centroid per triangle
 * with the exact flat face normal (so `pointToTri[i] = i`), supplemented with
 * area-weighted samples on big faces so a large flat face clears `minPoints`
 * (cumulative-area CDF over faces, uniform barycentric point, returns the source
 * triangle). Targets 1–3× the triangle count, capped at ~50–100k points; uses a
 * seeded mulberry32 (from `params.seed`) so results are deterministic.
 */

// ── Density heuristic (internal; there is NO sample-density field in params) ──
//
// The base layer is always exactly one centroid per triangle (`pointToTri` is
// identity there), so the cloud is never smaller than `faceCount`. On top of
// that we scatter area-weighted supplemental points so the surface is covered
// roughly uniformly *by area* rather than by triangle count — a single huge
// face would otherwise contribute the same one point as a tiny sliver, and a
// large flat region could fall below `minPoints` for the downstream RANSAC.
//
// TARGET_FACTOR = total point budget as a multiple of the triangle count. The
// spec asks for 1–3×; we pick 2× (one centroid + one area-weighted point per
// triangle on average) as the middle of that band.
const TARGET_FACTOR = 2

// POINT_CAP is the hard ceiling on the total cloud size (spec: ~50–100k). We use
// the high end so dense-but-still-tractable meshes keep full resolution; past it
// the supplement is skipped/clamped so we never blow memory or the RANSAC budget.
const POINT_CAP = 100_000

/**
 * mulberry32 — a tiny seedable PRNG yielding floats in [0, 1). Seeded from
 * `params.seed` so the same seed produces a byte-identical cloud. (Same constant
 * generator used elsewhere in the repo, e.g. `obfuscate`/`mesh-tools`.)
 */
const makeRng = (seed: number) => () => {
    seed += 0x6d2b79f5
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Twice the area of triangle `f` = ‖(b−a) × (c−a)‖, read straight off positions. */
const doubleArea = (positions: Float32Array, ia: number, ib: number, ic: number): number => {
    const ax = positions[ia * 3]
    const ay = positions[ia * 3 + 1]
    const az = positions[ia * 3 + 2]
    const e1x = positions[ib * 3] - ax
    const e1y = positions[ib * 3 + 1] - ay
    const e1z = positions[ib * 3 + 2] - az
    const e2x = positions[ic * 3] - ax
    const e2y = positions[ic * 3 + 1] - ay
    const e2z = positions[ic * 3 + 2] - az
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x
    return Math.hypot(cx, cy, cz)
}

/** Binary-search the cumulative-area CDF for the face owning fraction `u ∈ [0,1)`. */
const pickFace = (cdf: Float32Array, total: number, u: number): number => {
    const target = u * total
    let lo = 0
    let hi = cdf.length - 1
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cdf[mid] < target) lo = mid + 1
        else hi = mid
    }
    return lo
}

/**
 * Build the oriented point cloud. The first `faceCount` points are triangle
 * centroids (identity backmap); any remaining budget is filled with
 * area-weighted barycentric samples whose source triangle is recorded in
 * `pointToTri`. Normals are always the exact flat face normal — never recomputed
 * or smoothed.
 */
export const sampleCloud = (topo: MeshTopology, params: SegmentationParams): OrientedCloud => {
    const { positions, triangles, faceNormals, faceCount } = topo

    // Total budget: TARGET_FACTOR × triangles, clamped to the cap and never below
    // the base centroid layer (faceCount). For very large meshes the supplement
    // shrinks to whatever room is left under POINT_CAP (possibly zero).
    const targeted = Math.min(faceCount * TARGET_FACTOR, POINT_CAP)
    const pointCount = Math.max(faceCount, targeted)
    const supplementCount = pointCount - faceCount

    const position = new Float32Array(pointCount * 3)
    const normal = new Float32Array(pointCount * 3)
    const pointToTri = new Int32Array(pointCount)

    // ── Base layer: one centroid per triangle, exact face normal, identity map ──
    for (let f = 0; f < faceCount; f++) {
        const ia = triangles[f * 3]
        const ib = triangles[f * 3 + 1]
        const ic = triangles[f * 3 + 2]
        const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3
        const cy = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3
        const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3
        position[f * 3] = cx
        position[f * 3 + 1] = cy
        position[f * 3 + 2] = cz
        normal[f * 3] = faceNormals[f * 3]
        normal[f * 3 + 1] = faceNormals[f * 3 + 1]
        normal[f * 3 + 2] = faceNormals[f * 3 + 2]
        pointToTri[f] = f
    }

    if (supplementCount <= 0) return { position, normal, pointToTri }

    // ── Cumulative-area CDF over faces (area-weighted face picking) ──
    const cdf = new Float32Array(faceCount)
    let running = 0
    for (let f = 0; f < faceCount; f++) {
        running += doubleArea(positions, triangles[f * 3], triangles[f * 3 + 1], triangles[f * 3 + 2])
        cdf[f] = running
    }
    const totalArea = running

    const rng = makeRng(params.seed)

    // ── Supplemental layer: pick face ∝ area, uniform barycentric point ──
    for (let s = 0; s < supplementCount; s++) {
        const out = faceCount + s
        // Degenerate mesh (all faces zero-area): fall back to face 0 deterministically.
        const f = totalArea > 0 ? pickFace(cdf, totalArea, rng()) : 0
        const ia = triangles[f * 3]
        const ib = triangles[f * 3 + 1]
        const ic = triangles[f * 3 + 2]

        // Uniform sample over the triangle via the sqrt barycentric construction.
        let r1 = rng()
        let r2 = rng()
        const sq = Math.sqrt(r1)
        r1 = 1 - sq
        r2 = sq * (1 - r2)
        const r3 = 1 - r1 - r2

        position[out * 3] = r1 * positions[ia * 3] + r2 * positions[ib * 3] + r3 * positions[ic * 3]
        position[out * 3 + 1] = r1 * positions[ia * 3 + 1] + r2 * positions[ib * 3 + 1] + r3 * positions[ic * 3 + 1]
        position[out * 3 + 2] = r1 * positions[ia * 3 + 2] + r2 * positions[ib * 3 + 2] + r3 * positions[ic * 3 + 2]

        // Normal = the source face's exact flat normal.
        normal[out * 3] = faceNormals[f * 3]
        normal[out * 3 + 1] = faceNormals[f * 3 + 1]
        normal[out * 3 + 2] = faceNormals[f * 3 + 2]

        pointToTri[out] = f
    }

    return { position, normal, pointToTri }
}
