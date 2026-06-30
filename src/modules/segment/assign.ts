import type { MeshTopology, OrientedCloud, SegmentationParams } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// §6.5c-i — majority-of-sample-points vote
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-face inlier FRACTION for one primitive: the share of a face's sample points
 * that the primitive's dual inlier test accepted (§6.5c-i). RANSAC labels each
 * sampled point in/out for a candidate primitive; `pointToTri` (the
 * {@link OrientedCloud} backmap) maps every point to its source face, so this
 * tallies, per face, `inliers / totalSamples`.
 *
 * Returns a `Float32Array` of length `faceCount`. A face with no sample points
 * (should not happen — the sampler emits ≥1 centroid point per face) scores `0`.
 * The fraction, not a raw count, is the comparison currency for both the majority
 * test below and conflict resolution, so faces with different sample counts stay
 * comparable.
 *
 * Pure; `inlier` is indexed by POINT index (parallel to `pointToTri`).
 */
export const faceVotes = (
    pointToTri: Int32Array,
    inlier: readonly boolean[] | Uint8Array,
    faceCount: number
): Float32Array => {
    const total = new Int32Array(faceCount)
    const hits = new Int32Array(faceCount)
    for (let p = 0; p < pointToTri.length; p++) {
        const f = pointToTri[p]
        if (f < 0 || f >= faceCount) continue
        total[f]++
        if (inlier[p]) hits[f]++
    }
    const fraction = new Float32Array(faceCount)
    for (let f = 0; f < faceCount; f++) {
        fraction[f] = total[f] === 0 ? 0 : hits[f] / total[f]
    }
    return fraction
}

/**
 * The §6.5c-i majority gate: a primitive only CLAIMS a face when a strict majority
 * (`> 0.5`) of that face's sample points are inliers. Anything at or below half is
 * a non-claim, so a face split evenly between two primitives is claimed by
 * neither on the strict reading and falls through to conflict resolution /
 * Tier-2 region growing. Pure predicate over a `faceVotes` fraction.
 */
export const claimsFace = (fraction: number): boolean => fraction > 0.5

// ─────────────────────────────────────────────────────────────────────────────
// §6.6.2 — conflict resolution (a face matched by two-or-more primitives)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One primitive's bid for a single contested face. `shapeIndex` is the
 * primitive's position in the detection order (RANSAC extracts largest-first, so
 * a LOWER index is the earlier / larger shape — the final tiebreak). `fraction`
 * is the face's inlier fraction for this primitive (from {@link faceVotes}).
 * `residual` is the COMBINED point-to-surface residual over this face's inlier
 * samples — distance plus normal deviation, in whatever common unit the caller
 * mixes them (e.g. `dist / epsilon + (1 - |n·n_S|) / (1 - cosNormal)`); only its
 * ordering matters here, so the exact blend is the fitter's choice.
 */
export interface FaceCandidate {
    shapeIndex: number
    fraction: number
    residual: number
}

// Ties on a float comparison are decided within this slack so float noise in the
// fraction / residual doesn't flip the deterministic ordering.
const TIE_EPS = 1e-9

/**
 * §6.6.2 ordering as a comparator: returns `< 0` when `a` should win over `b`
 * (sorts to the front), `> 0` when `b` wins, `0` when truly indistinguishable.
 * Precedence: (i) higher inlier fraction wins; (ii) tie → lower combined residual;
 * (iii) still tied → lower `shapeIndex` (the earlier / larger shape). Pure and
 * total, so it is safe to pass straight to `Array.prototype.sort`.
 */
export const compareCandidates = (a: FaceCandidate, b: FaceCandidate): number => {
    // (i) Higher fraction wins → ascending sort key is the negated fraction.
    if (Math.abs(a.fraction - b.fraction) > TIE_EPS) return b.fraction - a.fraction
    // (ii) Lower combined residual wins.
    if (Math.abs(a.residual - b.residual) > TIE_EPS) return a.residual - b.residual
    // (iii) Earlier / larger shape (lower detection index) wins.
    return a.shapeIndex - b.shapeIndex
}

/**
 * Resolve a contested face to a single winning primitive per §6.6.2 and return
 * its `shapeIndex`. `candidates` are the primitives that claimed the face (length
 * ≥ 1); the winner is the {@link compareCandidates}-minimum. Throws on an empty
 * list — a face with no claimant should never reach conflict resolution (it stays
 * `-1` for Tier-2). Does not mutate `candidates`.
 */
export const resolveConflict = (candidates: readonly FaceCandidate[]): number => {
    if (candidates.length === 0) {
        throw new Error("resolveConflict: no candidates for a contested face")
    }
    let best = candidates[0]
    for (let i = 1; i < candidates.length; i++) {
        if (compareCandidates(candidates[i], best) < 0) best = candidates[i]
    }
    return best.shapeIndex
}

// ─────────────────────────────────────────────────────────────────────────────
// §6.5c-ii — one-ring boundary smoothing (never relabel across a crease)
// ─────────────────────────────────────────────────────────────────────────────

/** Knobs `smoothBoundaries` reads — just the crease threshold from §7. */
export interface SmoothParams {
    /** Sharp-edge dihedral threshold (rad); an edge steeper than this is a crease. */
    thetaCrease: SegmentationParams["thetaCrease"]
}

/**
 * One-ring boundary smoothing (§6.5c-ii): relabel each BOUNDARY face to the
 * majority label among its one-ring neighbours, **never counting or crossing a
 * crease edge** (`dihedral > thetaCrease`). A boundary face is one with at least
 * one manifold neighbour carrying a DIFFERENT label across a non-crease edge —
 * interior faces (all same-label or only crease/border edges) are left untouched.
 *
 * This only ever MOVES a label onto a face that one of its smooth neighbours
 * already carries; it never invents a label and never empties one — so the total
 * face count and the set of labels in play are conserved. Crease edges are hard
 * walls: a face is never reassigned to a label that only reaches it across a
 * crease, which keeps genuine feature borders crisp.
 *
 * Returns a NEW `Int32Array`; the input is read-only. Relabelling decisions are
 * all computed against the ORIGINAL labels (a single synchronous pass), so the
 * result is order-independent and one face's new label can't cascade into its
 * neighbour's decision within the same call. `-1` (unassigned) participates like
 * any other label: a `-1` face can be pulled into a smooth neighbour's primitive,
 * and a smooth `-1` majority can reclaim a stray face — never across a crease.
 */
export const smoothBoundaries = (assignment: Int32Array, topo: MeshTopology, params: SmoothParams): Int32Array => {
    const next = Int32Array.from(assignment)
    const counts = new Map<number, number>()

    for (let f = 0; f < topo.faceCount; f++) {
        const own = assignment[f]
        counts.clear()
        // Seed with the face's own label so a tie between "stay" and a neighbour
        // label resolves to staying — smoothing only flips on a strict majority.
        counts.set(own, 1)

        for (let slot = 0; slot < 3; slot++) {
            const neighbour = topo.faceAdjacency[3 * f + slot]
            if (neighbour < 0) continue // -1 border / -2 non-manifold: no smoothing
            // Crease edge → hard wall: the neighbour's label does not vote here.
            if (topo.dihedral(f, neighbour) > params.thetaCrease) continue
            const label = assignment[neighbour]
            counts.set(label, (counts.get(label) ?? 0) + 1)
        }

        // Pick the strict-majority label across {self + smooth neighbours}. Ties
        // (including the seeded self-vote) keep the current label, so a face only
        // moves when a single neighbour label strictly outvotes everything else.
        let bestLabel = own
        let bestCount = counts.get(own) ?? 1
        let tied = false
        for (const [label, count] of counts) {
            if (count > bestCount) {
                bestCount = count
                bestLabel = label
                tied = false
            } else if (count === bestCount && label !== bestLabel) {
                tied = true
            }
        }
        next[f] = tied ? own : bestLabel
    }

    return next
}
