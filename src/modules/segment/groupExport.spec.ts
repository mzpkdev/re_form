import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import { parseStl } from "../../lib/stl"
import { cube } from "./fixtures"
import { exportGroups, groupToGeometry } from "./groupExport"
import type { ShapeGroup } from "./types"

const context = describe

/** Triangle count of a non-indexed geometry (3 vertices, 9 position floats each). */
const triCount = (geometry: THREE.BufferGeometry): number => geometry.getAttribute("position").array.length / 9

/** Axis-aligned bounding box of a geometry as `[minXYZ, maxXYZ]`, NaN-free or null. */
const bounds = (geometry: THREE.BufferGeometry): { min: THREE.Vector3; max: THREE.Vector3 } => {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (!box) {
        throw new Error("geometry has no bounding box")
    }
    return { min: box.min, max: box.max }
}

/**
 * Minimal `ShapeGroup` carrying just the membership under test. The fields the
 * export path reads are `triangleIndices`; the rest are filled with inert,
 * type-correct placeholders so the fixture is a real `ShapeGroup`.
 */
const groupOf = (id: string, triangleIndices: number[]): ShapeGroup => ({
    id,
    kind: "unknown",
    label: id,
    color: [1, 1, 1],
    triangleIndices: Int32Array.from(triangleIndices),
    params: { kind: "unknown" },
    bbox: { min: [0, 0, 0], max: [0, 0, 0] }
})

describe("exportGroups", () => {
    context("a single group covering a subset of the source triangles", () => {
        it("re-parses to the group's exact triangle count", () => {
            const source = cube() // 12 triangles, 6 faces
            const indices = [0, 1, 4, 7, 11] // arbitrary 5-triangle subset
            const group = groupOf("g", indices)

            const reparsed = parseStl(exportGroups(source, [group]))

            expect(triCount(reparsed)).toBe(indices.length)
            reparsed.dispose()
        })

        it("round-trips the group's bounding box through the STL", () => {
            const source = cube(2) // edge length 2 → box [-1,1]^3
            // Two adjacent faces (+Z then -Z via fixture order) so the subset
            // still spans the full cube extent and the bbox is non-degenerate.
            const indices = [0, 1, 2, 3]
            const group = groupOf("g", indices)

            const expected = bounds(groupToGeometry(source, group))
            const reparsed = parseStl(exportGroups(source, [group]))
            const actual = bounds(reparsed)

            expect(actual.min.x).toBeCloseTo(expected.min.x, 5)
            expect(actual.min.y).toBeCloseTo(expected.min.y, 5)
            expect(actual.min.z).toBeCloseTo(expected.min.z, 5)
            expect(actual.max.x).toBeCloseTo(expected.max.x, 5)
            expect(actual.max.y).toBeCloseTo(expected.max.y, 5)
            expect(actual.max.z).toBeCloseTo(expected.max.z, 5)
            reparsed.dispose()
        })

        it("re-parses the whole cube to all 12 triangles with the full bounding box", () => {
            const source = cube(2)
            const all = Array.from({ length: 12 }, (_, i) => i)
            const group = groupOf("all", all)

            const reparsed = parseStl(exportGroups(source, [group]))
            const box = bounds(reparsed)

            expect(triCount(reparsed)).toBe(12)
            expect(box.min.x).toBeCloseTo(-1, 5)
            expect(box.max.x).toBeCloseTo(1, 5)
            expect(box.max.y).toBeCloseTo(1, 5)
            expect(box.max.z).toBeCloseTo(1, 5)
            reparsed.dispose()
        })
    })

    context("two disjoint groups", () => {
        it("re-parses to the combined triangle count (sum of the two)", () => {
            const source = cube()
            const a = groupOf("a", [0, 1, 2]) // 3 triangles
            const b = groupOf("b", [6, 7, 8, 9]) // 4 disjoint triangles

            const reparsed = parseStl(exportGroups(source, [a, b]))

            expect(triCount(reparsed)).toBe(a.triangleIndices.length + b.triangleIndices.length)
            expect(triCount(reparsed)).toBe(7)
            reparsed.dispose()
        })
    })

    context("an empty membership", () => {
        it("throws rather than writing an empty STL", () => {
            const source = cube()
            const empty = groupOf("empty", [])
            expect(() => exportGroups(source, [empty])).toThrow()
            expect(() => exportGroups(source, [])).toThrow()
        })
    })
})

describe("groupToGeometry", () => {
    context("a group of triangle indices", () => {
        it("extracts one triangle (9 position floats) per index, non-indexed", () => {
            const source = cube()
            const group = groupOf("g", [2, 5, 9])

            const out = groupToGeometry(source, group)

            expect(out.getAttribute("position").array.length).toBe(3 * 9)
            expect(out.getIndex()).toBeNull()
            out.dispose()
        })

        it("does not mutate the source geometry", () => {
            const source = cube()
            const before = Array.from(source.getAttribute("position").array)
            groupToGeometry(source, groupOf("g", [0, 4, 8])).dispose()
            expect(Array.from(source.getAttribute("position").array)).toEqual(before)
        })
    })
})
