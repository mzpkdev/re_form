import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import { initManifold } from "../../lib/manifold"
import { cube, plateWithHole, twoDisjointCubes } from "./fixtures"
import { weldAndAnalyze } from "./mesh"
import { handleSegmentMessage } from "./segment.worker"
import type { Segmentation } from "./types"
import { defaultParams, type SegmentTiers } from "./useSegmentation"

const context = describe

// The full M3 tier set the hook runs (and the worker therefore must handle).
const allTiers: SegmentTiers = { bodies: true, regions: true, primitives: true }

// Mirror the hook's main-thread step: COPY the geometry's position attribute into a
// fresh Float32Array and hand off its buffer, exactly as `useSegmentation` does before
// `postMessage`. Calling `handleSegmentMessage` with this buffer proves the pipeline
// runs through the worker's message handler — no real Worker, no `self`.
const positionsBufferOf = (geometry: THREE.BufferGeometry): ArrayBuffer =>
    new Float32Array(geometry.getAttribute("position").array).buffer

// F = the canonical welded face count the orchestrator partitions, derived from the
// same weld the worker runs internally so the assertion tracks the real face space.
const weldedFaceCount = (geometry: THREE.BufferGeometry): number => weldAndAnalyze(geometry).faceCount

// Assert the result is a complete Segmentation: groups present and their membership
// sets partition [0, F) — Σ tris === F, pairwise disjoint, union === [0, F).
const expectComplete = (seg: Segmentation, F: number): void => {
    expect(seg.groups.length).toBeGreaterThan(0)
    expect(seg.triangleCount).toBe(F)
    const seen = new Set<number>()
    let total = 0
    for (const group of seg.groups) {
        for (const f of group.triangleIndices) {
            expect(f).toBeGreaterThanOrEqual(0)
            expect(f).toBeLessThan(F)
            expect(seen.has(f)).toBe(false)
            seen.add(f)
            total++
        }
    }
    expect(total).toBe(F)
    expect(seen.size).toBe(F)
}

describe("handleSegmentMessage", () => {
    // The real `postMessage`/Vite-module-worker/manifold-wasm-asset path is exercised by
    // `bun run build` + M3 manual acceptance; here we drive the handler directly to prove
    // the whole pipeline (weld + decompose + sample + RANSAC + regions) runs inside it.
    context("cube (full M3 pipeline through the worker handler)", () => {
        it("returns a complete Segmentation partitioning [0, F)", async () => {
            await initManifold()
            const geometry = cube(2)

            const seg = await handleSegmentMessage({
                positions: positionsBufferOf(geometry),
                params: defaultParams,
                tiers: allTiers
            })

            expectComplete(seg, weldedFaceCount(geometry))
        })

        it("threads the supplied params onto the result", async () => {
            await initManifold()
            const geometry = cube(2)

            const seg = await handleSegmentMessage({
                positions: positionsBufferOf(geometry),
                params: defaultParams,
                tiers: allTiers
            })

            expect(seg.params).toEqual(defaultParams)
        })
    })

    context("plateWithHole (bodies + primitives + regions all active)", () => {
        it("returns a complete Segmentation with groups", async () => {
            await initManifold()
            const geometry = plateWithHole()

            const seg = await handleSegmentMessage({
                positions: positionsBufferOf(geometry),
                params: defaultParams,
                tiers: allTiers
            })

            expectComplete(seg, weldedFaceCount(geometry))
        })
    })

    context("twoDisjointCubes (Tier-1 decompose runs in the handler via manifold)", () => {
        it("returns a complete Segmentation — decompose ran off the supplied buffer", async () => {
            await initManifold()
            const geometry = twoDisjointCubes(1, 1)

            const seg = await handleSegmentMessage({
                positions: positionsBufferOf(geometry),
                params: defaultParams,
                tiers: allTiers
            })

            expectComplete(seg, weldedFaceCount(geometry))
        })
    })
})
