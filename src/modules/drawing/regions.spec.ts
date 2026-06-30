import { describe, expect, it } from "bun:test"
import { addEntity, createDrawing } from "./document"
import { projectPoint, unprojectPoint } from "./project"
import { detectBrokenEntities, detectRegions } from "./regions"
import type { Drawing, Entity, Line, Plane, Polyline, Vec2, Vec3 } from "./types"

const context = describe

let nextId = 0
const id = () => `e${nextId++}`

/** A line entity between two 2D view points lifted onto `plane`. */
const lineOn = (plane: Plane, a: Vec2, b: Vec2): Line => ({
    id: id(),
    type: "line",
    a: unprojectPoint(a, plane),
    b: unprojectPoint(b, plane)
})

/** A polyline entity through 2D view points lifted onto `plane`. */
const polylineOn = (plane: Plane, pts: Vec2[], closed: boolean): Polyline => ({
    id: id(),
    type: "polyline",
    points: pts.map((p) => unprojectPoint(p, plane)),
    closed
})

const docOf = (...entities: Entity[]): Drawing => entities.reduce(addEntity, createDrawing())

// A unit square's corners in 2D view space, CCW.
const SQUARE: Vec2[] = [
    [0, 0],
    [40, 0],
    [40, 40],
    [0, 40]
]

/** The set of "x,y" keys (rounded) of a contour, order-independent. */
const cornerKeys = (contour: Vec2[]): Set<string> => new Set(contour.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`))

/** The corner-key set expected for a square in a given plane's view space. */
const squareKeys = (plane: Plane): Set<string> =>
    cornerKeys(SQUARE.map((q) => projectPoint(unprojectPoint(q, plane), plane)))

describe("detectRegions", () => {
    context("a single closed polyline", () => {
        it("yields one region with the 4 square corners", () => {
            const regions = detectRegions(docOf(polylineOn("front", SQUARE, true)))
            expect(regions).toHaveLength(1)
            expect(regions[0].plane).toBe("front")
            expect(regions[0].contour).toHaveLength(4)
            expect(cornerKeys(regions[0].contour)).toEqual(squareKeys("front"))
        })

        it("walks the contour as a connected ring (each step shares an endpoint)", () => {
            const [{ contour }] = detectRegions(docOf(polylineOn("front", SQUARE, true)))
            // Consecutive corners (wrapping) must each be one of the square's edges,
            // proving the walk produced an ordered ring, not an arbitrary set.
            const edgeKeys = new Set([
                "0.000000,0.000000|40.000000,0.000000",
                "40.000000,0.000000|40.000000,40.000000",
                "40.000000,40.000000|0.000000,40.000000",
                "0.000000,40.000000|0.000000,0.000000"
            ])
            const norm = (a: Vec2, b: Vec2) => {
                const ka = `${a[0].toFixed(6)},${a[1].toFixed(6)}`
                const kb = `${b[0].toFixed(6)},${b[1].toFixed(6)}`
                return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
            }
            const symmetric = new Set<string>()
            for (const e of edgeKeys) {
                const [p, q] = e.split("|")
                symmetric.add(p < q ? `${p}|${q}` : `${q}|${p}`)
            }
            for (let i = 0; i < contour.length; i++) {
                const a = contour[i]
                const b = contour[(i + 1) % contour.length]
                expect(symmetric.has(norm(a, b))).toBe(true)
            }
        })
    })

    context("four separate lines meeting at corners (drawn with anything)", () => {
        it("yields one region — the headline connected-segments case", () => {
            const regions = detectRegions(
                docOf(
                    lineOn("front", SQUARE[0], SQUARE[1]),
                    lineOn("front", SQUARE[1], SQUARE[2]),
                    lineOn("front", SQUARE[2], SQUARE[3]),
                    lineOn("front", SQUARE[3], SQUARE[0])
                )
            )
            expect(regions).toHaveLength(1)
            expect(regions[0].contour).toHaveLength(4)
            expect(cornerKeys(regions[0].contour)).toEqual(squareKeys("front"))
        })

        it("detects the loop regardless of the order lines were added", () => {
            const regions = detectRegions(
                docOf(
                    lineOn("front", SQUARE[2], SQUARE[3]),
                    lineOn("front", SQUARE[0], SQUARE[1]),
                    lineOn("front", SQUARE[3], SQUARE[0]),
                    lineOn("front", SQUARE[1], SQUARE[2])
                )
            )
            expect(regions).toHaveLength(1)
            expect(cornerKeys(regions[0].contour)).toEqual(squareKeys("front"))
        })

        it("detects a loop closed by a mix of lines and an open polyline", () => {
            // Three sides as one open polyline, the fourth as a line closing it.
            const regions = detectRegions(
                docOf(
                    polylineOn("front", [SQUARE[0], SQUARE[1], SQUARE[2], SQUARE[3]], false),
                    lineOn("front", SQUARE[3], SQUARE[0])
                )
            )
            expect(regions).toHaveLength(1)
            expect(cornerKeys(regions[0].contour)).toEqual(squareKeys("front"))
        })
    })

    context("open paths are not regions", () => {
        it("yields no regions for an open polyline", () => {
            expect(detectRegions(docOf(polylineOn("front", SQUARE, false)))).toHaveLength(0)
        })

        it("yields no regions for three lines forming a U (two degree-1 endpoints)", () => {
            const regions = detectRegions(
                docOf(
                    lineOn("front", SQUARE[0], SQUARE[1]),
                    lineOn("front", SQUARE[1], SQUARE[2]),
                    lineOn("front", SQUARE[2], SQUARE[3])
                )
            )
            expect(regions).toHaveLength(0)
        })

        it("yields no regions for a single line", () => {
            expect(detectRegions(docOf(lineOn("front", [0, 0], [40, 0])))).toHaveLength(0)
        })
    })

    context("two disjoint squares", () => {
        it("yields two regions", () => {
            const far: Vec2[] = SQUARE.map(([x, y]) => [x + 200, y + 200])
            const regions = detectRegions(docOf(polylineOn("front", SQUARE, true), polylineOn("front", far, true)))
            expect(regions).toHaveLength(2)
            for (const region of regions) {
                expect(region.contour).toHaveLength(4)
            }
        })
    })

    context("a closed polyline is its own region, immune to stray neighbors", () => {
        it("detects the closed square despite a stray line off one corner", () => {
            // The spur touches corner [0,0] but the closed polyline names its own
            // loop directly, so it never enters the graph that the spur poisons.
            const regions = detectRegions(
                docOf(polylineOn("front", SQUARE, true), lineOn("front", SQUARE[0], [-40, -40]))
            )
            expect(regions).toHaveLength(1)
            expect(cornerKeys(regions[0].contour)).toEqual(squareKeys("front"))
        })

        it("detects two closed squares even when a spur touches one", () => {
            const far: Vec2[] = SQUARE.map(([x, y]) => [x + 200, y + 200])
            const regions = detectRegions(
                docOf(
                    polylineOn("front", SQUARE, true),
                    lineOn("front", SQUARE[0], [-40, -40]),
                    polylineOn("front", far, true)
                )
            )
            expect(regions).toHaveLength(2)
        })
    })

    context("two closed profiles sharing an edge on one plane", () => {
        it("detects BOTH instead of disqualifying them at the shared nodes (bug repro)", () => {
            // The two top-plane profiles from the reported drawing: a 30×30 outline
            // and a 30×10 strip inside it, sharing the bottom edge and corners.
            const outer = polylineOn(
                "top",
                [
                    [0, 0],
                    [0, 10],
                    [0, 30],
                    [30, 30],
                    [30, 0]
                ],
                true
            )
            const inner = polylineOn(
                "top",
                [
                    [0, 10],
                    [30, 10],
                    [30, 0],
                    [0, 0]
                ],
                true
            )
            expect(detectRegions(docOf(outer, inner))).toHaveLength(2)
            // …and neither is flagged as breaking the 3D build.
            expect(detectBrokenEntities(docOf(outer, inner)).size).toBe(0)
        })
    })

    context("a spur still breaks a loop ASSEMBLED from separate open segments", () => {
        it("skips a line-built square with a stray line off one corner", () => {
            const regions = detectRegions(
                docOf(
                    lineOn("front", SQUARE[0], SQUARE[1]),
                    lineOn("front", SQUARE[1], SQUARE[2]),
                    lineOn("front", SQUARE[2], SQUARE[3]),
                    lineOn("front", SQUARE[3], SQUARE[0]),
                    lineOn("front", SQUARE[0], [-40, -40])
                )
            )
            expect(regions).toHaveLength(0)
        })
    })

    context("regions are detected independently per principal plane", () => {
        for (const plane of ["front", "top", "side"] as const) {
            it(`detects a square drawn on the ${plane} plane`, () => {
                const regions = detectRegions(docOf(polylineOn(plane, SQUARE, true)))
                expect(regions).toHaveLength(1)
                expect(regions[0].plane).toBe(plane)
                expect(cornerKeys(regions[0].contour)).toEqual(squareKeys(plane))
            })
        }

        it("detects one square on each of front, top, and side at once", () => {
            const regions = detectRegions(
                docOf(
                    polylineOn("front", SQUARE, true),
                    polylineOn("top", SQUARE, true),
                    polylineOn("side", SQUARE, true)
                )
            )
            expect(regions).toHaveLength(3)
            expect(new Set(regions.map((r) => r.plane))).toEqual(new Set<Plane>(["front", "top", "side"]))
        })

        it("ignores entities that lie on no principal plane (skew)", () => {
            const skew: Polyline = {
                id: id(),
                type: "polyline",
                closed: true,
                points: [
                    [0, 0, 0],
                    [40, 0, 0],
                    [40, 40, 40],
                    [0, 40, 40]
                ] as Vec3[]
            }
            expect(detectRegions(docOf(skew))).toHaveLength(0)
        })

        it("ignores circles (no straight segments)", () => {
            const circleDoc = docOf({
                id: id(),
                type: "circle",
                center: [0, 0, 0],
                radius: 20,
                normal: [0, 0, 1]
            })
            expect(detectRegions(circleDoc)).toHaveLength(0)
        })
    })
})

describe("detectBrokenEntities", () => {
    context("geometry that bounds a closed region is not broken", () => {
        it("clears a single closed polyline square", () => {
            const square = polylineOn("front", SQUARE, true)
            expect(detectBrokenEntities(docOf(square)).size).toBe(0)
        })

        it("clears four separate lines meeting at the corners", () => {
            const lines = [
                lineOn("front", SQUARE[0], SQUARE[1]),
                lineOn("front", SQUARE[1], SQUARE[2]),
                lineOn("front", SQUARE[2], SQUARE[3]),
                lineOn("front", SQUARE[3], SQUARE[0])
            ]
            expect(detectBrokenEntities(docOf(...lines)).size).toBe(0)
        })

        it("clears a loop closed by a mix of an open polyline and a line", () => {
            const open = polylineOn("front", [SQUARE[0], SQUARE[1], SQUARE[2], SQUARE[3]], false)
            const closer = lineOn("front", SQUARE[3], SQUARE[0])
            expect(detectBrokenEntities(docOf(open, closer)).size).toBe(0)
        })

        it("does not flag a circle — it is not a line", () => {
            const circleDoc = docOf({ id: id(), type: "circle", center: [0, 0, 0], radius: 20, normal: [0, 0, 1] })
            expect(detectBrokenEntities(circleDoc).size).toBe(0)
        })
    })

    context("geometry that bounds no region is broken", () => {
        it("flags an open polyline", () => {
            const open = polylineOn("front", SQUARE, false)
            expect(detectBrokenEntities(docOf(open)).has(open.id)).toBe(true)
        })

        it("flags a lone single line", () => {
            const line = lineOn("front", [0, 0], [40, 0])
            expect(detectBrokenEntities(docOf(line)).has(line.id)).toBe(true)
        })

        it("flags a skew entity that lies on no principal plane", () => {
            const skew: Polyline = {
                id: id(),
                type: "polyline",
                closed: true,
                points: [
                    [0, 0, 0],
                    [40, 0, 0],
                    [40, 40, 40],
                    [0, 40, 40]
                ] as Vec3[]
            }
            expect(detectBrokenEntities(docOf(skew)).has(skew.id)).toBe(true)
        })
    })

    context("a spur beside a closed polyline flags only the spur", () => {
        it("leaves the closed square clean and flags just the stray line", () => {
            const square = polylineOn("front", SQUARE, true)
            const spur = lineOn("front", SQUARE[0], [-40, -40])
            const broken = detectBrokenEntities(docOf(square, spur))
            expect(broken.has(square.id)).toBe(false)
            expect(broken.has(spur.id)).toBe(true)
            expect(broken.size).toBe(1)
        })
    })

    context("a spur poisoning a loop built from separate lines flags them all", () => {
        it("flags every line of the line-built square plus the spur", () => {
            const sides = [
                lineOn("front", SQUARE[0], SQUARE[1]),
                lineOn("front", SQUARE[1], SQUARE[2]),
                lineOn("front", SQUARE[2], SQUARE[3]),
                lineOn("front", SQUARE[3], SQUARE[0])
            ]
            const spur = lineOn("front", SQUARE[0], [-40, -40])
            const broken = detectBrokenEntities(docOf(...sides, spur))
            for (const side of sides) {
                expect(broken.has(side.id)).toBe(true)
            }
            expect(broken.has(spur.id)).toBe(true)
            expect(broken.size).toBe(5)
        })
    })
})
