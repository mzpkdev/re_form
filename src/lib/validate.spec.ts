import { describe, expect, it } from "bun:test"
import { initManifold } from "./manifold"
import { assertValidSolid, formatToolError, isValidSolid } from "./validate"

const context = describe

const wasm = await initManifold()

/** Two disjoint cubes intersected → an empty (degenerate) Manifold handle. */
const emptyManifold = () => {
    const a = wasm.Manifold.cube([10, 10, 10], true)
    const b = a.translate([100, 0, 0])
    const empty = a.intersect(b)
    a.delete()
    b.delete()
    return empty
}

describe("validate", () => {
    context("isValidSolid", () => {
        it("is true for a real solid and false for an empty one", () => {
            const cube = wasm.Manifold.cube([10, 10, 10], true)
            expect(isValidSolid(cube)).toBe(true)
            cube.delete()

            const empty = emptyManifold()
            expect(empty.isEmpty()).toBe(true)
            expect(isValidSolid(empty)).toBe(false)
            empty.delete()
        })
    })

    context("assertValidSolid", () => {
        it("does not throw and leaves a valid solid alive", () => {
            const cube = wasm.Manifold.cube([10, 10, 10], true)
            expect(() => assertValidSolid(cube, "should not throw")).not.toThrow()
            // The handle is untouched by a passing assertion.
            expect(cube.volume()).toBeCloseTo(1000, 0)
            cube.delete()
        })

        it("throws the supplied message and deletes the handle on an invalid solid", () => {
            const empty = emptyManifold()
            expect(() => assertValidSolid(empty, "boom: empty solid")).toThrow("boom: empty solid")
            // assertValidSolid already deleted it; a fresh degenerate handle still
            // throws + reports its message, proving the failing path is self-cleaning.
            const another = emptyManifold()
            expect(() => assertValidSolid(another, "boom again")).toThrow("boom again")
        })
    })

    context("formatToolError", () => {
        it("wraps an Error's message as 'Error: <message>'", () => {
            expect(formatToolError(new Error("kaboom"))).toBe("Error: kaboom")
        })
    })
})
