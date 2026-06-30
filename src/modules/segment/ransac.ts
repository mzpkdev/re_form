// Own Efficient-RANSAC primitive detection (Schnabel, Wahl & Klein 2007), §6.3.
// Sequential extract-largest-then-remove over the oriented point cloud: each pass
// draws many LOCALIZED minimal oriented-point samples, constructs a candidate per
// enabled primitive type via the closed-form `fit*` constructors, scores its
// inliers over the still-unassigned points with the DUAL test (distance AND
// normal agreement), keeps the best by inlier count, refits it, commits it, and
// removes its inliers. Pure, React-free, and deterministic given `params.seed`.
//
// This module owns the *search*; `fit.ts` owns the *math* (construction, refit,
// `pointDistance`/`surfaceNormal` for the dual test). Point→face mapping and the
// majority vote into triangles happen downstream (M3.4, via `pointToTri` +
// `assign.ts`); here a `DetectedShape` is a set of POINT indices.

import { fitCone, fitCylinder, fitPlane, fitSphere, pointDistance, refit, surfaceNormal, type Vec3 } from "./fit"
import type { ConeParams, CylinderParams, OrientedCloud, PlaneParams, SegmentationParams, SphereParams } from "./types"

/**
 * One primitive extracted by RANSAC. `params` is the refit §5 shape; `inliers`
 * are POINT indices into the source cloud (not triangles — the orchestrator maps
 * those to faces via `OrientedCloud.pointToTri`); `fitRms` is the RMS
 * point-to-surface distance over those inliers.
 */
export type DetectedShape = {
    params: PlaneParams | CylinderParams | SphereParams | ConeParams
    inliers: Int32Array
    fitRms: number
}

// Hard cap on trials per extraction pass: the probability bound can explode as
// the inlier ratio drops, so we clamp it to keep every run terminating quickly.
const MAX_TRIALS = 2000
// Floor on trials so a sparse cloud still gets a fair shot at a localized sample.
const MIN_TRIALS = 64
// Bounds on the voxel grid resolution along the longest bbox axis. Resolution is
// chosen ADAPTIVELY per pass (see `gridResolution`) so a cell + its 26 neighbors
// reliably hold enough points for a minimal sample: too fine and the local
// neighborhood is empty (sample draws fail), too coarse and "localized" stops
// meaning localized.
const MIN_GRID_RES = 3
const MAX_GRID_RES = 32
// Target points per occupied cell. Cloud points sit on surfaces (~2D), so
// points-per-cell scales ≈ N / res²; solving for `res` at this target keeps the
// 3×3×3 neighborhood populated enough to draw a minimal oriented sample.
const TARGET_PER_CELL = 4

/**
 * mulberry32 — the same tiny seedable PRNG the sampler uses (`sample.ts`), so the
 * whole pipeline is driven by one reproducible generator family. Seeded from
 * `params.seed`; same seed + params ⇒ identical detections.
 */
const makeRng = (seed: number) => () => {
    seed += 0x6d2b79f5
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const pointAt = (cloud: OrientedCloud, i: number): Vec3 => {
    const j = i * 3
    return [cloud.position[j], cloud.position[j + 1], cloud.position[j + 2]]
}
const normalAt = (cloud: OrientedCloud, i: number): Vec3 => {
    const j = i * 3
    return [cloud.normal[j], cloud.normal[j + 1], cloud.normal[j + 2]]
}

type Candidate = PlaneParams | CylinderParams | SphereParams | ConeParams

/**
 * Construct one candidate of each ENABLED primitive type from a localized minimal
 * oriented sample. Each fitter takes the points it needs (plane 1, sphere 2,
 * cylinder 2, cone 3) off the front of the sample; `null` constructions (parallel
 * normals, singular solves) are skipped.
 */
const constructCandidates = (sample: number[], cloud: OrientedCloud, params: SegmentationParams): Candidate[] => {
    const out: Candidate[] = []
    const p = (k: number): Vec3 => pointAt(cloud, sample[k])
    const n = (k: number): Vec3 => normalAt(cloud, sample[k])

    if (params.enabled.plane && sample.length >= 1) {
        out.push(fitPlane(p(0), n(0)))
    }
    if (params.enabled.sphere && sample.length >= 2) {
        const s = fitSphere(p(0), n(0), p(1), n(1))
        if (s) out.push(s)
    }
    if (params.enabled.cylinder && sample.length >= 2) {
        const c = fitCylinder(p(0), n(0), p(1), n(1))
        if (c) out.push(c)
    }
    if (params.enabled.cone && sample.length >= 3) {
        const c = fitCone(p(0), n(0), p(1), n(1), p(2), n(2))
        if (c) out.push(c)
    }
    return out
}

/**
 * The dual inlier test (§6.3): a point is an inlier of `shape` iff it is within
 * `epsilon` of the surface AND its normal agrees with the surface normal there to
 * within `cosNormal` — sign-agnostic (`|n_p · n_S|`), since the cloud's normals
 * and a fitted surface's may differ in outward convention. Scored only over the
 * candidate `among` indices (the still-unassigned points).
 */
const scoreInliers = (
    shape: Candidate,
    cloud: OrientedCloud,
    among: number[],
    params: SegmentationParams
): number[] => {
    const inliers: number[] = []
    for (const i of among) {
        const p = pointAt(cloud, i)
        if (pointDistance(shape, p) > params.epsilon) continue
        const ns = surfaceNormal(shape, p)
        const np = normalAt(cloud, i)
        const align = Math.abs(np[0] * ns[0] + np[1] * ns[1] + np[2] * ns[2])
        if (align < params.cosNormal) continue
        inliers.push(i)
    }
    return inliers
}

/** Min sample size for a candidate kind (drives the probability-bound exponent). */
const minSampleSize = (params: SegmentationParams): number => {
    // The largest min-set among enabled types governs the all-inlier draw rate
    // (the cone's 3 is the hardest to satisfy); if only plane is on, k = 1.
    if (params.enabled.cone) return 3
    if (params.enabled.sphere || params.enabled.cylinder) return 2
    return 1
}

/**
 * Trials for one extraction pass from the Schnabel probability bound:
 * `T = ceil(log(1−probability) / log(1−w^k))`, `w` = current inlier-ratio
 * estimate, `k` = min-sample size. Clamped to `[MIN_TRIALS, MAX_TRIALS]` so it
 * always terminates even as `w → 0`.
 */
const trialCount = (w: number, k: number, probability: number): number => {
    const wk = w ** k
    if (wk <= 0 || wk >= 1) return wk >= 1 ? MIN_TRIALS : MAX_TRIALS
    const t = Math.log(1 - probability) / Math.log(1 - wk)
    if (!Number.isFinite(t) || t <= 0) return MAX_TRIALS
    return Math.max(MIN_TRIALS, Math.min(MAX_TRIALS, Math.ceil(t)))
}

/**
 * Voxel grid resolution along the longest axis for `n` points, chosen so a cell
 * holds ≈ `TARGET_PER_CELL` points (surface clouds are ~2D, so per-cell count ≈
 * n / res²). Clamped to `[MIN_GRID_RES, MAX_GRID_RES]`. A too-fine grid leaves the
 * 3×3×3 neighborhood empty and starves the sampler; this keeps it populated.
 */
const gridResolution = (n: number): number => {
    const res = Math.round(Math.sqrt(n / TARGET_PER_CELL))
    return Math.max(MIN_GRID_RES, Math.min(MAX_GRID_RES, res))
}

/**
 * Build the voxel index over the currently-unassigned points: a key→point-list
 * map keyed `(cx·S + cy)·S + cz` with `cv = floor((coord − min) / cell)`, plus the
 * per-point cell coords so a localized sample can gather a cell + its 26
 * neighbors. Cell size = longest bbox extent / adaptive resolution.
 */
const buildGrid = (cloud: OrientedCloud, among: number[]) => {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const i of among) {
        const [x, y, z] = pointAt(cloud, i)
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
    }
    const res = gridResolution(among.length)
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
    // Degenerate (single cell) clouds fall back to one bucket; cell never 0.
    const cell = extent > 0 ? extent / res : 1
    // Stride must exceed any axis index so the linear key never collides.
    const stride = res + 2

    const cellOf = (i: number): [number, number, number] => {
        const [x, y, z] = pointAt(cloud, i)
        return [Math.floor((x - minX) / cell), Math.floor((y - minY) / cell), Math.floor((z - minZ) / cell)]
    }
    const keyOf = (cx: number, cy: number, cz: number): number => (cx * stride + cy) * stride + cz

    const buckets = new Map<number, number[]>()
    for (const i of among) {
        const [cx, cy, cz] = cellOf(i)
        const k = keyOf(cx, cy, cz)
        const list = buckets.get(k)
        if (list) list.push(i)
        else buckets.set(k, [i])
    }
    return { buckets, cellOf, keyOf }
}

/**
 * Draw a localized minimal oriented sample of size `need`: pick a random occupied
 * cell, gather it and its 26 neighbors, and choose `need` DISTINCT points from
 * that neighborhood. Returns `null` when the neighborhood is too small (so the
 * caller just tries another seed cell).
 */
const localizedSample = (
    grid: ReturnType<typeof buildGrid>,
    among: number[],
    need: number,
    rng: () => number
): number[] | null => {
    if (among.length === 0) return null
    // Seed point → its cell → the 3×3×3 neighborhood.
    const seed = among[Math.floor(rng() * among.length)]
    const [cx, cy, cz] = grid.cellOf(seed)
    const pool: number[] = []
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                const list = grid.buckets.get(grid.keyOf(cx + dx, cy + dy, cz + dz))
                if (list) for (const i of list) pool.push(i)
            }
        }
    }
    if (pool.length < need) return null

    // Distinct draw without replacement from the local pool.
    const chosen: number[] = []
    const used = new Set<number>()
    let guard = 0
    while (chosen.length < need && guard < pool.length * 8) {
        guard++
        const idx = pool[Math.floor(rng() * pool.length)]
        if (used.has(idx)) continue
        used.add(idx)
        chosen.push(idx)
    }
    return chosen.length === need ? chosen : null
}

/** RMS of `pointDistance` over the committed inlier points. */
const rmsOver = (shape: Candidate, cloud: OrientedCloud, inliers: Int32Array): number => {
    if (inliers.length === 0) return 0
    let sum = 0
    for (const i of inliers) {
        const d = pointDistance(shape, pointAt(cloud, i))
        sum += d * d
    }
    return Math.sqrt(sum / inliers.length)
}

/**
 * Detect parametric primitives in an oriented point cloud by Efficient-RANSAC.
 *
 * Sequential extract-largest-then-remove: starting from all points as
 * `remaining`, each pass runs `T` localized minimal-sample trials (T from the
 * probability bound), constructs+scores a candidate per enabled type with the
 * dual test, keeps the best by inlier count, and — if it clears `minPoints` —
 * refits it over its inliers, re-scores, commits it, and removes those inliers.
 * Stops when the best pass yields nothing usable. Deterministic for a given
 * `params.seed`.
 *
 * @returns `detected` (largest-first) and `remaining` POINT indices left over.
 */
export const detectPrimitives = (
    cloud: OrientedCloud,
    params: SegmentationParams
): { detected: DetectedShape[]; remaining: Int32Array } => {
    const total = Math.floor(cloud.position.length / 3)
    const rng = makeRng(params.seed)
    const anyEnabled = params.enabled.plane || params.enabled.sphere || params.enabled.cylinder || params.enabled.cone

    // remaining = all point indices, as a live mutable list we shrink on commit.
    let remaining: number[] = Array.from({ length: total }, (_, i) => i)
    const detected: DetectedShape[] = []

    const k = minSampleSize(params)

    while (anyEnabled && remaining.length >= params.minPoints) {
        const grid = buildGrid(cloud, remaining)

        let best: { shape: Candidate; inliers: number[] } | null = null
        // Inlier-ratio estimate for the bound: refreshed from the best seen so far
        // (Schnabel adapts T as larger candidates are found). Seed it low so the
        // first pass casts a wide net.
        let w = Math.max(1 / remaining.length, params.minPoints / remaining.length)
        let trials = trialCount(w, k, params.probability)

        for (let t = 0; t < trials; t++) {
            const sample = localizedSample(grid, remaining, k, rng)
            if (!sample) continue
            for (const shape of constructCandidates(sample, cloud, params)) {
                const inliers = scoreInliers(shape, cloud, remaining, params)
                if (!best || inliers.length > best.inliers.length) {
                    best = { shape, inliers }
                    // Tighten the trial budget as the best inlier ratio grows.
                    const newW = inliers.length / remaining.length
                    if (newW > w) {
                        w = newW
                        trials = Math.min(trials, trialCount(w, k, params.probability))
                    }
                }
            }
        }

        if (!best || best.inliers.length < params.minPoints) break

        // Refit the winner over its inlier points, then re-score with the tighter
        // surface so the committed inlier set matches the committed params.
        const refitPoints = new Float32Array(best.inliers.length * 3)
        for (let j = 0; j < best.inliers.length; j++) {
            const [x, y, z] = pointAt(cloud, best.inliers[j])
            refitPoints[j * 3] = x
            refitPoints[j * 3 + 1] = y
            refitPoints[j * 3 + 2] = z
        }
        const refitted = refit(best.shape as never, refitPoints) as Candidate
        let committedInliers = scoreInliers(refitted, cloud, remaining, params)
        let committedShape = refitted
        // A refit can occasionally shed inliers below the floor (e.g. PCA flips a
        // near-degenerate plane); fall back to the pre-refit shape if so.
        if (committedInliers.length < params.minPoints) {
            committedShape = best.shape
            committedInliers = best.inliers
        }

        const inlierArray = Int32Array.from(committedInliers)
        detected.push({
            params: committedShape,
            inliers: inlierArray,
            fitRms: rmsOver(committedShape, cloud, inlierArray)
        })

        const removed = new Set(committedInliers)
        remaining = remaining.filter((i) => !removed.has(i))
    }

    return { detected, remaining: Int32Array.from(remaining) }
}
