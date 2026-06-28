import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { parseStl } from "./stl"

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
})
