import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import { chamferedCube, cube, cylinder, plateWithHole } from "./fixtures"
import { weldAndAnalyze } from "./mesh"
import { growRegions } from "./regionGrow"
import type { MeshTopology, RegionResult, SegmentationParams } from "./types"

const context = describe

// Default §5/§7 params: thetaGrow ≈ 17° (0.3 rad), thetaCrease ≈ 34° (0.6 rad),
// with thetaGrow < thetaCrease for the hysteresis the grower relies on. Only the
// two dihedral thresholds matter here; the rest just satisfy the type.
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

// Weld the fixture and grow over an all-`-1` assignment (nothing pre-labelled),
// the M2 entry condition. Returns both the topology (for crease checks) and the
// region result.
const grow = (
    geometry: THREE.BufferGeometry,
    overrides: Partial<SegmentationParams> = {}
): { topo: MeshTopology; result: RegionResult } => {
    const topo = weldAndAnalyze(geometry)
    const assignment = new Int32Array(topo.faceCount).fill(-1)
    return { topo, result: growRegions(topo, assignment, defaultParams(overrides)) }
}

// The largest dihedral across any edge that is interior to a single patch — the
// "did a region swallow a crease" probe. Must stay ≤ thetaGrow for a correct grow.
const worstIntraPatchEdge = (topo: MeshTopology, result: RegionResult): number => {
    const patchOf = new Int32Array(topo.faceCount).fill(-1)
    result.patches.forEach((patch, i) => {
        for (const f of patch) patchOf[f] = i
    })
    let worst = 0
    for (let f = 0; f < topo.faceCount; f++) {
        if (patchOf[f] < 0) continue
        for (let slot = 0; slot < 3; slot++) {
            const neighbour = topo.faceAdjacency[3 * f + slot]
            if (neighbour < 0 || patchOf[neighbour] !== patchOf[f]) continue
            worst = Math.max(worst, topo.dihedral(f, neighbour))
        }
    }
    return worst
}

describe("growRegions", () => {
    context("a cube (six flat faces at 90°)", () => {
        it("splits into exactly six patches — adjacent faces meet above thetaGrow so never merge", () => {
            const { result } = grow(cube(1))
            expect(result.patches).toHaveLength(6)
        })

        it("places every face into a patch (nothing left over)", () => {
            const { topo, result } = grow(cube(1))
            const placed = result.patches.reduce((sum, p) => sum + p.length, 0)
            expect(placed).toBe(topo.faceCount)
            expect(result.remaining).toHaveLength(0)
        })

        it("gives each patch the two coplanar triangles of one cube face", () => {
            const { result } = grow(cube(1))
            for (const patch of result.patches) expect(patch).toHaveLength(2)
        })
    })

    context("disjointness and coverage (every fixture)", () => {
        const cases: Array<[string, THREE.BufferGeometry]> = [
            ["cube", cube(1)],
            ["plateWithHole", plateWithHole()],
            ["cylinder", cylinder(1, 2, 24)],
            ["chamferedCube", chamferedCube()]
        ]
        for (const [name, geometry] of cases) {
            it(`partitions the -1 faces: patches ∪ remaining cover [0,F) with no overlap (${name})`, () => {
                const { topo, result } = grow(geometry)
                const seen = new Set<number>()
                for (const patch of result.patches) {
                    for (const f of patch) {
                        expect(seen.has(f)).toBe(false) // disjoint across patches
                        seen.add(f)
                    }
                }
                for (const f of result.remaining) {
                    expect(seen.has(f)).toBe(false) // remaining disjoint from patches
                    seen.add(f)
                }
                expect(seen.size).toBe(topo.faceCount) // union === [0, F)
            })

            it(`emits sorted patches (${name})`, () => {
                const { result } = grow(geometry)
                for (const patch of result.patches) {
                    const sorted = Int32Array.from(patch).sort()
                    expect([...patch]).toEqual([...sorted])
                }
            })
        }
    })

    context("creases are respected (hard-stop at > thetaCrease)", () => {
        it("never crosses a sharp edge inside a single patch (cube — all 90° creases)", () => {
            const { topo, result } = grow(cube(1))
            expect(worstIntraPatchEdge(topo, result)).toBeLessThanOrEqual(defaultParams().thetaGrow + 1e-6)
        })

        it("keeps the chamfer bevel as its own patch — bevel↔face edges are creases", () => {
            // A chamfered cube has 6 cube-ish faces + 1 bevel; the bevel meets each
            // neighbour at 45° > thetaCrease, so it cannot be absorbed.
            const { topo, result } = grow(chamferedCube())
            expect(result.patches).toHaveLength(7)
            expect(worstIntraPatchEdge(topo, result)).toBeLessThanOrEqual(defaultParams().thetaGrow + 1e-6)
        })
    })

    context("a slot/pocket-like part (plate with a through-hole)", () => {
        it("keeps walls and floor as separate patches — no patch mixes a +Y face with a side wall", () => {
            const { topo, result } = grow(plateWithHole())
            const isTop = (f: number) => topo.faceNormals[3 * f + 1] > 0.99 // +Y normal
            const isWall = (f: number) =>
                Math.abs(topo.faceNormals[3 * f]) > 0.99 || Math.abs(topo.faceNormals[3 * f + 2]) > 0.99 // ±X/±Z

            let mixing = 0
            for (const patch of result.patches) {
                let hasTop = false
                let hasWall = false
                for (const f of patch) {
                    if (isTop(f)) hasTop = true
                    if (isWall(f)) hasWall = true
                }
                if (hasTop && hasWall) mixing++
            }
            expect(mixing).toBe(0)
        })

        it("never crosses a crease inside any patch", () => {
            const { topo, result } = grow(plateWithHole())
            expect(worstIntraPatchEdge(topo, result)).toBeLessThanOrEqual(defaultParams().thetaGrow + 1e-6)
        })
    })

    context("drift: a finely-faceted curved strip", () => {
        // Adjacent side-wall facets of a 24-gon cylinder meet at 15° (< thetaGrow),
        // so pairwise growth alone would chain the entire 48-triangle wall into one
        // region. The seed-normal cap breaks that drift into several regions.
        it("does NOT collapse the cylinder wall into a single region", () => {
            const { result } = grow(cylinder(1, 2, 24))
            // The wall is 48 of the 96 faces (two caps are 24 fan triangles each).
            const biggest = result.patches.reduce((max, p) => Math.max(max, p.length), 0)
            expect(biggest).toBeLessThan(48)
            // More than the trivial {wall, top cap, bottom cap} = 3 the no-drift
            // grower would yield: the wall itself is split.
            expect(result.patches.length).toBeGreaterThan(3)
        })

        it("still respects the no-crease-inside-a-patch invariant while splitting the wall", () => {
            const { topo, result } = grow(cylinder(1, 2, 24))
            expect(worstIntraPatchEdge(topo, result)).toBeLessThanOrEqual(defaultParams().thetaGrow + 1e-6)
        })

        it("merges the flat caps fully — coplanar fan triangles share one region each", () => {
            // Sanity that the drift cap doesn't over-fragment FLAT regions: each cap
            // is 24 coplanar triangles (0° between them) → one 24-face patch.
            const { result } = grow(cylinder(1, 2, 24))
            const twentyFours = result.patches.filter((p) => p.length === 24)
            expect(twentyFours).toHaveLength(2)
        })
    })

    context("the input assignment is treated as read-only", () => {
        it("does not mutate the caller's assignment array", () => {
            const topo = weldAndAnalyze(cube(1))
            const assignment = new Int32Array(topo.faceCount).fill(-1)
            const snapshot = Int32Array.from(assignment)
            growRegions(topo, assignment, defaultParams())
            expect([...assignment]).toEqual([...snapshot])
        })

        it("ignores already-labelled faces — only grows over -1", () => {
            const topo = weldAndAnalyze(cube(1))
            const assignment = new Int32Array(topo.faceCount).fill(-1)
            // Pre-label one whole cube face (faces 0 and 1 are the +Z quad pair).
            assignment[0] = 7
            assignment[1] = 7
            const result = growRegions(topo, assignment, defaultParams())
            // The five remaining faces → five patches; the labelled pair is untouched.
            expect(result.patches).toHaveLength(5)
            const placed = result.patches.reduce((sum, p) => sum + p.length, 0)
            expect(placed).toBe(topo.faceCount - 2)
            for (const patch of result.patches) {
                expect([...patch]).not.toContain(0)
                expect([...patch]).not.toContain(1)
            }
        })
    })
})
