import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { cube } from "./fixtures"
import { weldAndAnalyze } from "./mesh"

const context = describe

/** Non-indexed triangle-soup geometry from a flat xyz position list (× 9). */
const soup = (positions: number[]): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3))
    return geometry
}

const PI = Math.PI

describe("weldAndAnalyze", () => {
    context("bbox diagonal D", () => {
        it("is √3·side for a unit cube", () => {
            const topology = weldAndAnalyze(cube(1))
            expect(topology.D).toBeCloseTo(Math.sqrt(3), 6)
        })

        it("scales with the cube size", () => {
            const topology = weldAndAnalyze(cube(2))
            expect(topology.D).toBeCloseTo(2 * Math.sqrt(3), 6)
        })
    })

    context("welding", () => {
        it("collapses a cube soup (36 corners) to 8 shared vertices", () => {
            const topology = weldAndAnalyze(cube(1))
            expect(topology.vertexCount).toBe(8)
            expect(topology.faceCount).toBe(12)
        })
    })

    context("dihedral", () => {
        // Two triangles meeting along the shared edge from (0,0,0) to (1,0,0).
        // The first lies flat in the XY plane (normal +Z); the second's free
        // corner moves to set the fold angle between them.
        const folded = (free: [number, number, number]): THREE.BufferGeometry =>
            soup([
                // flat triangle in z=0, normal +Z
                0,
                0,
                0,
                1,
                0,
                0,
                0,
                1,
                0,
                // second triangle sharing the (0,0,0)-(1,0,0) edge
                0,
                0,
                0,
                1,
                0,
                0,
                ...free
            ])

        it("is ≈0 for coplanar faces", () => {
            // Second triangle also in z=0, same winding → both normals +Z → angle 0.
            const topology = weldAndAnalyze(folded([1, 1, 0]))
            expect(topology.dihedral(0, 1)).toBeCloseTo(0, 5)
        })

        it("is ≈π/2 for faces meeting at a right angle", () => {
            // Free corner lifted to +Z → second normal -Y, ⟂ the first's +Z.
            const topology = weldAndAnalyze(folded([0, 0, 1]))
            expect(topology.dihedral(0, 1)).toBeCloseTo(PI / 2, 5)
        })

        it("is ≈π for a face folded flat back on itself (opposite normals)", () => {
            // Free corner at -Y keeps the triangle in z=0 but flips its winding
            // relative to the shared edge → normals +Z and -Z, dot -1.
            const topology = weldAndAnalyze(folded([0, -1, 0]))
            expect(topology.dihedral(0, 1)).toBeCloseTo(PI, 5)
        })

        it("clamps the dot product (never NaN at the extremes)", () => {
            const topology = weldAndAnalyze(folded([0, -1, 0]))
            expect(Number.isNaN(topology.dihedral(0, 1))).toBe(false)
        })
    })

    context("adjacency on a 2-triangle quad", () => {
        // A unit square in z=0 split along the (1,0,0)-(0,1,0) diagonal into
        // face 0 = (0,0)(1,0)(0,1) and face 1 = (1,0)(1,1)(0,1). The diagonal is
        // the only shared (interior) edge; the other four are boundary.
        const quad = (): THREE.BufferGeometry =>
            soup([
                0,
                0,
                0,
                1,
                0,
                0,
                0,
                1,
                0, // face 0
                1,
                0,
                0,
                1,
                1,
                0,
                0,
                1,
                0 // face 1
            ])

        it("points each face's shared-diagonal slot at the other face", () => {
            const topology = weldAndAnalyze(quad())
            expect(topology.faceCount).toBe(2)
            // Face 0 slots are edges (v0→v1, v1→v2, v2→v0). Exactly one neighbour
            // entry (the diagonal) is the other face; the rest are boundary.
            const face0 = [...topology.faceAdjacency.slice(0, 3)]
            const face1 = [...topology.faceAdjacency.slice(3, 6)]
            expect(face0.filter((s) => s === 1)).toHaveLength(1)
            expect(face1.filter((s) => s === 0)).toHaveLength(1)
        })

        it("marks the four outer edges as boundary (-1)", () => {
            const topology = weldAndAnalyze(quad())
            const all = [...topology.faceAdjacency]
            expect(all.filter((s) => s === -1)).toHaveLength(4)
            expect(all.filter((s) => s >= 0)).toHaveLength(2)
        })

        it("records no non-manifold edges", () => {
            const topology = weldAndAnalyze(quad())
            expect(topology.nonManifoldEdges.size).toBe(0)
        })

        it("makes the diagonal adjacency mutual (a→b and b→a)", () => {
            const topology = weldAndAnalyze(quad())
            // Slot in face 0 that points at face 1.
            const slot0 = [...topology.faceAdjacency.slice(0, 3)].indexOf(1)
            const slot1 = [...topology.faceAdjacency.slice(3, 6)].indexOf(0)
            expect(slot0).toBeGreaterThanOrEqual(0)
            expect(slot1).toBeGreaterThanOrEqual(0)
        })
    })

    context("a closed manifold mesh", () => {
        it("has no boundary or non-manifold edges (cube)", () => {
            const topology = weldAndAnalyze(cube(1))
            const all = [...topology.faceAdjacency]
            expect(all.every((s) => s >= 0)).toBe(true)
            expect(topology.nonManifoldEdges.size).toBe(0)
        })
    })

    context("non-manifold edge (>2 incident faces)", () => {
        // Three triangles fanning out from the SAME shared edge (0,0,0)-(1,0,0),
        // each with a distinct free corner — a "book spine" with three pages.
        const bookSpine = (): THREE.BufferGeometry =>
            soup([
                0,
                0,
                0,
                1,
                0,
                0,
                0,
                1,
                0, // page A (free corner +Y)
                0,
                0,
                0,
                1,
                0,
                0,
                0,
                0,
                1, // page B (free corner +Z)
                0,
                0,
                0,
                1,
                0,
                0,
                0,
                -1,
                0 // page C (free corner -Y)
            ])

        it("marks every slot on the shared edge as -2", () => {
            const topology = weldAndAnalyze(bookSpine())
            expect(topology.faceCount).toBe(3)
            const all = [...topology.faceAdjacency]
            // One slot per face touches the spine → three -2 slots total.
            expect(all.filter((s) => s === -2)).toHaveLength(3)
        })

        it("records the shared edge key in nonManifoldEdges", () => {
            const topology = weldAndAnalyze(bookSpine())
            expect(topology.nonManifoldEdges.size).toBe(1)
            // The spine is vertices 0 and 1 (welded); key = min*V + max.
            const v = topology.vertexCount
            const a = topology.triangles[0]
            const b = topology.triangles[1]
            const expectedKey = Math.min(a, b) * v + Math.max(a, b)
            expect(topology.nonManifoldEdges.has(expectedKey)).toBe(true)
        })

        it("leaves the non-spine edges as boundary, not -2", () => {
            const topology = weldAndAnalyze(bookSpine())
            const all = [...topology.faceAdjacency]
            // 3 faces × 3 slots = 9; one -2 per face, the other two boundary.
            expect(all.filter((s) => s === -1)).toHaveLength(6)
        })
    })

    context("field completeness", () => {
        it("fills every MeshTopology field with consistent lengths", () => {
            const topology = weldAndAnalyze(cube(1))
            expect(topology.positions.length).toBe(topology.vertexCount * 3)
            expect(topology.triangles.length).toBe(topology.faceCount * 3)
            expect(topology.faceNormals.length).toBe(topology.faceCount * 3)
            expect(topology.faceAdjacency.length).toBe(topology.faceCount * 3)
            expect(typeof topology.dihedral).toBe("function")
            expect(topology.positions).toBeInstanceOf(Float32Array)
            expect(topology.triangles).toBeInstanceOf(Uint32Array)
            expect(topology.faceNormals).toBeInstanceOf(Float32Array)
            expect(topology.faceAdjacency).toBeInstanceOf(Int32Array)
        })

        it("produces unit-length face normals", () => {
            const topology = weldAndAnalyze(cube(1))
            for (let f = 0; f < topology.faceCount; f++) {
                const x = topology.faceNormals[3 * f]
                const y = topology.faceNormals[3 * f + 1]
                const z = topology.faceNormals[3 * f + 2]
                expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6)
            }
        })
    })
})
