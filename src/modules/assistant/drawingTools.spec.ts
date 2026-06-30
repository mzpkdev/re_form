import { beforeEach, describe, expect, it } from "bun:test"
import { initManifold } from "../../lib/manifold"
import { drawingToManifold, getDrawing, newDrawing } from "../drawing"
import { DRAWING_TOOLS, describeViews, executeDrawingTool } from "./drawingTools"

const context = describe

/** A 50x50 square outline in a view's 2D space. */
const SQUARE = [
    [0, 0],
    [50, 0],
    [50, 50],
    [0, 50]
]

const setViews = (views: Record<string, unknown>): string => executeDrawingTool("set_views", JSON.stringify(views))

describe("drawingTools", () => {
    beforeEach(() => {
        // Reset the singleton document so state doesn't leak between tests.
        newDrawing()
    })

    context("DRAWING_TOOLS", () => {
        it("exposes exactly one tool, set_views", () => {
            expect(DRAWING_TOOLS).toHaveLength(1)
            expect(DRAWING_TOOLS[0].function.name).toBe("set_views")
        })
    })

    context("set_views", () => {
        it("lifts each view's polygons into closed polyline entities on their origin-plane", () => {
            const result = setViews({ front: [SQUARE], top: [SQUARE], side: [SQUARE] })

            expect(result).toBe("views set: 3 view(s), 3 silhouette(s)")
            const entities = getDrawing().entities
            expect(entities).toHaveLength(3)
            for (const entity of entities) {
                expect(entity.type).toBe("polyline")
                if (entity.type !== "polyline") throw new Error("expected a polyline")
                expect(entity.closed).toBe(true)
                expect(entity.points).toHaveLength(4)
                // Lifted to 3D world coordinates.
                expect(entity.points[0]).toHaveLength(3)
            }
        })

        it("places a front-view polygon on the z=0 plane", () => {
            setViews({ front: [SQUARE] })

            const entity = getDrawing().entities[0]
            if (entity.type !== "polyline") throw new Error("expected a polyline")
            for (const [, , z] of entity.points) {
                expect(z).toBe(0)
            }
        })

        it("accepts a single view but warns that a solid needs at least two", () => {
            const result = setViews({ front: [SQUARE] })

            expect(result).toStartWith("views set: 1 view(s), 1 silhouette(s)")
            expect(result).toContain("at least 2 views")
            expect(getDrawing().entities).toHaveLength(1)
        })

        it("rejects a polygon with fewer than 3 points and leaves the document untouched", () => {
            setViews({ front: [SQUARE], top: [SQUARE] })

            const result = setViews({
                front: [
                    [
                        [0, 0],
                        [10, 0]
                    ]
                ]
            })

            expect(result).toStartWith("Error:")
            expect(getDrawing().entities).toHaveLength(2)
        })

        it("rejects a non-numeric coordinate", () => {
            expect(
                setViews({
                    front: [
                        [
                            ["x", 0],
                            [10, 0],
                            [10, 10]
                        ]
                    ]
                })
            ).toStartWith("Error:")
        })

        it("rejects a call with no views", () => {
            expect(setViews({})).toStartWith("Error:")
        })

        it("returns an error string for invalid JSON arguments", () => {
            expect(executeDrawingTool("set_views", "{not json").startsWith("Error:")).toBe(true)
        })

        it("returns an error string for an unknown tool", () => {
            expect(executeDrawingTool("set_drawing", "{}").startsWith("Error:")).toBe(true)
        })
    })

    context("describeViews", () => {
        it("reports the current geometry back as per-view 2D polygons", () => {
            setViews({ front: [SQUARE], top: [SQUARE] })

            const views = JSON.parse(describeViews()) as Record<string, number[][][]>
            expect(views.front.length).toBeGreaterThanOrEqual(1)
            expect(views.top.length).toBeGreaterThanOrEqual(1)
            expect(views.side).toHaveLength(0)
        })
    })

    context("reconstruction", () => {
        it("builds a solid 50mm cube from three square views", async () => {
            setViews({ front: [SQUARE], top: [SQUARE], side: [SQUARE] })

            const wasm = await initManifold()
            const solid = drawingToManifold(wasm, getDrawing())

            expect(solid).not.toBeNull()
            if (!solid) throw new Error("expected a solid")
            expect(solid.isEmpty()).toBe(false)
            // A 50mm cube is 125000 mm^3; allow slack for reconstruction margins.
            expect(solid.volume()).toBeGreaterThan(120000)
            expect(solid.volume()).toBeLessThan(130000)
            solid.delete()
        })
    })
})
