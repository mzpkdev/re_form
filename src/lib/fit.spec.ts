import { describe, expect, it } from "bun:test"
import { clearanceFor, FIT_PRESETS, growManifold, holeForPeg, measureGap, pegForHole, shrinkManifold } from "./fit"
import { initManifold } from "./manifold"

const context = describe

const wasm = await initManifold()

const axisSize = (box: { min: [number, number, number]; max: [number, number, number] }, axis: 0 | 1 | 2) =>
    box.max[axis] - box.min[axis]

describe("FIT_PRESETS", () => {
    it("exposes press < snug < slip per-side clearances in mm", () => {
        expect(FIT_PRESETS.press).toBe(0.1)
        expect(FIT_PRESETS.snug).toBe(0.2)
        expect(FIT_PRESETS.slip).toBe(0.4)
        expect(FIT_PRESETS.press).toBeLessThan(FIT_PRESETS.snug)
        expect(FIT_PRESETS.snug).toBeLessThan(FIT_PRESETS.slip)
    })
})

describe("clearanceFor", () => {
    it("returns the nominal preset with no printer offset", () => {
        expect(clearanceFor("press")).toBe(0.1)
        expect(clearanceFor("snug")).toBe(0.2)
        expect(clearanceFor("slip")).toBe(0.4)
    })

    it("adds a positive printer offset", () => {
        expect(clearanceFor("snug", 0.05)).toBeCloseTo(0.25, 10)
    })

    it("adds a negative printer offset", () => {
        expect(clearanceFor("slip", -0.1)).toBeCloseTo(0.3, 10)
    })
})

describe("holeForPeg", () => {
    it("grows the hole by the clearance so the peg can enter", () => {
        expect(holeForPeg(5, "slip")).toBeCloseTo(5.4, 10)
        expect(holeForPeg(5, "press")).toBeCloseTo(5.1, 10)
    })

    it("includes the printer offset", () => {
        expect(holeForPeg(5, "snug", 0.05)).toBeCloseTo(5.25, 10)
    })
})

describe("pegForHole", () => {
    it("shrinks the peg by the clearance so it enters the hole", () => {
        expect(pegForHole(5, "slip")).toBeCloseTo(4.6, 10)
        expect(pegForHole(5, "press")).toBeCloseTo(4.9, 10)
    })

    it("includes the printer offset", () => {
        expect(pegForHole(5, "snug", 0.05)).toBeCloseTo(4.75, 10)
    })

    it("round-trips with holeForPeg", () => {
        expect(pegForHole(holeForPeg(5, "slip"), "slip")).toBeCloseTo(5, 10)
    })

    context("when the clearance would consume the whole radius", () => {
        it("throws for a radius equal to the clearance", () => {
            expect(() => pegForHole(0.4, "slip")).toThrow()
        })

        it("throws for a radius smaller than the clearance", () => {
            expect(() => pegForHole(0.2, "slip")).toThrow()
        })

        it("throws once the printer offset pushes the clearance past the radius", () => {
            expect(() => pegForHole(0.4, "press", 0.5)).toThrow()
        })
    })
})

describe("measureGap", () => {
    context("a peg cylinder inside a tube sized for a slip fit", () => {
        it("achieves a radial clearance of ~0.4mm (the slip preset)", () => {
            const pegRadius = 5
            const innerRadius = holeForPeg(pegRadius, "slip") // 5.4
            const outerRadius = innerRadius + 2 // wall thickness, irrelevant to the gap

            // Coaxial on Z; the peg is shorter and fully overlaps the tube's Z
            // extent, so the closest approach between the two surfaces is purely
            // radial: innerRadius - pegRadius = clearance.
            const peg = wasm.Manifold.cylinder(10, pegRadius, pegRadius, 128, true)
            const outer = wasm.Manifold.cylinder(20, outerRadius, outerRadius, 128, true)
            const bore = wasm.Manifold.cylinder(20, innerRadius, innerRadius, 128, true)
            const tube = outer.subtract(bore)
            try {
                const gap = measureGap(peg, tube)
                // Faceted cylinders sit slightly inside the true radius, so the
                // measured gap is a touch above 0.4; allow a small tolerance.
                expect(gap).toBeCloseTo(0.4, 1)
            } finally {
                peg.delete()
                outer.delete()
                bore.delete()
                tube.delete()
            }
        })
    })
})

describe("growManifold", () => {
    it("grows the bounding box by ~2*delta on every axis", () => {
        const cube = wasm.Manifold.cube([10, 10, 10], true)
        const delta = 1
        const grown = growManifold(wasm, cube, delta)
        try {
            const before = cube.boundingBox()
            const after = grown.boundingBox()
            for (const axis of [0, 1, 2] as const) {
                expect(axisSize(after, axis) - axisSize(before, axis)).toBeCloseTo(2 * delta, 1)
            }
        } finally {
            cube.delete()
            grown.delete()
        }
    })

    it("returns a new, independent handle for delta 0", () => {
        const cube = wasm.Manifold.cube([10, 10, 10], true)
        const copy = growManifold(wasm, cube, 0)
        try {
            expect(copy.volume()).toBeCloseTo(cube.volume(), 5)
            // Deleting the original must not invalidate the copy.
            cube.delete()
            expect(copy.volume()).toBeGreaterThan(0)
        } finally {
            copy.delete()
        }
    })
})

describe("shrinkManifold", () => {
    it("shrinks the bounding box by ~2*delta on every axis", () => {
        const cube = wasm.Manifold.cube([10, 10, 10], true)
        const delta = 1
        const shrunk = shrinkManifold(wasm, cube, delta)
        try {
            const before = cube.boundingBox()
            const after = shrunk.boundingBox()
            for (const axis of [0, 1, 2] as const) {
                expect(axisSize(before, axis) - axisSize(after, axis)).toBeCloseTo(2 * delta, 1)
            }
        } finally {
            cube.delete()
            shrunk.delete()
        }
    })
})
