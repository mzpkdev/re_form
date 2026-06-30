import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import type * as THREE from "three"
import { colorForIndex } from "./groupColors"
import { setGroups } from "./groupsStore"
import type { SegmentMessage } from "./segment.worker"
import type { Segmentation, SegmentationParams, SegmentInput, ShapeGroup } from "./types"

/**
 * The async seam between the React UI and the React-free segmentation pipeline.
 * Built on `useMutation` (the repo's async idiom — see `AssistantPanel`): there is
 * no query-key cache here, segmentation is an imperative "Segment" action the user
 * (or a debounced param change) fires via `run()`.
 *
 * RECON CORRECTION — this is a mutation, NOT a `useQuery` async-geometry pattern
 * (there is none in the repo). The public shape `{ segmentation, run, isPending,
 * error }` is the contract; M3.5 swapped the in-line `segment(...)` call for a Web
 * Worker behind it WITHOUT changing that shape — `run()` still fires the mutation,
 * `isPending` still tracks one in flight, `error` still surfaces a thrown failure;
 * only the work moved off-thread (see the `mutationFn` below).
 *
 * TIER GATING — M3 enables `bodies` + `regions` + `primitives`: bodies become
 * parentId targets, and the emitted leaves are the fitted primitives plus the
 * region patches plus the unknown bucket (all carrying `parentId`).
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

/** Which segmentation tiers run. M3 ships bodies + regions + primitives. */
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
 * Segment `geometry` on demand. `run()` posts the work to a Web Worker that boots
 * the manifold singleton and runs the whole pipeline (bodies + regions +
 * primitives in M3) off the main thread; the recoloured groups come back, get
 * coloured by index here, and are published to `groupsStore`. The recoloured
 * `Segmentation` is exposed as `segmentation`.
 *
 * WORKER LIFECYCLE — one module worker is created per hook instance (in a ref,
 * lazily on first `run`) and `terminate()`d on unmount. The `mutationFn` posts a
 * COPY of the positions and awaits the single reply via a one-shot `onmessage`
 * handler; `isPending`/`error`/`run` semantics are unchanged from the inline M1
 * version — only the work crossed the worker boundary.
 */
export const useSegmentation = (
    geometry: THREE.BufferGeometry | null,
    params?: Partial<SegmentationParams>
): UseSegmentationResult => {
    const merged: SegmentationParams = { ...defaultParams, ...params }

    // The worker is created once and reused across runs; `terminate()` on unmount
    // is the three.js-style "free what you allocate" for the worker thread.
    const workerRef = useRef<Worker | null>(null)
    useEffect(() => {
        return () => {
            workerRef.current?.terminate()
            workerRef.current = null
        }
    }, [])

    const mutation = useMutation({
        mutationFn: async (): Promise<Segmentation> => {
            // Validate up front (loud null-geometry error, same as inline) so the
            // worker only ever receives a real buffer. `buildSegmentInput` also
            // pins the M3 tiers used both here and inside the worker.
            const input = buildSegmentInput(geometry, merged, { bodies: true, regions: true, primitives: true })

            // COPY the live position attribute into a fresh Float32Array. We must
            // NOT transfer the rendered geometry's own buffer — `SegmentViewport`
            // renders this same `importedGeometry`, and a transfer would neuter its
            // copy and blank the viewport. The copy is what we hand off (and the
            // worker is free to neuter THAT).
            const source = input.geometry.getAttribute("position").array
            const positions = new Float32Array(source)

            if (!workerRef.current) {
                workerRef.current = new Worker(new URL("./segment.worker.ts", import.meta.url), { type: "module" })
            }
            const worker = workerRef.current

            const message: SegmentMessage = { positions: positions.buffer, params: merged, tiers: input.tiers }
            const seg = await new Promise<Segmentation>((resolve, reject) => {
                const onMessage = (e: MessageEvent<Segmentation>): void => {
                    cleanup()
                    resolve(e.data)
                }
                const onError = (e: ErrorEvent): void => {
                    cleanup()
                    reject(e.error ?? new Error(e.message || "segment.worker failed"))
                }
                const cleanup = (): void => {
                    worker.removeEventListener("message", onMessage)
                    worker.removeEventListener("error", onError)
                }
                worker.addEventListener("message", onMessage)
                worker.addEventListener("error", onError)
                worker.postMessage(message, [positions.buffer])
            })

            // Recolour on the main thread exactly as the inline version did — the
            // worker returns placeholder-coloured groups; `applyColors` runs here
            // on the returned groups (no geometry/manifold work involved).
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
