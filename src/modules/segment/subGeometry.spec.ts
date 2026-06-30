import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { cube } from "./fixtures"
import { triangleIndicesToGeometry } from "./subGeometry"

const context = describe

/** Non-indexed triangle-soup geometry from a flat xyz position list (× 9). */
const soup = (positions: number[]): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3))
    return geometry
}

/** The 9 position floats of triangle `f` ([9f, 9f+9)) from a geometry. */
const triFloats = (geometry: THREE.BufferGeometry, f: number): number[] => {
    const positions = geometry.getAttribute("position").array
    return Array.from(positions.subarray(f * 9, f * 9 + 9))
}

describe("triangleIndicesToGeometry", () => {
    context("with a subset of triangle indices", () => {
        it("emits exactly one triangle (9 position floats) per index", () => {
            const source = cube()
            const indices = [0, 3, 7, 11]
            const out = triangleIndicesToGeometry(source, indices)
            expect(out.getAttribute("position").array.length).toBe(indices.length * 9)
            expect(out.getIndex()).toBeNull()
        })

        it("copies each source triangle's vertices verbatim, in index order", () => {
            // Two distinct triangles so a coordinate mix-up would be visible.
            const source = soup([
                // triangle 0
                0, 0, 0, 1, 0, 0, 0, 1, 0,
                // triangle 1
                2, 2, 2, 3, 2, 2, 2, 3, 2,
                // triangle 2
                5, 5, 5, 6, 5, 5, 5, 6, 5
            ])
            const out = triangleIndicesToGeometry(source, [2, 0])
            // Output triangle 0 == source triangle 2, output triangle 1 == source triangle 0.
            expect(triFloats(out, 0)).toEqual([5, 5, 5, 6, 5, 5, 5, 6, 5])
            expect(triFloats(out, 1)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
        })

        it("matches the source triangles at the requested indices on a cube fixture", () => {
            const source = cube()
            const indices = [2, 5, 9]
            const out = triangleIndicesToGeometry(source, indices)
            indices.forEach((srcIndex, i) => {
                expect(triFloats(out, i)).toEqual(triFloats(source, srcIndex))
            })
        })

        it("accepts an Int32Array of indices", () => {
            const source = cube()
            const out = triangleIndicesToGeometry(source, Int32Array.from([4]))
            expect(out.getAttribute("position").array.length).toBe(9)
            expect(triFloats(out, 0)).toEqual(triFloats(source, 4))
        })

        it("computes vertex normals on the output", () => {
            const out = triangleIndicesToGeometry(cube(), [0, 1])
            expect(out.getAttribute("normal")).toBeDefined()
            expect(out.getAttribute("normal").array.length).toBe(2 * 9)
        })

        it("does not mutate the source geometry", () => {
            const source = cube()
            const before = Array.from(source.getAttribute("position").array)
            triangleIndicesToGeometry(source, [0, 5, 10])
            expect(Array.from(source.getAttribute("position").array)).toEqual(before)
        })
    })

    context("with empty indices", () => {
        it("returns an empty geometry without throwing", () => {
            const source = cube()
            const out = triangleIndicesToGeometry(source, [])
            expect(out.getAttribute("position").array.length).toBe(0)
        })
    })
})
