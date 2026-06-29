import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { initManifold } from "../../lib/manifold"
import { geometryToManifold } from "../../lib/model"
import { parseStl } from "../../lib/stl"
import { geometryToBinaryStl, remixGeometry, remixStl } from "./remix"

const context = describe

// A closed tetrahedron: 4 triangles that share corners, so welding and
// watertightness are actually exercised (a lone triangle would not crack).
const TETRA_STL = `solid tetra
facet normal 0 0 0
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
facet normal 0 0 0
outer loop
vertex 0 0 0
vertex 0 1 0
vertex 0 0 1
endloop
endfacet
facet normal 0 0 0
outer loop
vertex 0 0 0
vertex 0 0 1
vertex 1 0 0
endloop
endfacet
facet normal 0 0 0
outer loop
vertex 1 0 0
vertex 0 0 1
vertex 0 1 0
endloop
endfacet
endsolid tetra
`

const SEED = 1337

const fixture = () => parseStl(new TextEncoder().encode(TETRA_STL).buffer)

const positionArray = (geometry: THREE.BufferGeometry): Float32Array =>
    geometry.getAttribute("position").array as Float32Array

const triangleCount = (geometry: THREE.BufferGeometry): number => geometry.getAttribute("position").count / 3

/** Each triangle as a sorted tuple of its three vertices — winding/order agnostic. */
const sortedTriangles = (geometry: THREE.BufferGeometry): string[] => {
    const array = positionArray(geometry)
    const out: string[] = []
    for (let i = 0; i < array.length; i += 9) {
        const verts = [
            `${array[i]},${array[i + 1]},${array[i + 2]}`,
            `${array[i + 3]},${array[i + 4]},${array[i + 5]}`,
            `${array[i + 6]},${array[i + 7]},${array[i + 8]}`
        ]
        verts.sort()
        out.push(verts.join("|"))
    }
    out.sort()
    return out
}

const boundingBox = (geometry: THREE.BufferGeometry): THREE.Box3 => {
    geometry.computeBoundingBox()
    return geometry.boundingBox as THREE.Box3
}

/** Count of unique vertices after welding on rounded position (watertight proxy). */
const weldedVertexCount = (geometry: THREE.BufferGeometry): number => {
    const array = positionArray(geometry)
    const keys = new Set<string>()
    for (let i = 0; i < array.length; i += 3) {
        keys.add(`${Math.round(array[i] * 1e4)},${Math.round(array[i + 1] * 1e4)},${Math.round(array[i + 2] * 1e4)}`)
    }
    return keys.size
}

describe("remix", () => {
    context("remixGeometry reorder", () => {
        it("preserves the triangle multiset while changing position order", () => {
            const original = fixture()
            const remixed = remixGeometry(original, { reorder: true, seed: SEED })

            expect(sortedTriangles(remixed)).toEqual(sortedTriangles(original))

            const before = Array.from(positionArray(original))
            const after = Array.from(positionArray(remixed))
            expect(after).not.toEqual(before)
        })
    })

    context("remixGeometry subdivide", () => {
        it("quadruples triangle count per pass and keeps the bounding box", () => {
            const original = fixture()
            const base = triangleCount(original)

            const once = remixGeometry(original, { reorder: false, subdivide: 1, seed: SEED })
            const twice = remixGeometry(original, { reorder: false, subdivide: 2, seed: SEED })

            expect(triangleCount(once)).toBe(base * 4)
            expect(triangleCount(twice)).toBe(base * 16)

            const boxOriginal = boundingBox(original)
            for (const box of [boundingBox(once), boundingBox(twice)]) {
                expect(box.min.distanceTo(boxOriginal.min)).toBeLessThanOrEqual(1e-4)
                expect(box.max.distanceTo(boxOriginal.max)).toBeLessThanOrEqual(1e-4)
            }
        })
    })

    context("remixGeometry jitter", () => {
        it("moves vertices by at most the amplitude and stays watertight", () => {
            const amplitude = 0.05
            const original = fixture()
            const jittered = remixGeometry(original, { reorder: false, jitter: amplitude, seed: SEED })

            const boxOriginal = boundingBox(original)
            const boxJittered = boundingBox(jittered)
            for (const axis of ["x", "y", "z"] as const) {
                expect(boxJittered.min[axis]).toBeGreaterThanOrEqual(boxOriginal.min[axis] - amplitude - 1e-6)
                expect(boxJittered.max[axis]).toBeLessThanOrEqual(boxOriginal.max[axis] + amplitude + 1e-6)
            }

            // Every shared corner moved as one, so the unique-vertex count holds.
            expect(weldedVertexCount(jittered)).toBe(weldedVertexCount(original))
        })
    })

    context("remixStl", () => {
        it("round-trips back to the expected triangle count", () => {
            const input = new TextEncoder().encode(TETRA_STL).buffer
            const expected = triangleCount(fixture()) * 4

            const output = remixStl(input, { reorder: true, subdivide: 1, seed: SEED })
            const reparsed = parseStl(output)

            expect(triangleCount(reparsed)).toBe(expected)
        })

        it("produces bytes different from a straight re-serialize", () => {
            const input = new TextEncoder().encode(TETRA_STL).buffer
            const remixed = new Uint8Array(remixStl(input, { reorder: true, seed: SEED }))
            const plain = new Uint8Array(geometryToBinaryStl(parseStl(input)))

            expect(remixed).not.toEqual(plain)
        })
    })

    context("geometryToManifold round-trip", () => {
        it("converts a remixed solid back into a valid manifold", async () => {
            const wasm = await initManifold()
            // A consistently-wound closed solid, like the app's live manifold; the
            // tetra fixture above is a soup used only for geometry-shape checks.
            const soup = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
            const remixed = remixGeometry(soup, { reorder: false, subdivide: 1, jitter: 0.01, seed: SEED })
            soup.dispose()

            const manifold = geometryToManifold(wasm, remixed)

            expect(manifold.isEmpty()).toBe(false)
            // Volume ≈ the original 8 mm³ — jitter is sub-tolerance, so the remix is a look-alike.
            expect(manifold.volume()).toBeCloseTo(8, 0)

            manifold.delete()
            remixed.dispose()
        })
    })
})
