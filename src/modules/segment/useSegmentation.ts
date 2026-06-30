import { useMutation } from "@tanstack/react-query"
import type * as THREE from "three"
import { initManifold } from "../../lib/manifold"
import { colorForIndex } from "./groupColors"
import { setGroups } from "./groupsStore"
import { segment } from "./segment"
import type { Segmentation, SegmentationParams, SegmentInput, ShapeGroup } from "./types"

/**
 * The async seam between the React UI and the React-free segmentation pipeline.
 * Built on `useMutation` (the repo's async idiom — see `AssistantPanel`): there is
 * no query-key cache here, segmentation is an imperative "Segment" action the user
 * (or a debounced param change) fires via `run()`.
 *
 * RECON CORRECTION — this is a mutation, NOT a `useQuery` async-geometry pattern
 * (there is none in the repo). The public shape `{ segmentation, run, isPending,
 * error }` is the contract; M3.5 swaps the in-line `segment(...)` call for a Web
 * Worker behind it without changing that shape.
 *
 * TIER GATING — M2 enables `bodies` + `regions` (bodies become parentId targets,
 * patches are the emitted leaves); `primitives` stays off until M3 widens the
 * flags in `buildSegmentInput`'s call below.
 */

/**
 * Default tuning knobs (spec §7). All length knobs are fractions of the bbox
 * diagonal `D`; the orchestrator/tiers scale them by `D` internally. Angles are
 * radians. `seed` makes every randomized stage reproducible.
 */
export const defaultParams: SegmentationParams = {
    epsilon: 0.004, // 0.004·D max point↔surface distance for an inlier
    cosNormal: Math.cos((20 * Math.PI) / 180), // cos 20° ≈ 0.94 normal-deviation threshold
    minPoints: 50, // smallest acceptable primitive (inlier floor)
    probability: 0.02, // RANSAC miss-probability
    thetaCrease: (37 * Math.PI) / 180, // ~37° sharp-edge / hard-boundary dihedral
    thetaGrow: (18 * Math.PI) / 180, // ~18° region-grow smoothness threshold
    enabled: { plane: true, cylinder: true, sphere: true, cone: true },
    seed: 1
}

/** Which segmentation tiers run. M1 ships bodies only. */
export interface SegmentTiers {
    bodies: boolean
    regions: boolean
    primitives: boolean
}

/**
 * Pure: assemble the `SegmentInput` for the orchestrator from a (non-null)
 * geometry, fully-merged params, and the enabled tiers. Factored out of the hook
 * so it's unit-testable without React or the manifold WASM. `wasm` is supplied by
 * the hook's mutationFn (Tier-1 decompose needs it); it is intentionally absent
 * here so callers can fit it however they run the pipeline.
 *
 * Rejects a null geometry loudly — segmentation has nothing to weld without one,
 * and a thrown error here surfaces through the mutation's `error` rather than
 * crashing inside the pipeline.
 */
export const buildSegmentInput = (
    geometry: THREE.BufferGeometry | null,
    params: SegmentationParams,
    tiers: SegmentTiers
): SegmentInput => {
    if (!geometry) {
        throw new Error("useSegmentation: cannot segment a null geometry")
    }
    return { geometry, params, tiers }
}

/**
 * Pure: assign each group its index-derived distinct colour, preserving group
 * count and order. Returns fresh group objects (spread copies) so the store's
 * delete-on-replace identity check treats them as new. Factored out for unit
 * testing without React.
 */
export const applyColors = (groups: ShapeGroup[]): ShapeGroup[] =>
    groups.map((group, i) => ({ ...group, color: colorForIndex(i) }))

export interface UseSegmentationResult {
    /** The most recent successful, recoloured segmentation; `undefined` until one lands. */
    segmentation: Segmentation | undefined
    /** Fire a segmentation run over the current geometry. */
    run: () => void
    isPending: boolean
    error: Error | null
}

/**
 * Segment `geometry` on demand. `run()` boots the manifold singleton, runs the
 * pipeline (bodies + regions in M2), recolours the resulting groups by index, and
 * publishes them to `groupsStore`. The recoloured `Segmentation` is exposed as
 * `segmentation`.
 */
export const useSegmentation = (
    geometry: THREE.BufferGeometry | null,
    params?: Partial<SegmentationParams>
): UseSegmentationResult => {
    const merged: SegmentationParams = { ...defaultParams, ...params }

    const mutation = useMutation({
        mutationFn: async (): Promise<Segmentation> => {
            const wasm = await initManifold()
            // M2: bodies + regions. M3 flips primitives on here. Bodies become
            // parents (no body group), patches/unknown carry `parentId`.
            const input = buildSegmentInput(geometry, merged, { bodies: true, regions: true, primitives: false })
            const seg = segment({ ...input, wasm })
            return { ...seg, groups: applyColors(seg.groups) }
        },
        onSuccess: (seg) => {
            setGroups(seg.groups)
        }
    })

    return {
        segmentation: mutation.data,
        run: () => mutation.mutate(),
        isPending: mutation.isPending,
        error: mutation.error
    }
}
