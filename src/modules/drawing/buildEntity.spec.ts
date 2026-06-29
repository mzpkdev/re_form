import { describe, expect, it } from "bun:test"
import { buildEntity } from "./buildEntity"
import { planeNormal, unprojectPoint } from "./project"
import type { Circle, Line, Plane, Polyline, Vec2, Vec3 } from "./types"

const context = describe

const planes: Plane[] = ["front", "top", "side"]

// Negating a zero component (e.g. top's `-v` with v=0) yields IEEE -0, which
// `toEqual` distinguishes from 0 though they're geometrically identical. Fold
// -0 to 0 so the literal expecteds below stay readable without sprinkling -0.
const norm = (v: Vec3): Vec3 => v.map((n) => n + 0) as Vec3

/**
 * These specs ARE the proof of the y-up coordinate contract: the caller hands
 * `buildEntity` world-2D points (the SVG `scale(1,-1)` flip already undone), and
 * each is lifted onto the active plane via `unprojectPoint`. We assert the
 * literal 3D coords for a known input on every plane — a sign error in the
 * conversion recipe would surface right here — plus the degenerate→null cases.
 *
 * Expected unproject mappings (the v1 contract):
 *   front: [u,v] -> [u, v,  0]
 *   top:   [u,v] -> [u, 0, -v]
 *   side:  [u,v] -> [0, v, -u]
 */
describe("buildEntity", () => {
    context("line", () => {
        it("lifts the two endpoints onto each plane (literal coords)", () => {
            const p0: Vec2 = [10, 20]
            const p1: Vec2 = [30, 40]
            const expected: Record<Plane, { a: Vec3; b: Vec3 }> = {
                front: { a: [10, 20, 0], b: [30, 40, 0] },
                // The brief's worked example: line on `top` [10,20]->[30,40].
                top: { a: [10, 0, -20], b: [30, 0, -40] },
                side: { a: [0, 20, -10], b: [0, 40, -30] }
            }
            for (const plane of planes) {
                const entity = buildEntity("line", [p0, p1], plane) as Line
                expect(entity.type).toBe("line")
                expect(entity.id).toBeString()
                expect(norm(entity.a)).toEqual(expected[plane].a)
                expect(norm(entity.b)).toEqual(expected[plane].b)
            }
        })

        it("endpoints always match unprojectPoint of the inputs", () => {
            const p0: Vec2 = [-3.5, 7.25]
            const p1: Vec2 = [12, -4]
            for (const plane of planes) {
                const entity = buildEntity("line", [p0, p1], plane) as Line
                expect(entity.a).toEqual(unprojectPoint(p0, plane))
                expect(entity.b).toEqual(unprojectPoint(p1, plane))
            }
        })

        it("returns null when the two endpoints are coincident", () => {
            for (const plane of planes) {
                expect(
                    buildEntity(
                        "line",
                        [
                            [5, 5],
                            [5, 5]
                        ],
                        plane
                    )
                ).toBeNull()
            }
        })

        it("returns null with fewer than two points", () => {
            expect(buildEntity("line", [], "front")).toBeNull()
            expect(buildEntity("line", [[1, 2]], "front")).toBeNull()
        })
    })

    context("circle", () => {
        it("centers via unproject and takes the plane normal (literal coords)", () => {
            const center: Vec2 = [10, 20]
            const rim: Vec2 = [13, 24] // 3-4-5: radius 5 on every plane
            const expectedCenter: Record<Plane, Vec3> = {
                front: [10, 20, 0],
                top: [10, 0, -20],
                side: [0, 20, -10]
            }
            for (const plane of planes) {
                const entity = buildEntity("circle", [center, rim], plane) as Circle
                expect(entity.type).toBe("circle")
                expect(norm(entity.center)).toEqual(expectedCenter[plane])
                expect(entity.radius).toBeCloseTo(5, 12)
                expect(entity.normal).toEqual(planeNormal(plane))
            }
        })

        it("radius is the world-2D distance, independent of plane", () => {
            const center: Vec2 = [0, 0]
            const rim: Vec2 = [6, 8] // hypot 10
            for (const plane of planes) {
                const entity = buildEntity("circle", [center, rim], plane) as Circle
                expect(entity.radius).toBeCloseTo(10, 12)
            }
        })

        it("normal matches the plane: front->+Z, top->+Y, side->+X", () => {
            expect(
                (
                    buildEntity(
                        "circle",
                        [
                            [0, 0],
                            [1, 0]
                        ],
                        "front"
                    ) as Circle
                ).normal
            ).toEqual([0, 0, 1])
            expect(
                (
                    buildEntity(
                        "circle",
                        [
                            [0, 0],
                            [1, 0]
                        ],
                        "top"
                    ) as Circle
                ).normal
            ).toEqual([0, 1, 0])
            expect(
                (
                    buildEntity(
                        "circle",
                        [
                            [0, 0],
                            [1, 0]
                        ],
                        "side"
                    ) as Circle
                ).normal
            ).toEqual([1, 0, 0])
        })

        it("returns null when the rim coincides with the center (zero radius)", () => {
            for (const plane of planes) {
                expect(
                    buildEntity(
                        "circle",
                        [
                            [2, 2],
                            [2, 2]
                        ],
                        plane
                    )
                ).toBeNull()
            }
        })

        it("returns null with fewer than two points", () => {
            expect(buildEntity("circle", [[1, 1]], "front")).toBeNull()
        })
    })

    context("polyline", () => {
        it("lifts every vertex onto each plane, open (literal coords)", () => {
            const pts: Vec2[] = [
                [0, 0],
                [10, 0],
                [10, 10]
            ]
            const expected: Record<Plane, Vec3[]> = {
                front: [
                    [0, 0, 0],
                    [10, 0, 0],
                    [10, 10, 0]
                ],
                top: [
                    [0, 0, 0],
                    [10, 0, 0],
                    [10, 0, -10]
                ],
                side: [
                    [0, 0, 0],
                    [0, 0, -10],
                    [0, 10, -10]
                ]
            }
            for (const plane of planes) {
                const entity = buildEntity("polyline", pts, plane) as Polyline
                expect(entity.type).toBe("polyline")
                expect(entity.closed).toBe(false)
                expect(entity.points.map(norm)).toEqual(expected[plane])
            }
        })

        it("accepts exactly two distinct points", () => {
            for (const plane of planes) {
                const entity = buildEntity(
                    "polyline",
                    [
                        [0, 0],
                        [5, 5]
                    ],
                    plane
                ) as Polyline
                expect(entity.points).toHaveLength(2)
            }
        })

        it("defaults to open when no closed flag is given", () => {
            const entity = buildEntity(
                "polyline",
                [
                    [0, 0],
                    [10, 0],
                    [10, 10]
                ],
                "front"
            ) as Polyline
            expect(entity.closed).toBe(false)
        })

        it("builds a closed polyline when closed is true", () => {
            const pts: Vec2[] = [
                [0, 0],
                [10, 0],
                [10, 10]
            ]
            for (const plane of planes) {
                const entity = buildEntity("polyline", pts, plane, true) as Polyline
                expect(entity.type).toBe("polyline")
                expect(entity.closed).toBe(true)
                // The geometry is unchanged from the open build — only the flag flips.
                expect(entity.points).toHaveLength(3)
            }
        })

        it("respects an explicit closed=false", () => {
            const entity = buildEntity(
                "polyline",
                [
                    [0, 0],
                    [5, 5]
                ],
                "front",
                false
            ) as Polyline
            expect(entity.closed).toBe(false)
        })

        it("a closed polyline still needs at least two distinct points", () => {
            expect(buildEntity("polyline", [[1, 1]], "front", true)).toBeNull()
            expect(
                buildEntity(
                    "polyline",
                    [
                        [1, 1],
                        [1, 1]
                    ],
                    "front",
                    true
                )
            ).toBeNull()
        })

        it("dedupes consecutive duplicate vertices before counting", () => {
            // A stuttered click (same point twice) plus one real vertex is still a
            // valid 2-point polyline, not three points.
            const entity = buildEntity(
                "polyline",
                [
                    [0, 0],
                    [0, 0],
                    [5, 5]
                ],
                "front"
            ) as Polyline
            expect(entity.points).toEqual([
                [0, 0, 0],
                [5, 5, 0]
            ])
        })

        it("returns null when fewer than two distinct points remain", () => {
            expect(buildEntity("polyline", [], "front")).toBeNull()
            expect(buildEntity("polyline", [[1, 1]], "front")).toBeNull()
            // Two coincident points collapse to one -> null.
            expect(
                buildEntity(
                    "polyline",
                    [
                        [1, 1],
                        [1, 1]
                    ],
                    "front"
                )
            ).toBeNull()
        })
    })

    context("non-constructive tools", () => {
        it("returns null for select, arc, and unknown tools regardless of points", () => {
            const pts: Vec2[] = [
                [0, 0],
                [10, 10]
            ]
            for (const plane of planes) {
                expect(buildEntity("select", pts, plane)).toBeNull()
                expect(buildEntity("arc", pts, plane)).toBeNull()
            }
        })
    })

    context("ids", () => {
        it("mints a distinct id per built entity", () => {
            const a = buildEntity(
                "line",
                [
                    [0, 0],
                    [1, 1]
                ],
                "front"
            )
            const b = buildEntity(
                "line",
                [
                    [0, 0],
                    [1, 1]
                ],
                "front"
            )
            expect(a?.id).not.toBe(b?.id)
        })
    })
})
