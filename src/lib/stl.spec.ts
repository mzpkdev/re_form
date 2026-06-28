import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { exportStl, parseStl } from "./stl"

const context = describe

const TRIANGLE_STL = `solid tri
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid tri
`

describe("stl", () => {
    context("parseStl", () => {
        it("parses a single-triangle ASCII STL into a BufferGeometry", () => {
            const data = new TextEncoder().encode(TRIANGLE_STL).buffer
            const geometry = parseStl(data)
            expect(geometry).toBeInstanceOf(THREE.BufferGeometry)
            const position = geometry.getAttribute("position")
            expect(position.itemSize).toBe(3)
            expect(position.count).toBe(3)
        })

        it("produces a finite, non-empty bounding box", () => {
            const data = new TextEncoder().encode(TRIANGLE_STL).buffer
            const geometry = parseStl(data)
            geometry.computeBoundingBox()
            const box = geometry.boundingBox
            expect(box).not.toBeNull()
            const size = box?.getSize(new THREE.Vector3())
            expect(Number.isFinite(size?.x)).toBe(true)
            expect(Number.isFinite(size?.y)).toBe(true)
            expect(Number.isFinite(size?.z)).toBe(true)
            expect(size?.length()).toBeGreaterThan(0)
        })
    })

    context("exportStl", () => {
        it("writes a binary STL whose triangle-count header matches the geometry", () => {
            // A box is 12 triangles (2 per face × 6 faces).
            const geometry = new THREE.BoxGeometry(10, 10, 10)
            const expectedTriangles = geometry.getIndex()
                ? (geometry.getIndex() as THREE.BufferAttribute).count / 3
                : geometry.getAttribute("position").count / 3

            const buffer = exportStl(geometry)
            expect(buffer).toBeInstanceOf(ArrayBuffer)
            // 80-byte header + 4-byte count + 50 bytes per triangle.
            expect(buffer.byteLength).toBeGreaterThanOrEqual(84)
            const triangleCount = new DataView(buffer).getUint32(80, true)
            expect(triangleCount).toBe(expectedTriangles)
            expect(buffer.byteLength).toBe(84 + 50 * triangleCount)

            geometry.dispose()
        })

        it("round-trips through parseStl back to the same triangle count", () => {
            const geometry = new THREE.BoxGeometry(10, 10, 10)
            const expectedTriangles = new DataView(exportStl(geometry)).getUint32(80, true)

            const reparsed = parseStl(exportStl(geometry))
            // STLLoader yields a non-indexed soup: 3 vertices per triangle.
            expect(reparsed.getAttribute("position").count / 3).toBe(expectedTriangles)

            geometry.dispose()
            reparsed.dispose()
        })
    })
})
