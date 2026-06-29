import { describe, expect, it } from "bun:test"
import { constrainToAngle, snapToGrid } from "./snap"
import type { Vec2 } from "./types"

const context = describe

/** Every coordinate of a snapped point must be an exact multiple of `grid`. */
const isOnGrid = ([x, y]: Vec2, grid: number): boolean => x % grid === 0 && y % grid === 0

/** A constrained segment is axis-aligned (one zero component) OR has equal legs. */
const isAxisOr45 = (anchor: Vec2, out: Vec2): boolean => {
    const dx = Math.abs(out[0] - anchor[0])
    const dy = Math.abs(out[1] - anchor[1])
    return dx === 0 || dy === 0 || dx === dy
}

describe("snapToGrid", () => {
    context("rounding to the nearest intersection", () => {
        it("rounds both coordinates down toward the nearer multiple", () => {
            expect(snapToGrid([12, 7], 10)).toEqual([10, 10])
        })

        it("rounds up past the half-cell and snaps a sub-half coord to zero", () => {
            expect(snapToGrid([16, 4], 10)).toEqual([20, 0])
        })

        it("leaves an already-on-grid point unchanged", () => {
            expect(snapToGrid([30, -40], 10)).toEqual([30, -40])
        })

        it("snaps negative coordinates symmetrically", () => {
            expect(snapToGrid([-12, -7], 10)).toEqual([-10, -10])
            expect(snapToGrid([-16, -4], 10)).toEqual([-20, 0])
        })

        it("honors a non-10 grid size", () => {
            expect(snapToGrid([7, 8], 5)).toEqual([5, 10])
            expect(snapToGrid([3.4, 9.6], 2)).toEqual([4, 10])
        })

        it("never emits negative zero", () => {
            const [x, y] = snapToGrid([-2, -1], 10)
            expect(Object.is(x, 0)).toBe(true)
            expect(Object.is(y, 0)).toBe(true)
        })
    })

    context("invariant: output lands on the grid", () => {
        const grid = 10
        const cases: Vec2[] = [
            [12, 7],
            [16, 4],
            [-33, 48],
            [101, -99],
            [0.4, -0.4]
        ]
        for (const p of cases) {
            it(`snaps ${JSON.stringify(p)} onto the grid`, () => {
                expect(isOnGrid(snapToGrid(p, grid), grid)).toBe(true)
            })
        }
    })
})

describe("constrainToAngle", () => {
    const grid = 10

    context("the eight specified cardinal/diagonal cases", () => {
        it("locks a shallow east-ish cursor to due East (0°)", () => {
            expect(constrainToAngle([0, 0], [31, 4], grid)).toEqual([30, 0])
        })

        it("locks a 45°-ish cursor to NE with equal legs", () => {
            expect(constrainToAngle([0, 0], [28, 33], grid)).toEqual([30, 30])
        })

        it("locks a steep cursor to due North (90°)", () => {
            expect(constrainToAngle([0, 0], [5, 33], grid)).toEqual([0, 30])
        })

        it("locks a negative-quadrant cursor to SW with equal legs", () => {
            expect(constrainToAngle([0, 0], [-28, -33], grid)).toEqual([-30, -30])
        })

        it("returns the anchor for a zero-delta cursor", () => {
            expect(constrainToAngle([20, 20], [22, 18], grid)).toEqual([20, 20])
        })
    })

    context("all eight directions resolve correctly from a non-origin anchor", () => {
        const anchor: Vec2 = [50, 50]
        // Cursor a touch off each true direction; expected lands 3 steps out.
        const cases: { label: string; cursor: Vec2; expected: Vec2 }[] = [
            { label: "E", cursor: [83, 54], expected: [80, 50] },
            { label: "NE", cursor: [82, 78], expected: [80, 80] },
            { label: "N", cursor: [54, 83], expected: [50, 80] },
            { label: "NW", cursor: [18, 82], expected: [20, 80] },
            { label: "W", cursor: [17, 46], expected: [20, 50] },
            { label: "SW", cursor: [18, 18], expected: [20, 20] },
            { label: "S", cursor: [46, 17], expected: [50, 20] },
            { label: "SE", cursor: [82, 18], expected: [80, 20] }
        ]
        for (const { label, cursor, expected } of cases) {
            it(`resolves ${label}`, () => {
                expect(constrainToAngle(anchor, cursor, grid)).toEqual(expected)
            })
        }
    })

    context("invariants hold for every case", () => {
        const anchor: Vec2 = [10, -20]
        // A spread of cursors across all quadrants, near and far, on and off axis.
        const cursors: Vec2[] = [
            [44, -16],
            [37, 19],
            [13, 51],
            [-22, 48],
            [-35, -17],
            [-19, -54],
            [12, -61],
            [48, -55],
            [11, -19],
            [-3, 4],
            [200, 3],
            [-150, -148]
        ]
        for (const cursor of cursors) {
            it(`output is on-grid, axis-or-45, and the nearest such point for ${JSON.stringify(cursor)}`, () => {
                const out = constrainToAngle(anchor, cursor, grid)
                // grid-divisible
                expect(isOnGrid(out, grid)).toBe(true)
                // axis-aligned or |dx| === |dy|
                expect(isAxisOr45(anchor, out)).toBe(true)
                // nearest such point: no other on-grid, axis-or-45 point from the
                // anchor is closer to the snapped cursor than `out`.
                const snapped = snapToGrid(cursor, grid)
                expect(noCloserConstrainedPoint(anchor, snapped, out, grid)).toBe(true)
            })
        }
    })

    context("respects the configured grid size", () => {
        it("advances in whole steps of a 25 mm grid", () => {
            expect(constrainToAngle([0, 0], [60, 3], 25)).toEqual([50, 0])
            expect(constrainToAngle([0, 0], [44, 51], 25)).toEqual([50, 50])
        })
    })
})

/**
 * Brute-force check that `out` is the nearest on-grid, axis-or-45 point (relative
 * to `anchor`) to `target`: scan every candidate within a generous window and
 * assert none beats `out`. Ties (equal distance) are allowed — the production
 * rounding picks one deterministically.
 */
const noCloserConstrainedPoint = (anchor: Vec2, target: Vec2, out: Vec2, grid: number): boolean => {
    const dist2 = (p: Vec2) => (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2
    const best = dist2(out)
    const span = 30 // ±30 grid cells each way — comfortably past the test cursors
    for (let i = -span; i <= span; i++) {
        for (let j = -span; j <= span; j++) {
            // Candidate must be axis-aligned or diagonal in grid-step terms.
            if (i !== 0 && j !== 0 && Math.abs(i) !== Math.abs(j)) continue
            const candidate: Vec2 = [anchor[0] + i * grid, anchor[1] + j * grid]
            if (dist2(candidate) < best - 1e-9) return false
        }
    }
    return true
}
