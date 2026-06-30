import { describe, expect, it } from "bun:test"
import {
    claimsFace,
    compareCandidates,
    type FaceCandidate,
    faceVotes,
    resolveConflict,
    smoothBoundaries
} from "./assign"
import type { MeshTopology } from "./types"

const context = describe

/**
 * Hand-built topology exposing only what `smoothBoundaries` reads: `faceCount`,
 * `faceAdjacency`, and a `dihedral` closure. `creasePairs` lists unordered face
 * pairs whose shared edge is a crease (dihedral π); every other adjacent pair is
 * smooth (dihedral 0). Lets a test place creases exactly where it wants without a
 * real mesh.
 */
const topoWithCreases = (
    faceCount: number,
    adjacency: number[],
    creasePairs: ReadonlyArray<readonly [number, number]>
): MeshTopology => {
    const isCrease = (a: number, b: number): boolean =>
        creasePairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
    return {
        faceCount,
        faceAdjacency: Int32Array.from(adjacency),
        dihedral: (a, b) => (isCrease(a, b) ? Math.PI : 0)
    } as MeshTopology
}

/** Label-count histogram of an assignment, for conservation assertions. */
const histogram = (assignment: Int32Array): Map<number, number> => {
    const h = new Map<number, number>()
    for (const label of assignment) h.set(label, (h.get(label) ?? 0) + 1)
    return h
}

describe("faceVotes / claimsFace (§6.5c-i majority vote)", () => {
    context("inlier fraction per face", () => {
        // 4 sample points: 2 on face 0 (one inlier), 2 on face 1 (both inliers).
        const pointToTri = Int32Array.from([0, 0, 1, 1])

        it("computes the inlier fraction per face", () => {
            const inlier = [true, false, true, true]
            const fraction = faceVotes(pointToTri, inlier, 2)
            expect(fraction[0]).toBeCloseTo(0.5, 6)
            expect(fraction[1]).toBeCloseTo(1.0, 6)
        })

        it("scores a face with no inliers 0", () => {
            const fraction = faceVotes(pointToTri, [false, false, false, false], 2)
            expect(fraction[0]).toBe(0)
            expect(fraction[1]).toBe(0)
        })

        it("scores a face with no sample points 0", () => {
            // faceCount 3 but no point maps to face 2.
            const fraction = faceVotes(pointToTri, [true, true, true, true], 3)
            expect(fraction[2]).toBe(0)
        })
    })

    context("the strict-majority gate", () => {
        it("claims a face only above half", () => {
            expect(claimsFace(0.6)).toBe(true)
            expect(claimsFace(1)).toBe(true)
        })

        it("does not claim a face at or below half", () => {
            expect(claimsFace(0.5)).toBe(false)
            expect(claimsFace(0.4)).toBe(false)
            expect(claimsFace(0)).toBe(false)
        })
    })
})

describe("conflict resolution (§6.6.2)", () => {
    context("(i) higher inlier fraction wins — the 60/40 split", () => {
        it("lands the face in the 60 group", () => {
            const sixty: FaceCandidate = { shapeIndex: 0, fraction: 0.6, residual: 0.5 }
            const forty: FaceCandidate = { shapeIndex: 1, fraction: 0.4, residual: 0.1 }
            // 60 wins on fraction even though 40 has the lower residual.
            expect(resolveConflict([forty, sixty])).toBe(0)
            // Order-independent.
            expect(resolveConflict([sixty, forty])).toBe(0)
        })
    })

    context("(ii) tie on fraction → lower combined residual wins", () => {
        it("picks the lower-residual candidate", () => {
            const a: FaceCandidate = { shapeIndex: 0, fraction: 0.7, residual: 0.9 }
            const b: FaceCandidate = { shapeIndex: 1, fraction: 0.7, residual: 0.2 }
            expect(resolveConflict([a, b])).toBe(1)
            expect(resolveConflict([b, a])).toBe(1)
        })
    })

    context("(iii) still tied → the earlier / larger shape (lower index) wins", () => {
        it("breaks a full tie by detection order", () => {
            const earlier: FaceCandidate = { shapeIndex: 2, fraction: 0.7, residual: 0.3 }
            const later: FaceCandidate = { shapeIndex: 5, fraction: 0.7, residual: 0.3 }
            expect(resolveConflict([later, earlier])).toBe(2)
            expect(resolveConflict([earlier, later])).toBe(2)
        })
    })

    context("comparator and degenerate input", () => {
        it("is a total ordering consistent with resolveConflict", () => {
            const a: FaceCandidate = { shapeIndex: 0, fraction: 0.6, residual: 0.5 }
            const b: FaceCandidate = { shapeIndex: 1, fraction: 0.4, residual: 0.1 }
            expect(compareCandidates(a, b)).toBeLessThan(0)
            expect(compareCandidates(b, a)).toBeGreaterThan(0)
        })

        it("returns the sole candidate's index", () => {
            expect(resolveConflict([{ shapeIndex: 3, fraction: 0.9, residual: 0.1 }])).toBe(3)
        })

        it("throws on an empty candidate list", () => {
            expect(() => resolveConflict([])).toThrow()
        })
    })
})

describe("smoothBoundaries (§6.5c-ii one-ring smoothing)", () => {
    context("never relabels across a crease edge", () => {
        // Faces 0 and 1 carry labels 0 and 1 and meet across a CREASE. Even though
        // each is the other's only neighbour, the crease is a hard wall: neither
        // may be pulled to the other's label.
        const topo = topoWithCreases(2, [1, -1, -1, 0, -1, -1], [[0, 1]])

        it("leaves a labelled face untouched across a crease", () => {
            const out = smoothBoundaries(Int32Array.from([0, 1]), topo, { thetaCrease: Math.PI / 4 })
            expect(Array.from(out)).toEqual([0, 1])
        })

        it("does not pull a -1 face across a crease either", () => {
            // Face 0 unassigned, face 1 labelled, edge between them is a crease.
            const out = smoothBoundaries(Int32Array.from([-1, 1]), topo, { thetaCrease: Math.PI / 4 })
            expect(out[0]).toBe(-1)
        })
    })

    context("relabels a stray boundary face across smooth edges", () => {
        // Center face 2 (label 9, a stray) is surrounded by faces 0, 1, 3 all
        // labelled 7 across SMOOTH edges. One-ring majority (3×7 vs the seeded
        // self-vote of 9) flips it to 7.
        const topo = topoWithCreases(
            4,
            [
                // face 0: neighbour 2
                2, -1, -1,
                // face 1: neighbour 2
                2, -1, -1,
                // face 2 (center): neighbours 0,1,3
                0, 1, 3,
                // face 3: neighbour 2
                2, -1, -1
            ],
            [] // all edges smooth
        )

        it("moves the stray face to the smooth-neighbour majority", () => {
            const out = smoothBoundaries(Int32Array.from([7, 7, 9, 7]), topo, { thetaCrease: Math.PI / 4 })
            expect(out[2]).toBe(7)
        })

        it("conserves label counts (only moves a label, never creates/loses one)", () => {
            const input = Int32Array.from([7, 7, 9, 7])
            const out = smoothBoundaries(input, topo, { thetaCrease: Math.PI / 4 })
            // Same number of faces, and every output label existed in the input.
            expect(out.length).toBe(input.length)
            const inLabels = new Set(input)
            for (const label of out) expect(inLabels.has(label)).toBe(true)
        })

        it("does not flip the face when the majority reaches it only across creases", () => {
            // Same star, but every spoke edge is now a crease — the 7-neighbours
            // can't vote, so the stray 9 stays.
            const creased = topoWithCreases(
                4,
                [2, -1, -1, 2, -1, -1, 0, 1, 3, 2, -1, -1],
                [
                    [0, 2],
                    [1, 2],
                    [2, 3]
                ]
            )
            const out = smoothBoundaries(Int32Array.from([7, 7, 9, 7]), creased, { thetaCrease: Math.PI / 4 })
            expect(out[2]).toBe(9)
        })
    })

    context("conservation and purity on a larger mixed assignment", () => {
        // A 3-face fan: center 0 (label A) with two smooth spokes to 1 (B) and
        // 2 (B). A single lone dissenter never flips on a tie, but a 2-vs-1
        // majority does — assert the histogram is preserved either way.
        const topo = topoWithCreases(3, [1, 2, -1, 0, -1, -1, 0, -1, -1], [])

        it("relabels the center to the 2-neighbour majority and conserves counts", () => {
            const input = Int32Array.from([1, 2, 2])
            const before = histogram(input)
            const out = smoothBoundaries(input, topo, { thetaCrease: Math.PI / 4 })
            // Center had label 1, two smooth neighbours label 2 → flips to 2.
            expect(out[0]).toBe(2)
            // Histogram total conserved; the label set is a subset of the input's.
            const after = histogram(out)
            let total = 0
            for (const [, count] of after) total += count
            expect(total).toBe(input.length)
            for (const label of after.keys()) expect(before.has(label)).toBe(true)
        })

        it("does not mutate the input array", () => {
            const input = Int32Array.from([1, 2, 2])
            const snapshot = Array.from(input)
            smoothBoundaries(input, topo, { thetaCrease: Math.PI / 4 })
            expect(Array.from(input)).toEqual(snapshot)
        })

        it("keeps a face that is tied between staying and one neighbour", () => {
            // Center A, one neighbour B, one neighbour A → {A:2, B:1}, stays A.
            const out = smoothBoundaries(Int32Array.from([0, 1, 0]), topo, { thetaCrease: Math.PI / 4 })
            expect(out[0]).toBe(0)
        })
    })
})
