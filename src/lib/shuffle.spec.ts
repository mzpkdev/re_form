import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import { geometryToBinaryStl, shuffleGeometry, shuffleStl } from "./shuffle"
import { parseStl } from "./stl"

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

describe("shuffle", () => {
    context("shuffleGeometry reorder", () => {
        it("preserves the triangle multiset while changing position order", () => {
            const original = fixture()
            const shuffled = shuffleGeometry(original, { reorder: true, seed: SEED })

            expect(sortedTriangles(shuffled)).toEqual(sortedTriangles(original))

            const before = Array.from(positionArray(original))
            const after = Array.from(positionArray(shuffled))
            expect(after).not.toEqual(before)
        })
    })

    context("shuffleGeometry subdivide", () => {
        it("quadruples triangle count per pass and keeps the bounding box", () => {
            const original = fixture()
            const base = triangleCount(original)

            const once = shuffleGeometry(original, { reorder: false, subdivide: 1, seed: SEED })
            const twice = shuffleGeometry(original, { reorder: false, subdivide: 2, seed: SEED })

            expect(triangleCount(once)).toBe(base * 4)
            expect(triangleCount(twice)).toBe(base * 16)

            const boxOriginal = boundingBox(original)
            for (const box of [boundingBox(once), boundingBox(twice)]) {
                expect(box.min.distanceTo(boxOriginal.min)).toBeLessThanOrEqual(1e-4)
                expect(box.max.distanceTo(boxOriginal.max)).toBeLessThanOrEqual(1e-4)
            }
        })
    })

    context("shuffleGeometry jitter", () => {
        it("moves vertices by at most the amplitude and stays watertight", () => {
            const amplitude = 0.05
            const original = fixture()
            const jittered = shuffleGeometry(original, { reorder: false, jitter: amplitude, seed: SEED })

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

    context("shuffleStl", () => {
        it("round-trips back to the expected triangle count", () => {
            const input = new TextEncoder().encode(TETRA_STL).buffer
            const expected = triangleCount(fixture()) * 4

            const output = shuffleStl(input, { reorder: true, subdivide: 1, seed: SEED })
            const reparsed = parseStl(output)

            expect(triangleCount(reparsed)).toBe(expected)
        })

        it("produces bytes different from a straight re-serialize", () => {
            const input = new TextEncoder().encode(TETRA_STL).buffer
            const remixed = new Uint8Array(shuffleStl(input, { reorder: true, seed: SEED }))
            const plain = new Uint8Array(geometryToBinaryStl(parseStl(input)))

            expect(remixed).not.toEqual(plain)
        })
    })
})
