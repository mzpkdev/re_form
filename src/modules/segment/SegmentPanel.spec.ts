import { describe, expect, it } from "bun:test"
import { recolorGroup, renameGroup } from "./SegmentPanel"
import type { ShapeGroup } from "./types"

const context = describe

const makeGroup = (id: string): ShapeGroup => ({
    id,
    kind: "body",
    label: id,
    color: [0, 0, 0],
    triangleIndices: new Int32Array([0]),
    params: { kind: "body" },
    bbox: { min: [0, 0, 0], max: [1, 1, 1] }
})

describe("recolorGroup / renameGroup", () => {
    context("when editing a group", () => {
        it("returns a fresh object for the edited group (identity changes)", () => {
            const groups = [makeGroup("a"), makeGroup("b")]
            const recolored = recolorGroup(groups, "a", [1, 0, 0])
            expect(recolored[0]).not.toBe(groups[0]) // new object → store's delete-on-replace sees it as new
            expect(recolored[0]?.color).toEqual([1, 0, 0])

            const renamed = renameGroup(groups, "b", "Top face")
            expect(renamed[1]).not.toBe(groups[1])
            expect(renamed[1]?.label).toBe("Top face")
        })

        it("preserves identity of untouched groups", () => {
            const groups = [makeGroup("a"), makeGroup("b")]
            const recolored = recolorGroup(groups, "a", [1, 0, 0])
            expect(recolored[1]).toBe(groups[1]) // unedited group carried over by reference
        })

        it("is a no-op (same values) when the id is absent", () => {
            const groups = [makeGroup("a")]
            const result = renameGroup(groups, "missing", "x")
            expect(result[0]?.label).toBe("a")
        })
    })
})
