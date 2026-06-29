import { describe, expect, it } from "bun:test"
import { flattenEntity, planeNormal, projectPoint, tessellateEntity, unprojectPoint } from "./project"
import type { Arc, Circle, Plane, Vec3 } from "./types"

const context = describe

const planes: Plane[] = ["front", "top", "side"]

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe("project", () => {
    context("on-plane round trip", () => {
        for (const plane of planes) {
            it(`project(unproject(p)) === p on ${plane}`, () => {
                for (const p of [
                    [0, 0],
                    [3, -7],
                    [-12.5, 4.25]
                ] as const) {
                    expect(projectPoint(unprojectPoint([...p], plane), plane)).toEqual([...p])
                }
            })
        }
    })

    context("documented mappings", () => {
        it("matches the v1 convention for each plane", () => {
            const p: Vec3 = [2, 3, 5]
            expect(projectPoint(p, "front")).toEqual([2, 3])
            expect(projectPoint(p, "top")).toEqual([2, -5])
            expect(projectPoint(p, "side")).toEqual([-5, 3])
        })
    })

    context("cross-plane collapse", () => {
        it("a front-plane circle viewed from top collapses to a near-horizontal line", () => {
            const circle: Circle = { id: "c", type: "circle", center: [0, 0, 0], radius: 10, normal: [0, 0, 1] }
            const { points } = flattenEntity(circle, "top")
            const vs = points.map(([, v]) => v)
            // The circle lives in z=0, so projecting to top ([x,-z]) flattens every
            // sample to v≈0 — an edge-on horizontal line.
            for (const v of vs) {
                expect(Math.abs(v)).toBeLessThan(1e-9)
            }
            // ...while it still has horizontal extent.
            const us = points.map(([u]) => u)
            expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(10)
        })
    })

    context("tessellateEntity", () => {
        it("returns line endpoints unchanged", () => {
            expect(tessellateEntity({ id: "l", type: "line", a: [0, 0, 0], b: [1, 2, 3] })).toEqual({
                points: [
                    [0, 0, 0],
                    [1, 2, 3]
                ],
                closed: false
            })
        })

        it("returns polyline points and closedness", () => {
            const pts: Vec3[] = [
                [0, 0, 0],
                [1, 0, 0],
                [1, 1, 0]
            ]
            expect(tessellateEntity({ id: "p", type: "polyline", points: pts, closed: true })).toEqual({
                points: pts,
                closed: true
            })
        })

        it("samples a circle's points all at radius from center and in the plane ⟂ normal", () => {
            const normal: Vec3 = [0, 0, 1]
            const center: Vec3 = [1, 2, 0]
            const circle: Circle = { id: "c", type: "circle", center, radius: 7, normal }
            const { points, closed } = tessellateEntity(circle, 32)

            expect(closed).toBe(true)
            expect(points).toHaveLength(32)
            for (const pt of points) {
                expect(dist(pt, center)).toBeCloseTo(7, 9)
                // Lies in the plane perpendicular to the normal through center.
                expect(dot([pt[0] - center[0], pt[1] - center[1], pt[2] - center[2]], normal)).toBeCloseTo(0, 9)
            }
        })

        it("samples a circle correctly for a non-axis-aligned normal", () => {
            const normal: Vec3 = [1, 1, 1]
            const center: Vec3 = [0, 0, 0]
            const circle: Circle = { id: "c", type: "circle", center, radius: 3, normal }
            const { points } = tessellateEntity(circle, 16)
            for (const pt of points) {
                expect(dist(pt, center)).toBeCloseTo(3, 9)
                expect(dot(pt, normal)).toBeCloseTo(0, 9)
            }
        })

        it("respects an arc's start and end angles (inclusive) and is open", () => {
            // Quarter arc in the z=0 plane: normal [0,0,1] gives uAxis along +y,
            // vAxis along -x for the chosen reference; assert via geometry, not basis.
            const arc: Arc = {
                id: "a",
                type: "arc",
                center: [0, 0, 0],
                radius: 5,
                normal: [0, 0, 1],
                startDeg: 0,
                endDeg: 90
            }
            const { points, closed } = tessellateEntity(arc, 8)

            expect(closed).toBe(false)
            expect(points).toHaveLength(9) // segments + 1, inclusive of both ends
            for (const pt of points) {
                expect(dist(pt, [0, 0, 0])).toBeCloseTo(5, 9)
                expect(pt[2]).toBeCloseTo(0, 9)
            }
            // Endpoints are 90° apart: the dot of the two radius vectors is ~0.
            const first = points[0]
            const last = points[points.length - 1]
            expect(dot(first, last)).toBeCloseTo(0, 6)
        })
    })

    context("flattenEntity", () => {
        it("tessellates then projects each point onto the plane", () => {
            const arc: Arc = {
                id: "a",
                type: "arc",
                center: [0, 0, 0],
                radius: 5,
                normal: [0, 0, 1],
                startDeg: 0,
                endDeg: 90
            }
            const flat = flattenEntity(arc, "front", 8)
            const { points } = tessellateEntity(arc, 8)

            expect(flat.closed).toBe(false)
            expect(flat.points).toEqual(points.map((p) => projectPoint(p, "front")))
        })
    })

    context("planeNormal", () => {
        it("returns the world unit normal of each principal plane", () => {
            expect(planeNormal("front")).toEqual([0, 0, 1])
            expect(planeNormal("top")).toEqual([0, 1, 0])
            expect(planeNormal("side")).toEqual([1, 0, 0])
        })

        it("is unit length and perpendicular to the plane it lifts into", () => {
            // A normal must be orthogonal to every in-plane direction. unproject of
            // two non-parallel view axes spans the plane, so the normal dots ~0 with
            // both — and has length 1.
            for (const plane of planes) {
                const n = planeNormal(plane)
                expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 12)
                const eu = unprojectPoint([1, 0], plane)
                const ev = unprojectPoint([0, 1], plane)
                expect(dot(n, eu)).toBeCloseTo(0, 12)
                expect(dot(n, ev)).toBeCloseTo(0, 12)
            }
        })
    })
})
