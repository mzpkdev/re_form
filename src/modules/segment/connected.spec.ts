import { describe, expect, it } from "bun:test"
import { connectedComponents } from "./connected"
import { cube, twoCoplanarSquares } from "./fixtures"
import { weldAndAnalyze } from "./mesh"
import type { MeshTopology } from "./types"

const context = describe

/**
 * Minimal hand-built topology: only the fields `connectedComponents` reads
 * (`faceCount`, `faceAdjacency`). Adjacency is the slot scheme from `MeshTopology`
 * — three slots per face, neighbour face index or `-1`/`-2`.
 */
const topoFromAdjacency = (faceCount: number, adjacency: number[]): MeshTopology =>
    ({
        faceCount,
        faceAdjacency: Int32Array.from(adjacency)
    }) as MeshTopology

/** Union of all components, as a plain sorted array, for partition assertions. */
const unionOf = (components: Int32Array[]): number[] => components.flatMap((c) => Array.from(c)).sort((a, b) => a - b)

describe("connectedComponents", () => {
    context("two disjoint coplanar squares as one face subset", () => {
        // twoCoplanarSquares → 4 welded faces: {0,1} are one square, {2,3} the
        // other. They share the +Y orientation but no edge, so a single subset
        // spanning all four must split into two components.
        const topo = weldAndAnalyze(twoCoplanarSquares())
        const components = connectedComponents([0, 1, 2, 3], topo)

        it("splits the coplanar set into two components", () => {
            expect(components.length).toBe(2)
        })

        it("groups each square's two triangles together", () => {
            const asArrays = components.map((c) => Array.from(c)).sort((a, b) => a[0] - b[0])
            expect(asArrays).toEqual([
                [0, 1],
                [2, 3]
            ])
        })

        it("returns disjoint components whose union is the input", () => {
            const a = new Set(components[0])
            const b = new Set(components[1])
            // Disjoint: no face in both.
            for (const f of a) expect(b.has(f)).toBe(false)
            // Union == input set.
            expect(unionOf(components)).toEqual([0, 1, 2, 3])
        })

        it("returns each component as a sorted Int32Array", () => {
            for (const c of components) {
                expect(c).toBeInstanceOf(Int32Array)
                expect(Array.from(c)).toEqual([...c].sort((x, y) => x - y))
            }
        })
    })

    context("a single connected patch (one square)", () => {
        const topo = weldAndAnalyze(twoCoplanarSquares())

        it("returns exactly one component", () => {
            const components = connectedComponents([0, 1], topo)
            expect(components.length).toBe(1)
            expect(Array.from(components[0])).toEqual([0, 1])
        })
    })

    context("counting an edge only when BOTH faces are in the subset", () => {
        // A path 0—1—2 (each face adjacent to the next via slot 0). Dropping the
        // middle face from the subset must break {0,2} into two components, even
        // though 0 and 2 are each adjacent to the absent face 1.
        const topo = topoFromAdjacency(
            3,
            [
                // face 0: neighbour 1 across slot 0
                1, -1, -1,
                // face 1: neighbours 0 and 2
                0, 2, -1,
                // face 2: neighbour 1 across slot 0
                1, -1, -1
            ]
        )

        it("ignores adjacency to a face outside the subset", () => {
            const components = connectedComponents([0, 2], topo)
            expect(components.length).toBe(2)
            expect(components.map((c) => Array.from(c)).sort((a, b) => a[0] - b[0])).toEqual([[0], [2]])
        })

        it("links the faces when the connecting face is included", () => {
            const components = connectedComponents([0, 1, 2], topo)
            expect(components.length).toBe(1)
            expect(Array.from(components[0])).toEqual([0, 1, 2])
        })
    })

    context("non-manifold and boundary edges never link", () => {
        // Two faces sharing a NON-manifold edge (slot value -2 on both): a hard
        // boundary, so even in the subset they stay separate.
        const topo = topoFromAdjacency(2, [-2, -1, -1, -2, -1, -1])

        it("does not cross a -2 (non-manifold) edge", () => {
            const components = connectedComponents([0, 1], topo)
            expect(components.length).toBe(2)
        })
    })

    context("a fully connected mesh (cube)", () => {
        it("returns one component covering all faces", () => {
            const topo = weldAndAnalyze(cube())
            const all = Int32Array.from({ length: topo.faceCount }, (_u, i) => i)
            const components = connectedComponents(all, topo)
            expect(components.length).toBe(1)
            expect(Array.from(components[0])).toEqual(Array.from(all))
        })
    })

    context("edge cases", () => {
        const topo = weldAndAnalyze(twoCoplanarSquares())

        it("returns [] for an empty subset", () => {
            expect(connectedComponents([], topo)).toEqual([])
        })

        it("deduplicates repeated indices and is independent of input order", () => {
            const a = connectedComponents([3, 2, 1, 0], topo)
            const b = connectedComponents([0, 0, 1, 2, 3, 3], topo)
            const norm = (cs: Int32Array[]) => cs.map((c) => Array.from(c))
            expect(norm(a)).toEqual([
                [0, 1],
                [2, 3]
            ])
            expect(norm(b)).toEqual(norm(a))
        })

        it("accepts a readonly number[] as well as an Int32Array", () => {
            const fromArray = connectedComponents([0, 1, 2, 3], topo)
            const fromTyped = connectedComponents(Int32Array.from([0, 1, 2, 3]), topo)
            expect(fromArray.map((c) => Array.from(c))).toEqual(fromTyped.map((c) => Array.from(c)))
        })
    })
})
