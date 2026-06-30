import type { MeshTopology, RegionResult, SegmentationParams } from "./types"

/**
 * Smallest face count a grown region must reach to be emitted as a `patch`.
 * `1` means every grown region (even a lone triangle) becomes a patch, so no
 * face is silently dropped here — the orchestrator's `unknown` bucket exists for
 * truly leftover faces, not for tiny-but-coherent regions. Kept as a local
 * constant because `SegmentationParams` has no field for it (§6.4).
 */
const MIN_PATCH_FACES = 1

/**
 * Tier 2 — segment the still-unlabelled triangles (`assignment[f] === -1`) into
 * smooth patches bounded by sharp creases.
 *
 * Seeds **largest-area unlabelled face first**, then floods to a neighbour across
 * a shared edge iff the neighbour is unlabelled AND `dihedral(current, neighbour)
 * ≤ thetaGrow`. Two extra guards keep regions tight:
 *  - **Crease hard-stop:** any edge with `dihedral > thetaCrease` is never crossed
 *    (hysteresis, `thetaGrow < thetaCrease`).
 *  - **Seed-drift stop:** a candidate is also rejected when its normal deviates
 *    from the SEED face normal by more than `thetaCrease`. Pairwise growth alone
 *    would wrap a finely-faceted curved strip (each step under `thetaGrow`) into
 *    one giant region; capping the total deviation from the seed at the same
 *    crease threshold breaks such a strip into several regions instead.
 *
 * A grown region is emitted as a `patch` (its sorted face indices pushed to
 * `patches`) when `|region| ≥ MIN_PATCH_FACES`; otherwise its faces fall through
 * to `remaining`. `remaining` is every entry-`-1` face not placed into a patch.
 *
 * Pure and O(F) with adjacency precomputed: each face is visited once across all
 * seeds. `assignment` is read-only — claimed faces are tracked in a local buffer.
 */
export const growRegions = (topo: MeshTopology, assignment: Int32Array, params: SegmentationParams): RegionResult => {
    const { faceCount, faceAdjacency, faceNormals, dihedral } = topo
    const { thetaGrow, thetaCrease } = params

    // Local claim buffer — never mutate the caller's `assignment`. A face is
    // eligible to seed/grow only while it is `-1` in `assignment` AND unclaimed.
    const claimed = new Uint8Array(faceCount)

    // Face areas, used only to order seeds (largest first). Computed once; faces
    // already labelled by the caller never seed, so their area is irrelevant but
    // cheap to include.
    const areas = computeAreas(topo)

    // Unlabelled faces, sorted by descending area → seed order. Stable enough:
    // the flood is deterministic given a seed, and ties only reorder independent
    // regions, never their membership.
    const seedOrder: number[] = []
    for (let f = 0; f < faceCount; f++) {
        if (assignment[f] === -1) seedOrder.push(f)
    }
    seedOrder.sort((a, b) => areas[b] - areas[a])

    const patches: Int32Array[] = []
    const stack: number[] = []

    for (const seed of seedOrder) {
        if (claimed[seed] || assignment[seed] !== -1) continue

        const region: number[] = []
        claimed[seed] = 1
        stack.length = 0
        stack.push(seed)

        // Seed normal — every candidate is compared against THIS, not just its
        // immediate neighbour, to cap cumulative drift across a curved strip.
        const sx = faceNormals[3 * seed]
        const sy = faceNormals[3 * seed + 1]
        const sz = faceNormals[3 * seed + 2]

        while (stack.length > 0) {
            // biome-ignore lint/style/noNonNullAssertion: guarded by stack.length > 0
            const current = stack.pop()!
            region.push(current)

            for (let slot = 0; slot < 3; slot++) {
                const neighbour = faceAdjacency[3 * current + slot]
                // < 0 covers boundary (-1) and non-manifold (-2) edges: both are
                // hard boundaries the flood must not cross.
                if (neighbour < 0) continue
                if (claimed[neighbour] || assignment[neighbour] !== -1) continue

                // Crease hard-stop across the shared edge (hysteresis upper bound).
                const stepAngle = dihedral(current, neighbour)
                if (stepAngle > thetaCrease) continue
                // Local smoothness gate.
                if (stepAngle > thetaGrow) continue

                // Seed-drift stop: reject if the candidate has wandered too far
                // from the seed orientation, even if each local step was smooth.
                const seedAngle = angleToSeed(faceNormals, neighbour, sx, sy, sz)
                if (seedAngle > thetaCrease) continue

                claimed[neighbour] = 1
                stack.push(neighbour)
            }
        }

        if (region.length >= MIN_PATCH_FACES) {
            const patch = Int32Array.from(region)
            patch.sort()
            patches.push(patch)
        } else {
            // Below the floor → release the faces back to the remaining pool.
            for (const f of region) claimed[f] = 0
        }
    }

    // Every entry-`-1` face that ended up in no patch (sub-floor regions only,
    // when MIN_PATCH_FACES > 1) becomes part of `remaining`.
    const leftover: number[] = []
    for (let f = 0; f < faceCount; f++) {
        if (assignment[f] === -1 && !claimed[f]) leftover.push(f)
    }

    return { patches, remaining: Int32Array.from(leftover) }
}

/** Unsigned angle (radians) between face `f`'s normal and the seed normal. */
const angleToSeed = (faceNormals: Float32Array, f: number, sx: number, sy: number, sz: number): number => {
    const dot = faceNormals[3 * f] * sx + faceNormals[3 * f + 1] * sy + faceNormals[3 * f + 2] * sz
    return Math.acos(Math.min(1, Math.max(-1, dot)))
}

/** Per-face triangle area `½‖(b−a) × (c−a)‖`. Length `faceCount`. */
const computeAreas = (topo: MeshTopology): Float32Array => {
    const { positions, triangles, faceCount } = topo
    const areas = new Float32Array(faceCount)
    for (let f = 0; f < faceCount; f++) {
        const i0 = triangles[3 * f] * 3
        const i1 = triangles[3 * f + 1] * 3
        const i2 = triangles[3 * f + 2] * 3
        const abx = positions[i1] - positions[i0]
        const aby = positions[i1 + 1] - positions[i0 + 1]
        const abz = positions[i1 + 2] - positions[i0 + 2]
        const acx = positions[i2] - positions[i0]
        const acy = positions[i2 + 1] - positions[i0 + 1]
        const acz = positions[i2 + 2] - positions[i0 + 2]
        const cx = aby * acz - abz * acy
        const cy = abz * acx - abx * acz
        const cz = abx * acy - aby * acx
        areas[f] = 0.5 * Math.hypot(cx, cy, cz)
    }
    return areas
}
