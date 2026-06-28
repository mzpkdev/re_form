import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { initManifold } from "./manifold"
import { meshToBufferGeometry } from "./model"
import { exportStl, parseStl, stlBounds, verifyStlDimensions } from "./stl"

const context = describe

// A 20×10×5 mm box, axis-aligned, as a three.js BufferGeometry built through
// the same manifold → mesh path the app exports.
const box20x10x5 = async (): Promise<THREE.BufferGeometry> => {
    const wasm = await initManifold()
    const cube = wasm.Manifold.cube([20, 10, 5], true)
    const geometry = meshToBufferGeometry(cube.getMesh())
    cube.delete()
    return geometry
}

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

        it("stamps a units identifier into the 80-byte header", () => {
            const geometry = new THREE.BoxGeometry(10, 10, 10)
            const buffer = exportStl(geometry)

            const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 80))
            expect(header).toContain("mm")
            expect(header).toContain("hublinator")

            geometry.dispose()
        })

        it("stamps the header without disturbing the triangle count or data", () => {
            // A box is 12 triangles (2 per face × 6 faces).
            const geometry = new THREE.BoxGeometry(10, 10, 10)

            const buffer = exportStl(geometry)
            // Header lives in bytes 0–79; the count at byte 80 and the data
            // region (50 bytes/triangle) after it must survive stamping.
            expect(new DataView(buffer).getUint32(80, true)).toBe(12)
            expect(buffer.byteLength).toBe(84 + 50 * 12)

            geometry.dispose()
        })

        it("throws when exporting an empty BufferGeometry", () => {
            expect(() => exportStl(new THREE.BufferGeometry())).toThrow("cannot export empty geometry")
        })
    })

    context("stlBounds", () => {
        it("reports the exported part's size per axis in millimetres", async () => {
            const geometry = await box20x10x5()
            const buffer = exportStl(geometry)
            geometry.dispose()

            const size = stlBounds(buffer)
            expect(size.x).toBeCloseTo(20, 2)
            expect(size.y).toBeCloseTo(10, 2)
            expect(size.z).toBeCloseTo(5, 2)
        })
    })

    context("verifyStlDimensions", () => {
        it("is true when the re-parsed size matches the intended size", async () => {
            const geometry = await box20x10x5()
            const buffer = exportStl(geometry)
            geometry.dispose()

            expect(verifyStlDimensions(buffer, { x: 20, y: 10, z: 5 })).toBe(true)
        })

        it("is false when the intended size differs from the file", async () => {
            const geometry = await box20x10x5()
            const buffer = exportStl(geometry)
            geometry.dispose()

            expect(verifyStlDimensions(buffer, { x: 21, y: 10, z: 5 })).toBe(false)
        })
    })
})
