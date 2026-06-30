import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import { initManifold } from "../../lib/manifold"
import { chamferedCube, cube, twoDisjointCubes } from "./fixtures"
import { weldAndAnalyze } from "./mesh"
import { segment } from "./segment"
import type { SegmentationParams, SegmentInput, ShapeGroup } from "./types"

const context = describe

// Default §5 params. The cube/chamfer fixtures are axis-aligned, so the exact
// crease/grow angles only need to keep a flat face whole (it does at ~37°/18°).
const defaultParams = (overrides: Partial<SegmentationParams> = {}): SegmentationParams => ({
    epsilon: 0.004,
    cosNormal: 0.94,
    minPoints: 50,
    probability: 0.02,
    thetaCrease: (37 * Math.PI) / 180,
    thetaGrow: (18 * Math.PI) / 180,
    enabled: { plane: true, cylinder: true, sphere: true, cone: true },
    seed: 1,
    ...overrides
})

// bodies + regions on — the M2 live path: bodies are parentId targets (no body
// group is emitted) and patches are the leaves.
const bodiesAndRegions = (geometry: THREE.BufferGeometry, overrides: Partial<SegmentInput> = {}): SegmentInput => ({
    geometry,
    params: defaultParams(),
    tiers: { bodies: true, regions: true, primitives: false },
    ...overrides
})

// bodies only, regions off — the M1 live path (must stay byte-unchanged): bodies
// are leaf groups, no patches.
const bodiesOnly = (geometry: THREE.BufferGeometry, overrides: Partial<SegmentInput> = {}): SegmentInput => ({
    geometry,
    params: defaultParams(),
    tiers: { bodies: true, regions: false, primitives: false },
    ...overrides
})

const weldedFaceCount = (geometry: THREE.BufferGeometry): number => weldAndAnalyze(geometry).faceCount

// Assert the §6.6 invariant directly off a result: sizes sum to F, sets are
// pairwise disjoint, and the union is exactly [0, F). Leaf partition only — the
// hierarchy rides on parentId, NOT on extra container groups, so EVERY emitted
// group's faces participate.
const expectPartition = (result: ReturnType<typeof segment>, F: number): void => {
    expect(result.triangleCount).toBe(F)
    const seen = new Set<number>()
    let total = 0
    for (const group of result.groups) {
        for (const f of group.triangleIndices) {
            expect(f).toBeGreaterThanOrEqual(0)
            expect(f).toBeLessThan(F)
            expect(seen.has(f)).toBe(false) // disjoint
            seen.add(f)
            total++
        }
    }
    expect(total).toBe(F) // Σ lengths === F
    expect(seen.size).toBe(F) // union === [0, F)
}

const patchGroups = (groups: ShapeGroup[]): ShapeGroup[] => groups.filter((g) => g.kind === "patch")

describe("segment — regions tier (M2.3)", () => {
    context("cube with bodies + regions on", () => {
        it("yields 6 patch groups (one per flat face) and no body group", async () => {
            const wasm = await initManifold()

            const result = segment(bodiesAndRegions(cube(), { wasm }))

            expect(patchGroups(result.groups)).toHaveLength(6)
            // Bodies are parents only — never emitted as groups in the regions-on path.
            expect(result.groups.some((g) => g.kind === "body")).toBe(false)
        })

        it("parents every patch to the SAME single body", async () => {
            const wasm = await initManifold()

            const result = segment(bodiesAndRegions(cube(), { wasm }))

            const parents = new Set(patchGroups(result.groups).map((g) => g.parentId))
            expect(parents.size).toBe(1)
            // A cube is one body, so the shared parent is a real (non-null) id.
            const [only] = [...parents]
            expect(only).toMatch(/^[0-9a-f-]{36}$/)
        })

        it("partitions [0, F) over the leaf groups", async () => {
            const wasm = await initManifold()
            const geometry = cube()

            const result = segment(bodiesAndRegions(geometry, { wasm }))

            expectPartition(result, weldedFaceCount(geometry))
        })
    })

    context("twoDisjointCubes with bodies + regions on", () => {
        it("splits patches across exactly two distinct parents", async () => {
            const wasm = await initManifold()

            const result = segment(bodiesAndRegions(twoDisjointCubes(1, 1), { wasm }))

            const parents = new Set(patchGroups(result.groups).map((g) => g.parentId))
            expect(parents.size).toBe(2)
            // Both parents are real body ids (a patch never has a null parent here,
            // since region growth can't cross the disconnected-body boundary).
            for (const p of parents) {
                expect(p).toMatch(/^[0-9a-f-]{36}$/)
            }
        })

        it("keeps completeness over two bodies' worth of faces", async () => {
            const wasm = await initManifold()
            const geometry = twoDisjointCubes(1, 1)

            const result = segment(bodiesAndRegions(geometry, { wasm }))

            expectPartition(result, weldedFaceCount(geometry))
        })
    })

    context("chamferedCube with bodies + regions on", () => {
        it("emits the bevel as its own patch (one more patch than the un-chamfered cube)", async () => {
            const wasm = await initManifold()

            const result = segment(bodiesAndRegions(chamferedCube(), { wasm }))

            // 6 base faces + 1 bevel = 7 distinct flat patches; the bevel cannot
            // merge into either neighbour across its 45° creases.
            expect(patchGroups(result.groups)).toHaveLength(7)
        })

        it("parents the whole chamfered solid to one body and still partitions", async () => {
            const wasm = await initManifold()
            const geometry = chamferedCube()

            const result = segment(bodiesAndRegions(geometry, { wasm }))

            const parents = new Set(patchGroups(result.groups).map((g) => g.parentId))
            expect(parents.size).toBe(1)
            expectPartition(result, weldedFaceCount(geometry))
        })
    })

    context("regions OFF path is unchanged (M1)", () => {
        it("still emits one body leaf group per body, with null parentId", async () => {
            const wasm = await initManifold()

            const result = segment(bodiesOnly(cube(), { wasm }))

            expect(result.groups).toHaveLength(1)
            const [body] = result.groups
            expect(body.kind).toBe("body")
            expect(body.label).toBe("Body 1")
            expect(body.parentId ?? null).toBeNull()
            expect(patchGroups(result.groups)).toHaveLength(0)
        })

        it("emits a body leaf per disjoint body and partitions [0, F)", async () => {
            const wasm = await initManifold()
            const geometry = twoDisjointCubes(1, 1)

            const result = segment(bodiesOnly(geometry, { wasm }))

            const bodies = result.groups.filter((g) => g.kind === "body")
            expect(bodies).toHaveLength(2)
            for (const b of bodies) {
                expect(b.parentId ?? null).toBeNull()
            }
            expectPartition(result, weldedFaceCount(geometry))
        })
    })
})
