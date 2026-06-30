import * as THREE from "three"
import { initManifold } from "../../lib/manifold"
import { segment } from "./segment"
import type { Segmentation, SegmentationParams } from "./types"
import type { SegmentTiers } from "./useSegmentation"

/**
 * The off-thread home of the segmentation pipeline (M3.5). The full `segment(...)`
 * pipeline — weld + Tier-1 decompose + sampleCloud + RANSAC + regions — is CPU-heavy
 * and janks the UI when run inline on a re-segment, so it runs here in a module Web
 * Worker instead. `useSegmentation` keeps its public `{ segmentation, run, isPending,
 * error }` shape; only the runner moved.
 *
 * FULL-PIPELINE-IN-WORKER (plan §8 decision point — landed on the preferred path):
 * the WHOLE pipeline, INCLUDING Tier-1 `decompose`, runs here. `decompose` needs the
 * manifold WASM singleton, so the worker `await initManifold()` itself — Vite's module
 * worker resolves the `manifold-3d` wasm asset relative to the worker bundle exactly as
 * it does for the main chunk (verified by `bun run build`). This keeps `segment()`
 * itself untouched: it still receives a `wasm` handle and runs every tier in one place.
 * The fallback (keep decompose on the main thread, run only sampling+RANSAC+regions in
 * the worker) was NOT needed — `initManifold()` loads cleanly under the worker build.
 *
 * INPUT IS A COPIED BUFFER, NOT THE LIVE GEOMETRY: the caller transfers a FRESH
 * `Float32Array` copy of the rendered geometry's positions (see `useSegmentation`),
 * never the live attribute's buffer — transferring that would neuter the viewport's
 * rendered copy. We rebuild a NON-INDEXED `THREE.BufferGeometry` (the triangle-soup
 * shape `parseStl`/the fixtures produce) from the transferred buffer; `weldAndAnalyze`
 * welds and indexes it downstream, so a non-indexed soup is the correct input.
 */

/** The message the main thread posts to the worker for one segmentation run. */
export interface SegmentMessage {
    /** Transferred copy of the geometry's `position` attribute (xyz-interleaved, soup). */
    positions: ArrayBuffer
    params: SegmentationParams
    tiers: SegmentTiers
}

/**
 * Pure, testable message handler — the unit of work the worker entry wraps. Kept a
 * named export with no `self`/Worker dependency so a spec can drive the entire
 * pipeline (`bun:test`, `await initManifold()`) by calling it directly, with no real
 * Worker. Reconstructs the non-indexed geometry from the transferred buffer, boots the
 * manifold singleton IN THE WORKER, and returns a complete `Segmentation`.
 *
 * The returned `Segmentation`'s `Int32Array`s structured-clone fine across the worker
 * boundary; the entry transfers their buffers for zero-copy delivery (see below).
 */
export const handleSegmentMessage = async (data: SegmentMessage): Promise<Segmentation> => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(data.positions), 3))

    const wasm = await initManifold()

    return segment({ geometry, wasm, params: data.params, tiers: data.tiers })
}

/**
 * Collect the transferable buffers backing a `Segmentation` so the entry can hand them
 * off zero-copy. Only each group's `triangleIndices` buffer is owned by this result
 * (the geometry is local and discarded), so transferring them is safe — the worker
 * never reads the result again after posting.
 */
const transferables = (result: Segmentation): ArrayBuffer[] =>
    result.groups.map((group) => group.triangleIndices.buffer as ArrayBuffer)

// Worker entry. Guarded so importing this module in a non-worker context (the spec,
// which only wants `handleSegmentMessage`) doesn't throw on a missing `self.onmessage`.
if (typeof self !== "undefined" && "onmessage" in self) {
    self.onmessage = async (e: MessageEvent<SegmentMessage>) => {
        const result = await handleSegmentMessage(e.data)
        self.postMessage(result, transferables(result))
    }
}
