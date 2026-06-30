import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import { cube, degenerate } from "./fixtures"
import { weldAndAnalyze } from "./mesh"
import { segment } from "./segment"
import type { SegmentationParams, SegmentInput } from "./types"

const context = describe

// Default §5 params; the M0 orchestrator path never reads any tolerance (no tier
// runs), so the exact values are immaterial — they just satisfy the type.
const defaultParams = (overrides: Partial<SegmentationParams> = {}): SegmentationParams => ({
    epsilon: 0.004,
    cosNormal: 0.94,
    minPoints: 50,
    probability: 0.02,
    thetaCrease: 0.6,
    thetaGrow: 0.3,
    enabled: { plane: true, cylinder: true, sphere: true, cone: true },
    seed: 1,
    ...overrides
})

// All tier flags off — the M0 live path. bodies/regions/primitives are exercised
// in M1/M2/M3.
const allTiersOff = (geometry: THREE.BufferGeometry, overrides: Partial<SegmentInput> = {}): SegmentInput => ({
    geometry,
    params: defaultParams(),
    tiers: { bodies: false, regions: false, primitives: false },
    ...overrides
})

// The number of welded faces the orchestrator works in — the F every membership
// set must partition. Derived from the same weld the orchestrator runs, so the
// test asserts against the canonical face space rather than a magic number.
const weldedFaceCount = (geometry: THREE.BufferGeometry): number => weldAndAnalyze(geometry).faceCount

// Assert the §6.6 invariant directly off a result: sizes sum to F, sets are
// pairwise disjoint, and the union is exactly [0, F).
const expectPartition = (result: ReturnType<typeof segment>, F: number): void => {
    expect(result.triangleCount).toBe(F)
    const seen = new Set<number>()
    let total = 0
    for (const group of result.groups) {
        for (const f of group.triangleIndices) {
            expect(f).toBeGreaterThanOrEqual(0)
            expect(f).toBeLessThan(F)
            expect(seen.has(f)).toBe(false) // disjoint: no face claimed twice
            seen.add(f)
            total++
        }
    }
    expect(total).toBe(F) // Σ lengths === F
    expect(seen.size).toBe(F) // union === [0, F)
}

describe("segment", () => {
    context("degenerate input (single zero-area triangle)", () => {
        it("produces one unknown group and does not crash", () => {
            const result = segment(allTiersOff(degenerate()))

            expect(result.groups).toHaveLength(1)
            expect(result.groups[0].kind).toBe("unknown")
            expect(result.groups[0].triangleIndices).toHaveLength(1)
        })

        it("still partitions [0, F) over the degenerate face", () => {
            const geometry = degenerate()

            const result = segment(allTiersOff(geometry))

            expectPartition(result, weldedFaceCount(geometry))
        })
    })

    context("cube with all tier flags off", () => {
        it("collapses the whole mesh into one unknown group of F faces", () => {
            const geometry = cube()
            const F = weldedFaceCount(geometry)

            const result = segment(allTiersOff(geometry))

            expect(result.groups).toHaveLength(1)
            const [group] = result.groups
            expect(group.kind).toBe("unknown")
            expect(group.params).toEqual({ kind: "unknown" })
            expect(group.triangleIndices.length).toBe(F)
        })

        it("satisfies completeness, disjointness, and union === [0, F)", () => {
            const geometry = cube()

            const result = segment(allTiersOff(geometry))

            expectPartition(result, weldedFaceCount(geometry))
        })

        it("assembles a usable group: stable id, label, placeholder color, bbox over the cube", () => {
            const result = segment(allTiersOff(cube(2)))

            const [group] = result.groups
            expect(group.id).toMatch(/^[0-9a-f-]{36}$/) // crypto.randomUUID shape
            expect(group.label).toBe("Unknown")
            expect(group.color).toHaveLength(3)
            // The single group owns every face, so its bbox is the cube's full extent.
            expect(group.bbox.min).toEqual([-1, -1, -1])
            expect(group.bbox.max).toEqual([1, 1, 1])
        })

        it("threads the input params through onto the result", () => {
            const params = defaultParams({ seed: 7 })

            const result = segment({
                geometry: cube(),
                params,
                tiers: { bodies: false, regions: false, primitives: false }
            })

            expect(result.params).toBe(params)
        })
    })
})
