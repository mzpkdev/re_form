import { describe, expect, it } from "bun:test"
import {
    arcSpanDeg,
    type Drawing,
    distance,
    drawingToSvg,
    formatMm,
    type Point,
    profileToPolygons,
    rectBounds,
    resolvePoint,
    shapeDimensions,
    snapAngle,
    snapToGrid
} from "./drawing"

const context = describe

/** Signed area of a loop (mm²); positive ⇒ counter-clockwise in y-up space. */
const signedArea = (loop: Point[]): number => {
    let sum = 0
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]
        const b = loop[(i + 1) % loop.length]
        sum += a.x * b.y - b.x * a.y
    }
    return sum / 2
}

const sheet = (shapes: Drawing["shapes"]): Drawing => ({ width: 210, height: 297, gridMm: 10, shapes })

describe("snapToGrid", () => {
    it("rounds to the nearest grid intersection", () => {
        expect(snapToGrid({ x: 12, y: 7 }, 10)).toEqual({ x: 10, y: 10 })
        expect(snapToGrid({ x: 16, y: 4 }, 10)).toEqual({ x: 20, y: 0 })
    })

    context("non-positive pitch", () => {
        it("leaves the point untouched", () => {
            expect(snapToGrid({ x: 3.3, y: 9.1 }, 0)).toEqual({ x: 3.3, y: 9.1 })
        })
    })
})

describe("snapAngle", () => {
    it("locks a near-horizontal drag to a horizontal line, keeping its length", () => {
        const snapped = snapAngle({ x: 0, y: 0 }, { x: 50, y: 6 }, 45)
        expect(snapped.x).toBeCloseTo(Math.hypot(50, 6), 6)
        expect(snapped.y).toBeCloseTo(0, 6)
    })

    it("snaps a ~50° drag to the 45° diagonal", () => {
        const snapped = snapAngle({ x: 0, y: 0 }, { x: 10, y: 12 }, 45)
        expect(snapped.x).toBeCloseTo(snapped.y, 6)
    })

    context("zero-length drag", () => {
        it("returns the target unchanged", () => {
            expect(snapAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 })
        })
    })
})

describe("resolvePoint", () => {
    it("applies angle snap then lands the result on the grid", () => {
        const p = resolvePoint({ x: 31, y: 4 }, { gridMm: 10, snapGrid: true, snapAngle: true, from: { x: 0, y: 0 } })
        // Angle snap flattens to y≈0, grid snap rounds onto a node.
        expect(p).toEqual({ x: 30, y: 0 })
    })

    context("no reference point", () => {
        it("skips angle snap and only applies grid snap", () => {
            const p = resolvePoint({ x: 14, y: 26 }, { gridMm: 10, snapGrid: true, snapAngle: true, from: null })
            expect(p).toEqual({ x: 10, y: 30 })
        })
    })

    context("all snapping off", () => {
        it("returns the raw point", () => {
            const raw = { x: 13.7, y: 2.2 }
            expect(resolvePoint(raw, { gridMm: 10, snapGrid: false, snapAngle: false })).toEqual(raw)
        })
    })
})

describe("distance / formatMm", () => {
    it("measures the segment length", () => {
        expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    })

    it("trims trailing .0 but keeps one decimal", () => {
        expect(formatMm(30)).toBe("30")
        expect(formatMm(30.5)).toBe("30.5")
        expect(formatMm(30.04)).toBe("30")
    })
})

describe("rectBounds", () => {
    it("normalises any two opposite corners to a top-left origin and positive size", () => {
        expect(rectBounds({ kind: "rect", a: { x: 40, y: 30 }, b: { x: 10, y: 5 } })).toEqual({
            x: 10,
            y: 5,
            w: 30,
            h: 25
        })
    })
})

describe("shapeDimensions", () => {
    it("labels a line with its length", () => {
        expect(shapeDimensions({ kind: "line", a: { x: 0, y: 0 }, b: { x: 60, y: 0 } })).toBe("60")
    })
    it("labels a rectangle width × height", () => {
        expect(shapeDimensions({ kind: "rect", a: { x: 0, y: 0 }, b: { x: 40, y: 25 } })).toBe("40 × 25")
    })
    it("labels a circle by diameter", () => {
        expect(shapeDimensions({ kind: "circle", center: { x: 0, y: 0 }, radius: 15 })).toBe("⌀ 30")
    })
    it("labels an arc by radius", () => {
        expect(shapeDimensions({ kind: "arc", center: { x: 0, y: 0 }, radius: 12, startDeg: 0, endDeg: 90 })).toBe(
            "R 12"
        )
    })
    it("labels a polyline by total run length", () => {
        const dim = shapeDimensions({
            kind: "polyline",
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 }
            ],
            closed: false
        })
        expect(dim).toBe("20")
    })
})

describe("arcSpanDeg", () => {
    it("normalises the swept angle into (0, 360]", () => {
        expect(arcSpanDeg({ kind: "arc", center: { x: 0, y: 0 }, radius: 5, startDeg: 350, endDeg: 20 })).toBe(30)
        expect(arcSpanDeg({ kind: "arc", center: { x: 0, y: 0 }, radius: 5, startDeg: 0, endDeg: 90 })).toBe(90)
    })
})

describe("profileToPolygons", () => {
    context("a rectangle", () => {
        it("emits one counter-clockwise loop of four y-flipped corners", () => {
            const loops = profileToPolygons(sheet([{ kind: "rect", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }]))
            expect(loops).toHaveLength(1)
            expect(loops[0]).toHaveLength(4)
            // y is flipped about the 297 mm sheet height.
            expect(loops[0].map((p) => p.y).every((y) => y >= 287)).toBe(true)
            expect(signedArea(loops[0])).toBeGreaterThan(0)
        })
    })

    context("a circle", () => {
        it("tessellates into the requested segment count, all on the radius", () => {
            const loops = profileToPolygons(sheet([{ kind: "circle", center: { x: 50, y: 50 }, radius: 20 }]), 16)
            expect(loops).toHaveLength(1)
            expect(loops[0]).toHaveLength(16)
            const c = { x: 50, y: 297 - 50 }
            for (const p of loops[0]) {
                expect(distance(p, c)).toBeCloseTo(20, 6)
            }
        })
    })

    context("a closed polyline", () => {
        it("becomes a loop; an open one does not", () => {
            const tri: Point[] = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 5, y: 8 }
            ]
            expect(profileToPolygons(sheet([{ kind: "polyline", points: tri, closed: true }]))).toHaveLength(1)
            expect(profileToPolygons(sheet([{ kind: "polyline", points: tri, closed: false }]))).toHaveLength(0)
        })
    })

    context("non-fillable shapes", () => {
        it("skips lines and arcs", () => {
            const loops = profileToPolygons(
                sheet([
                    { kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
                    { kind: "arc", center: { x: 5, y: 5 }, radius: 5, startDeg: 0, endDeg: 180 }
                ])
            )
            expect(loops).toHaveLength(0)
        })
    })
})

describe("drawingToSvg", () => {
    const drawing = sheet([
        { kind: "rect", a: { x: 10, y: 10 }, b: { x: 50, y: 35 } },
        { kind: "circle", center: { x: 100, y: 100 }, radius: 20 }
    ])

    it("emits a millimetre-unit SVG with the sheet viewBox", () => {
        const svg = drawingToSvg(drawing)
        expect(svg.startsWith("<svg")).toBe(true)
        expect(svg).toContain('width="210mm"')
        expect(svg).toContain('viewBox="0 0 210 297"')
        expect(svg.endsWith("</svg>")).toBe(true)
    })

    it("renders each shape and, by default, its dimension label", () => {
        const svg = drawingToSvg(drawing)
        expect(svg).toContain("<rect")
        expect(svg).toContain("<circle")
        expect(svg).toContain("40 × 25")
        expect(svg).toContain("⌀ 40")
    })

    context("with grid enabled and dimensions disabled", () => {
        it("draws grid lines and omits labels", () => {
            const svg = drawingToSvg(drawing, { grid: true, dimensions: false })
            expect(svg).toContain('stroke-width="0.1"')
            expect(svg).not.toContain("40 × 25")
        })
    })
})
