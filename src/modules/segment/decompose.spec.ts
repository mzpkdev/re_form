import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { initManifold } from "../../lib/manifold"
import { geometryToManifold } from "../../lib/model"
import { decomposeBodies } from "./decompose"
import { cube, nonManifoldShell, twoDisjointCubes } from "./fixtures"

const context = describe

/**
 * Bake one body's face-index set back into a NON-INDEXED triangle soup, reading
 * the triangles straight out of the SOURCE geometry's position attribute. This
 * exercises the core invariant: `decomposeBodies` indices are in the original
 * triangle order, so face `f` is positions `[9f, 9f+9)` of the source soup.
 * The result is a fresh geometry the caller disposes.
 */
const bakeFaces = (source: THREE.BufferGeometry, faces: Int32Array): THREE.BufferGeometry => {
    const src = source.getAttribute("position").array
    const out = new Float32Array(faces.length * 9)
    for (let i = 0; i < faces.length; i++) {
        out.set(src.subarray(faces[i] * 9, faces[i] * 9 + 9), i * 9)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(out, 3))
    return geometry
}

/** Total triangle count of a non-indexed soup (3 verts × 3 coords per tri). */
const faceCountOf = (geometry: THREE.BufferGeometry): number => geometry.getAttribute("position").count / 3

describe("decomposeBodies", () => {
    context("twoDisjointCubes (manifold, two components)", () => {
        it("splits into exactly two bodies", async () => {
            const wasm = await initManifold()
            const geometry = twoDisjointCubes(1, 1)

            const bodies = decomposeBodies(wasm, geometry)

            expect(bodies).toHaveLength(2)
        })

        it("returns disjoint face sets whose union is [0, F)", async () => {
            const wasm = await initManifold()
            const geometry = twoDisjointCubes(1, 1)
            const F = faceCountOf(geometry)

            const bodies = decomposeBodies(wasm, geometry)

            const union = new Set<number>()
            for (const body of bodies) {
                for (const face of body) {
                    expect(union.has(face)).toBe(false) // disjoint
                    union.add(face)
                }
            }
            expect(union.size).toBe(F)
            // Union is exactly the contiguous range [0, F).
            for (let f = 0; f < F; f++) {
                expect(union.has(f)).toBe(true)
            }
        })

        it("returns each body's faces sorted ascending", async () => {
            const wasm = await initManifold()
            const geometry = twoDisjointCubes(1, 1)

            const bodies = decomposeBodies(wasm, geometry)

            for (const body of bodies) {
                for (let i = 1; i < body.length; i++) {
                    expect(body[i]).toBeGreaterThan(body[i - 1])
                }
            }
        })

        it("bakes each body back to a unit-cube-volume solid", async () => {
            const wasm = await initManifold()
            const geometry = twoDisjointCubes(1, 1)

            const bodies = decomposeBodies(wasm, geometry)

            for (const body of bodies) {
                const baked = bakeFaces(geometry, body)
                const manifold = geometryToManifold(wasm, baked)
                // Each cube has edge 1 → volume 1.
                expect(manifold.volume()).toBeCloseTo(1, 5)
                manifold.delete()
                baked.dispose()
            }
        })
    })

    context("cube (manifold, single body)", () => {
        it("returns one body covering all faces", async () => {
            const wasm = await initManifold()
            const geometry = cube(1)
            const F = faceCountOf(geometry)

            const bodies = decomposeBodies(wasm, geometry)

            expect(bodies).toHaveLength(1)
            expect(bodies[0].length).toBe(F)
        })

        it("bakes back to the source cube volume", async () => {
            const wasm = await initManifold()
            const geometry = cube(2)

            const bodies = decomposeBodies(wasm, geometry)
            const baked = bakeFaces(geometry, bodies[0])
            const manifold = geometryToManifold(wasm, baked)

            // Edge 2 → volume 8.
            expect(manifold.volume()).toBeCloseTo(8, 5)

            manifold.delete()
            baked.dispose()
        })
    })

    context("nonManifoldShell (geometryToManifold throws → union-find alone)", () => {
        it("returns components without crashing", async () => {
            const wasm = await initManifold()
            const geometry = nonManifoldShell(1)
            const F = faceCountOf(geometry)

            // Guard: this fixture really is the non-manifold path.
            expect(() => geometryToManifold(wasm, geometry)).toThrow("mesh is not manifold")

            const bodies = decomposeBodies(wasm, geometry)

            // An open shell is still one connected component (its faces share
            // welded edges along every seam except the missing-face boundary).
            expect(bodies).toHaveLength(1)
            expect(bodies[0].length).toBe(F)
        })

        it("still satisfies completeness and disjointness", async () => {
            const wasm = await initManifold()
            const geometry = nonManifoldShell(1)
            const F = faceCountOf(geometry)

            const bodies = decomposeBodies(wasm, geometry)

            const union = new Set<number>()
            let total = 0
            for (const body of bodies) {
                total += body.length
                for (const face of body) {
                    union.add(face)
                }
            }
            expect(total).toBe(F) // no duplicates across bodies
            expect(union.size).toBe(F) // union is the full face range
        })
    })
})
