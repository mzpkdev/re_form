import { describe, expect, it } from "bun:test"
import { hitTest } from "./hitTest"
import type { Entity, Line, Polyline, Vec2 } from "./types"

const context = describe

// A horizontal line in the z=0 plane from (0,0) to (10,0). On the `front` view
// ([x,y]) it projects straight to the segment (0,0)–(10,0).
const hline = (id: string): Line => ({ id, type: "line", a: [0, 0, 0], b: [10, 0, 0] })

// A unit square as a closed polyline in z=0: (0,0)→(10,0)→(10,10)→(0,10) and an
// implied closing edge (0,10)→(0,0). On `front` it is exactly that box.
const square = (id: string): Polyline => ({
    id,
    type: "polyline",
    points: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0]
    ],
    closed: true
})

describe("hitTest", () => {
    context("an empty entity list", () => {
        it("returns null", () => {
            expect(hitTest([], [0, 0], "front", 8)).toBeNull()
        })
    })

    context("a point exactly on a segment", () => {
        it("hits the line", () => {
            // Midpoint of the (0,0)–(10,0) segment.
            expect(hitTest([hline("a")], [5, 0], "front", 1)).toBe("a")
        })

        it("hits at a segment endpoint", () => {
            expect(hitTest([hline("a")], [0, 0], "front", 1)).toBe("a")
            expect(hitTest([hline("a")], [10, 0], "front", 1)).toBe("a")
        })
    })

    context("tolerance boundaries", () => {
        const entities = [hline("a")]
        const tolerance = 2

        it("hits a point within tolerance of the segment", () => {
            // 1 mm above the line; well inside the 2 mm tolerance.
            expect(hitTest(entities, [5, 1], "front", tolerance)).toBe("a")
        })

        it("hits a point exactly tolerance away (inclusive)", () => {
            expect(hitTest(entities, [5, tolerance], "front", tolerance)).toBe("a")
        })

        it("misses a point just beyond tolerance", () => {
            expect(hitTest(entities, [5, tolerance + 0.001], "front", tolerance)).toBeNull()
        })

        it("misses a point past a segment END (clamped distance, not infinite line)", () => {
            // (20,0) is collinear with the segment but 10 mm past its (10,0) end,
            // so the clamped distance is 10 — far beyond a 2 mm tolerance. A naive
            // point-to-INFINITE-line test would wrongly report distance 0.
            expect(hitTest(entities, [20, 0], "front", tolerance)).toBeNull()
        })
    })

    context("two overlapping entities", () => {
        it("returns the nearer one", () => {
            // `near` runs through y=0; `far` through y=5. A click at (5,0.5) is
            // 0.5 from `near` and 4.5 from `far`, so `near` wins despite being
            // first in the list.
            const near: Line = { id: "near", type: "line", a: [0, 0, 0], b: [10, 0, 0] }
            const far: Line = { id: "far", type: "line", a: [0, 5, 0], b: [10, 5, 0] }
            expect(hitTest([near, far], [5, 0.5], "front", 8)).toBe("near")
            // Order-independent: the nearer entity wins regardless of list order.
            expect(hitTest([far, near], [5, 0.5], "front", 8)).toBe("near")
        })
    })

    context("two entities at the exact same distance", () => {
        it("breaks the tie toward the last (topmost) entity", () => {
            // Two identical overlapping lines: equal distance, so the later one in
            // document/paint order wins (it renders on top).
            const first: Line = { id: "first", type: "line", a: [0, 0, 0], b: [10, 0, 0] }
            const second: Line = { id: "second", type: "line", a: [0, 0, 0], b: [10, 0, 0] }
            expect(hitTest([first, second], [5, 0], "front", 8)).toBe("second")
            expect(hitTest([second, first], [5, 0], "front", 8)).toBe("first")
        })
    })

    context("a closed polygon", () => {
        it("hits a click near the closing edge (last vertex → first)", () => {
            // The closing edge runs (0,10)→(0,0) along x=0. A click at (0.5,5) is
            // 0.5 from it; that edge exists only because the polyline is closed.
            expect(hitTest([square("s")], [0.5, 5], "front", 1)).toBe("s")
        })

        it("does NOT hit the interior far from every edge", () => {
            // Dead center of the 10×10 box: 5 mm from the nearest edge, outside a
            // 1 mm tolerance — a fill is not a hit, only the outline is.
            expect(hitTest([square("s")], [5, 5], "front", 1)).toBeNull()
        })
    })

    context("an OPEN polyline", () => {
        it("does not hit along the (absent) closing edge", () => {
            // Same vertices as the square but open: the (0,10)→(0,0) edge is gone,
            // so a click that would have hit the closing edge now misses.
            const open: Polyline = { ...square("o"), closed: false }
            expect(hitTest([open], [0.5, 5], "front", 1)).toBeNull()
            // ...while a real edge of the open shape still hits.
            expect(hitTest([open], [5, 0], "front", 1)).toBe("o")
        })
    })

    context("plane awareness", () => {
        it("hits cross-plane geometry where it renders edge-on", () => {
            // The z=0 line viewed from `top` projects [x,-z] → every sample to
            // v=0: the segment (0,0)–(10,0) again, so a click at (5,0) still hits.
            expect(hitTest([hline("a")], [5, 0], "top", 1)).toBe("a")
        })

        it("uses the active plane's projection, not a fixed one", () => {
            // A line along the world Z axis, (0,0,0)–(0,0,10). On `front` ([x,y])
            // both ends collapse to (0,0): a point-sized mark, so a click at its
            // MIDPOINT in `top` space, (0,-5), misses on `front` (the geometry is
            // nowhere near there). On `top` ([x,-z]) it is the full segment
            // (0,0)–(0,-10), so (0,-5) lands right on it.
            const zline: Line = { id: "z", type: "line", a: [0, 0, 0], b: [0, 0, 10] }
            expect(hitTest([zline], [0, -5], "front", 1)).toBeNull()
            expect(hitTest([zline], [0, -5], "top", 1)).toBe("z")
        })
    })

    context("a degenerate zero-length entity", () => {
        it("hits only AT its point (point-to-point distance), not at range", () => {
            const dot: Line = { id: "d", type: "line", a: [0, 0, 0], b: [0, 0, 0] }
            const entities: Entity[] = [dot]
            // Far away: no spurious hit despite the degenerate segment.
            const far: Vec2 = [50, 50]
            expect(hitTest(entities, far, "front", 1)).toBeNull()
            // Right on it: a collapsed mark is still clickable at its location.
            expect(hitTest(entities, [0, 0], "front", 1)).toBe("d")
        })
    })
})
