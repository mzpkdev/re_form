import type { Manifold } from "manifold-3d"
import { isValidSolid } from "../../lib/validate"

/**
 * Mesh Tools operations. Each function takes the live {@link Manifold} and
 * returns a NEW Manifold; manifold ops are immutable, so the input is never
 * mutated. Every intermediate handle allocated here is `.delete()`d before
 * returning — the input is owned by the model store and must NOT be deleted
 * (the store frees it on `setManifold`).
 *
 * These are honest, shape-aware operations on the user's own model. `vary`
 * deliberately changes the *shape* (a coherent displacement field), not the
 * vertex data of an unchanged surface — this is for optimizing/varying models,
 * not for scrambling vertices while preserving appearance.
 */

/**
 * Refine factor (edge-split count) sized to a triangle budget. `refine(n)` and
 * the smooth/vary realizations grow the count by ~n² per edge split, so the
 * largest `n` whose projected output (`inputTris × n²`) stays under
 * `maxTriangles` is `floor(sqrt(maxTriangles / inputTris))`. Clamped to
 * `[MIN_REFINE, MAX_REFINE]`: refine(1) is a no-op the lib rejects, and a fixed
 * ceiling stops a tiny model from being refined into needlessly many triangles.
 *
 * This is the single source of truth for "how much to refine" — the panel uses
 * it both to project the budget and to pick the factor it hands to {@link smooth}
 * / {@link vary}, so the displayed projection always matches what the op does.
 *
 * Note the floor: when even `refine(MIN_REFINE)` would exceed the budget (a very
 * dense input), this still returns `MIN_REFINE`. The caller is responsible for
 * gating on the projected count — the floor keeps the function total, it does
 * not promise the result fits.
 */
const MIN_REFINE = 2
const MAX_REFINE = 4
export const adaptiveRefine = (inputTris: number, maxTriangles: number): number => {
    if (inputTris <= 0) {
        return MAX_REFINE
    }
    const factor = Math.floor(Math.sqrt(maxTriangles / inputTris))
    return Math.max(MIN_REFINE, Math.min(MAX_REFINE, factor))
}

/**
 * Decimate the mesh by collapsing verts within `tolerance` of the surface, for
 * poly reduction / faster slicing. No intermediate handles.
 *
 * `tolerance` is a *deviation budget*, NOT a linear "reduction amount": it caps
 * how far (model units) any surface may move, and the result keeps a subset of
 * the original verts whose surfaces all moved by less than `tolerance`. On a
 * curved/organic mesh the triangle count is NOT monotonic in `tolerance` —
 * raising it past a sweet spot can re-triangulate the now-collapsed regions and
 * *increase* the count again. The panel therefore labels this as a tolerance,
 * not as a "more = smaller" slider. Values at or below the manifold's current
 * tolerance are a no-op.
 *
 * @param tolerance Max distance (model units) the surface may move.
 */
export const simplify = (manifold: Manifold, tolerance: number): Manifold => manifold.simplify(tolerance)

/** Options for {@link smooth}. */
export type SmoothOptions = {
    /**
     * Edges sharper than this angle (degrees) stay sharp; the rest are smoothed
     * to G1 continuity. Default 60 — keeps box corners crisp while rounding
     * gentler features. A value near 180 smooths everything.
     */
    minSharpAngle?: number
    /**
     * How many pieces each edge is split into when realizing the smoothed
     * surface (must be > 1). Higher = smoother silhouette but ~n² more
     * triangles. Default {@link MIN_REFINE} — the panel overrides this with
     * {@link adaptiveRefine} so the blow-up stays within the triangle budget.
     */
    refine?: number
}

/**
 * Smooth the surface. `smoothOut` only fills in tangent vectors — the geometry
 * is unchanged until `refine` interpolates the now-curved surface, so the two
 * steps are inseparable: smoothOut alone produces no visible change. The
 * post-smoothOut (pre-refine) handle is an intermediate and is deleted here.
 *
 * @param refine clamped to >= 2 (refine(1) is a no-op the lib rejects).
 */
export const smooth = (manifold: Manifold, opts?: SmoothOptions): Manifold => {
    const { minSharpAngle = 60, refine = MIN_REFINE } = opts ?? {}
    const tangents = manifold.smoothOut(minSharpAngle, 0)
    const refined = tangents.refine(Math.max(2, Math.round(refine)))
    tangents.delete()
    return refined
}

/** Options for {@link vary}. */
export type VaryOptions = {
    /**
     * Displacement strength as a fraction of the model's bounding-box diagonal.
     * Clamped to {@link VARY_MAX_AMPLITUDE}; a large warp can fold the solid
     * onto itself (`warp` does not check for self-intersection), so this stays
     * conservative.
     */
    amplitude: number
    /** Seed selecting the (deterministic) displacement field. */
    seed?: number
    /**
     * Edge-split count applied before warping so the low-frequency field has
     * enough vertices to deform smoothly (must be > 1, default {@link MIN_REFINE}).
     * The panel overrides this with {@link adaptiveRefine} so the warp stays
     * within the triangle budget. The refined intermediate is deleted here.
     */
    resolution?: number
}

/**
 * Upper bound on {@link VaryOptions.amplitude} (fraction of the bbox diagonal).
 *
 * `warp` does not check for self-intersection, so too large a displacement
 * folds the solid onto itself and yields a non-manifold result that fails
 * `isValidSolid` and cannot be re-baked or exported. Verified against the
 * real `Little_Opossum.stl` fixture: across a sweep of seeds, every seed stays
 * a valid, exportable solid through amplitude ≈ 0.18, while some seeds (e.g.
 * seed 7) already self-intersect at 0.2 — and the worst case breaks around
 * ≈ 0.206. This cap sits comfortably below that all-seeds-safe ceiling; the
 * backstop in {@link vary} catches any rarer seed that still folds.
 */
export const VARY_MAX_AMPLITUDE = 0.15

/**
 * mulberry32 — a tiny seedable PRNG yielding floats in [0, 1). Used only to
 * derive the field's frequencies/phases/axis-mixing from `seed`; it never
 * touches a vertex directly (that would be the per-vertex noise we explicitly
 * do NOT want).
 */
const makeRng = (seed: number) => () => {
    seed += 0x6d2b79f5
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** One sinusoidal term of the displacement field, sampled from the RNG. */
type Wave = { freq: [number, number, number]; phase: number; weight: number }

/**
 * Build a small, fixed-size bank of low-frequency sinusoids from `seed`. Summed
 * and evaluated at a vertex position they form a smooth, coherent field — the
 * whole model swells and bends rather than each vertex jittering on its own.
 */
const makeWaves = (rng: () => number): Wave[] => {
    const waves: Wave[] = []
    for (let i = 0; i < 3; i++) {
        waves.push({
            // Low spatial frequency (≈0.5–2 cycles across the model) keeps the
            // deformation coherent: neighbouring verts move together.
            freq: [0.5 + rng() * 1.5, 0.5 + rng() * 1.5, 0.5 + rng() * 1.5],
            phase: rng() * Math.PI * 2,
            weight: 0.5 + rng() * 0.5
        })
    }
    return waves
}

/** Sample the summed field at a unit-normalized position for one output axis. */
const fieldAt = (waves: Wave[], nx: number, ny: number, nz: number, axisPhase: number): number => {
    let sum = 0
    let totalWeight = 0
    for (const wave of waves) {
        const angle =
            wave.freq[0] * nx * Math.PI +
            wave.freq[1] * ny * Math.PI +
            wave.freq[2] * nz * Math.PI +
            wave.phase +
            axisPhase
        sum += Math.sin(angle) * wave.weight
        totalWeight += wave.weight
    }
    return sum / totalWeight
}

/**
 * Warp the model into a visibly *different shape* by displacing every vertex
 * along a smooth, low-frequency field. Deterministic for a given `seed`. The
 * field is scaled by `amplitude × bbox diagonal`, so the effect is proportional
 * to model size regardless of units. Refine first so the warp reads as a smooth
 * bulge rather than faceted; the refined intermediate is deleted.
 *
 * This is NOT per-vertex noise: coincident verts share the same field value, so
 * the surface stays continuous and the result is a genuinely new shape.
 */
export const vary = (manifold: Manifold, opts: VaryOptions): Manifold => {
    const { amplitude, seed = 1, resolution = MIN_REFINE } = opts
    const clampedAmplitude = Math.max(0, Math.min(VARY_MAX_AMPLITUDE, amplitude))

    const box = manifold.boundingBox()
    const size: [number, number, number] = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
    const center: [number, number, number] = [
        (box.max[0] + box.min[0]) / 2,
        (box.max[1] + box.min[1]) / 2,
        (box.max[2] + box.min[2]) / 2
    ]
    const diagonal = Math.hypot(size[0], size[1], size[2])
    const scale = clampedAmplitude * diagonal
    // Avoid division by zero on a flat/degenerate axis: a zero extent maps the
    // normalized coordinate to 0 (the field is constant along that axis).
    const inv: [number, number, number] = [
        size[0] > 0 ? 2 / size[0] : 0,
        size[1] > 0 ? 2 / size[1] : 0,
        size[2] > 0 ? 2 / size[2] : 0
    ]

    const rng = makeRng(seed)
    const waves = makeWaves(rng)
    // A distinct phase per output axis so x/y/z don't all bulge identically.
    const axisPhase: [number, number, number] = [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2]

    const refined = manifold.refine(Math.max(2, Math.round(resolution)))
    const warped = refined.warpBatch((verts, count) => {
        for (let i = 0; i < count; i++) {
            const o = i * 3
            const x = verts[o]
            const y = verts[o + 1]
            const z = verts[o + 2]
            // Normalize into roughly [-1, 1] about the model centre.
            const nx = (x - center[0]) * inv[0]
            const ny = (y - center[1]) * inv[1]
            const nz = (z - center[2]) * inv[2]
            verts[o] = x + fieldAt(waves, nx, ny, nz, axisPhase[0]) * scale
            verts[o + 1] = y + fieldAt(waves, nx, ny, nz, axisPhase[1]) * scale
            verts[o + 2] = z + fieldAt(waves, nx, ny, nz, axisPhase[2]) * scale
        }
    })
    refined.delete()
    // Backstop: `warp` can't detect self-intersection, so even below
    // VARY_MAX_AMPLITUDE a pathological seed could fold the solid onto itself.
    // Reject a non-manifold result here (deleting the bad handle first, mirroring
    // assertValidSolid) so the panel surfaces a clear error instead of pushing a
    // broken, non-exportable handle into the viewport.
    if (!isValidSolid(warped)) {
        warped.delete()
        throw new Error("Vary amplitude too high — the model self-intersects. Lower the amplitude and try again.")
    }
    return warped
}
