import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import { parseStl } from "../../lib/stl"
import { cube } from "./fixtures"
import { exportGroups } from "./groupExport"
import { groupByParent, toggleSelection } from "./groupHierarchy"
import type { ShapeGroup } from "./types"

const context = describe

/** Triangle count of a non-indexed geometry (3 vertices, 9 position floats each). */
const triCount = (geometry: THREE.BufferGeometry): number => geometry.getAttribute("position").array.length / 9

/**
 * Minimal `ShapeGroup` carrying just the fields these helpers read
 * (`id`, `parentId`, `triangleIndices`); the rest are inert, type-correct
 * placeholders so the fixture is a real `ShapeGroup`.
 */
const groupOf = (id: string, parentId: string | null, triangleIndices: number[] = [0]): ShapeGroup => ({
    id,
    kind: "patch",
    label: id,
    color: [1, 1, 1],
    triangleIndices: Int32Array.from(triangleIndices),
    params: { kind: "patch" },
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    parentId
})

describe("groupByParent", () => {
    context("a flat list with no parents (M1 regions-off bodies)", () => {
        it("renders every group at the top level in order", () => {
            const groups = [groupOf("a", null), groupOf("b", null), groupOf("c", null)]
            const entries = groupByParent(groups)

            expect(entries.map((e) => e.kind)).toEqual(["leaf", "leaf", "leaf"])
            expect(entries.map((e) => (e.kind === "leaf" ? e.group.id : null))).toEqual(["a", "b", "c"])
        })
    })

    context("leaves parented to bodies", () => {
        it("synthesizes a body header per distinct parentId, labelled by first appearance", () => {
            const groups = [groupOf("p1", "body-x"), groupOf("p2", "body-x"), groupOf("p3", "body-y")]
            const entries = groupByParent(groups)

            expect(entries).toHaveLength(2)
            const [first, second] = entries
            expect(first?.kind).toBe("body")
            expect(second?.kind).toBe("body")
            if (first?.kind === "body" && second?.kind === "body") {
                expect(first.label).toBe("Body 1")
                expect(first.id).toBe("body-x")
                expect(first.childIds).toEqual(["p1", "p2"])
                expect(second.label).toBe("Body 2")
                expect(second.id).toBe("body-y")
                expect(second.childIds).toEqual(["p3"])
            }
        })

        it("places a body header at the position of its first child and keeps null-parent leaves at top level", () => {
            const groups = [groupOf("loose", null), groupOf("p1", "body-x"), groupOf("p2", "body-x")]
            const entries = groupByParent(groups)

            expect(entries.map((e) => e.kind)).toEqual(["leaf", "body"])
            expect(entries[0]?.kind === "leaf" && entries[0].group.id).toBe("loose")
            expect(entries[1]?.kind === "body" && entries[1].label).toBe("Body 1")
        })

        it("groups interleaved children under one header (first-appearance order preserved)", () => {
            const groups = [
                groupOf("p1", "body-x"),
                groupOf("q1", "body-y"),
                groupOf("p2", "body-x") // back to body-x, already opened
            ]
            const entries = groupByParent(groups)

            // Only two headers (no duplicate body-x); body-x opened first.
            expect(entries.map((e) => (e.kind === "body" ? e.id : null))).toEqual(["body-x", "body-y"])
            const bodyX = entries[0]
            expect(bodyX?.kind === "body" && bodyX.childIds).toEqual(["p1", "p2"])
        })
    })
})

describe("toggleSelection", () => {
    context("an id not in the selection", () => {
        it("adds it to the end without mutating the input", () => {
            const current = ["a", "b"]
            const next = toggleSelection(current, "c")
            expect(next).toEqual(["a", "b", "c"])
            expect(current).toEqual(["a", "b"]) // unmutated
            expect(next).not.toBe(current) // fresh array
        })
    })

    context("an id already in the selection", () => {
        it("removes it, leaving the rest in order", () => {
            expect(toggleSelection(["a", "b", "c"], "b")).toEqual(["a", "c"])
        })

        it("clears a single-element selection back to empty", () => {
            expect(toggleSelection(["a"], "a")).toEqual([])
        })
    })
})

describe("multi-selection export", () => {
    context("exporting several selected groups as one STL", () => {
        it("re-parses to the sum of the selected groups' triangle counts", () => {
            const source = cube() // 12 triangles
            const selected = [
                groupOf("a", null, [0, 1, 2]), // 3
                groupOf("b", "body-x", [5, 6]), // 2 (disjoint)
                groupOf("c", "body-x", [9, 10, 11]) // 3 (disjoint)
            ]
            const expected = selected.reduce((sum, g) => sum + g.triangleIndices.length, 0)

            const reparsed = parseStl(exportGroups(source, selected))

            expect(triCount(reparsed)).toBe(expected)
            expect(triCount(reparsed)).toBe(8)
            reparsed.dispose()
        })
    })
})
