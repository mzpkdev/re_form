import { describe, expect, it } from "bun:test"
import { initManifold } from "../../lib/manifold"
import { addEntity, createDrawing } from "./document"
import { drawingToManifold, extrudeProfileBetween, inferPlane } from "./extrude"
import { planeNormal, unprojectPoint } from "./project"
import type { Drawing, Plane, Vec2 } from "./types"

const context = describe

// A 40×40 square in 2D view space, lifted onto a plane via `unprojectPoint` so
// the profile genuinely lies on that plane (the same lift the editor performs
// when a user draws on it).
const SQUARE_2D: Vec2[] = [
    [0, 0],
    [40, 0],
    [40, 40],
    [0, 40]
]

// A 2D square `size` wide, optionally offset, in view space.
const square2D = (size: number, offset: Vec2 = [0, 0]): Vec2[] => [
    [offset[0], offset[1]],
    [offset[0] + size, offset[1]],
    [offset[0] + size, offset[1] + size],
    [offset[0], offset[1] + size]
]

// A closed-polyline square on `plane`: the shape `detectRegions` walks, built
// from a 2D square lifted into world space (the editor's exact lift).
const squareEntityOnPlane = (id: string, corners2D: Vec2[], plane: Plane) =>
    ({
        id,
        type: "polyline" as const,
        closed: true,
        points: corners2D.map((q) => unprojectPoint(q, plane))
    }) satisfies Drawing["entities"][number]

// A drawing made of one closed square per listed view, each lifted onto its
// plane. The same 2D square may be reused across planes (e.g. three 2×2 squares).
const viewsDoc = (views: { plane: Plane; corners2D: Vec2[] }[]): Drawing => {
    let doc = createDrawing()
    views.forEach((v, i) => {
        doc = addEntity(doc, squareEntityOnPlane(`v${i}`, v.corners2D, v.plane))
    })
    return doc
}

describe("extrude", () => {
    context("inferPlane", () => {
        it("detects a front-plane profile (all z ≈ 0)", () => {
            expect(inferPlane(SQUARE_2D.map((q) => unprojectPoint(q, "front")))).toBe("front")
        })

        it("detects a top-plane profile (all y ≈ 0)", () => {
            expect(inferPlane(SQUARE_2D.map((q) => unprojectPoint(q, "top")))).toBe("top")
        })

        it("detects a side-plane profile (all x ≈ 0)", () => {
            expect(inferPlane(SQUARE_2D.map((q) => unprojectPoint(q, "side")))).toBe("side")
        })

        it("returns null for a skew profile on no principal plane", () => {
            expect(
                inferPlane([
                    [0, 0, 0],
                    [40, 0, 0],
                    [40, 40, 40]
                ])
            ).toBeNull()
        })
    })

    context("extrudeProfileBetween", () => {
        // The axis-aligned box the spec REQUIRES the bar to occupy: every local
        // point (u, v, w) must land at `unprojectPoint([u,v], plane) + w*normal`.
        // We evaluate that contract over the profile corners (in 2D view space)
        // and both caps (w = lo and w = hi), then take the min/max per world
        // axis. Deriving the box this way — not hardcoding it — bakes the
        // per-plane sign convention in, so a mirror or swapped axis fails it.
        const expectedBox = (corners2D: Vec2[], plane: Plane, lo: number, hi: number) => {
            const n = planeNormal(plane)
            const min: [number, number, number] = [
                Number.POSITIVE_INFINITY,
                Number.POSITIVE_INFINITY,
                Number.POSITIVE_INFINITY
            ]
            const max: [number, number, number] = [
                Number.NEGATIVE_INFINITY,
                Number.NEGATIVE_INFINITY,
                Number.NEGATIVE_INFINITY
            ]
            for (const corner of corners2D) {
                const base = unprojectPoint(corner, plane)
                for (const w of [lo, hi]) {
                    for (let i = 0; i < 3; i++) {
                        const c = base[i] + w * n[i]
                        min[i] = Math.min(min[i], c)
                        max[i] = Math.max(max[i], c)
                    }
                }
            }
            return { min, max }
        }

        // For each plane: extruding the lifted square across [lo, hi] must land a
        // 40×40 bar of height (hi-lo) exactly where it was drawn — its bounding
        // box equals the unproject+normal contract's prediction, and its volume
        // is 40·40·(hi-lo). Proves the per-plane transform's axis AND sign, and
        // that [lo, hi] really spans the normal axis (lo offsets along it).
        for (const plane of ["front", "top", "side"] as const) {
            it(`extrudes a ${plane}-plane square into a 40×40 bar spanning [−5, 15] on its normal`, async () => {
                const wasm = await initManifold()
                const lo = -5
                const hi = 15
                const solid = extrudeProfileBetween(wasm, square2D(40), plane, lo, hi)

                const { min, max } = solid.boundingBox()
                const want = expectedBox(square2D(40), plane, lo, hi)
                for (let i = 0; i < 3; i++) {
                    expect(min[i]).toBeCloseTo(want.min[i], 5)
                    expect(max[i]).toBeCloseTo(want.max[i], 5)
                }
                expect(solid.volume()).toBeCloseTo(40 * 40 * (hi - lo), 1)

                solid.delete()
            })
        }

        it("extrudes a clockwise contour into the same solid (winding-agnostic)", async () => {
            const wasm = await initManifold()
            const cw = [...square2D(40)].reverse()
            const solid = extrudeProfileBetween(wasm, cw, "front", 0, 10)
            expect(solid.numTri()).toBeGreaterThan(0)
            expect(solid.volume()).toBeCloseTo(40 * 40 * 10, 1)
            solid.delete()
        })

        it("throws on fewer than 3 points", async () => {
            const wasm = await initManifold()
            expect(() =>
                extrudeProfileBetween(
                    wasm,
                    [
                        [0, 0],
                        [40, 0]
                    ],
                    "front",
                    0,
                    10
                )
            ).toThrow()
        })

        it("throws on a non-positive span (hi ≤ lo)", async () => {
            const wasm = await initManifold()
            expect(() => extrudeProfileBetween(wasm, square2D(40), "front", 0, 0)).toThrow()
            expect(() => extrudeProfileBetween(wasm, square2D(40), "front", 5, 5)).toThrow()
            expect(() => extrudeProfileBetween(wasm, square2D(40), "front", 10, 5)).toThrow()
        })
    })
})

describe("drawingToManifold", () => {
    // THE headline: three 2×2 squares (front/top/side) reconstruct a 2×2×2 cube.
    // Each square is the same 2D [-1,1]² lifted onto its plane, so the three
    // bars are square tubes along z (front), y (top), and x (side); their
    // intersection is the unit-edge-2 cube. Volume 8, and every world axis spans
    // exactly 2 (from -1 to 1, modulo sign convention — assert the span only).
    it("reconstructs a 2×2×2 cube from three 2×2 squares on front + top + side", async () => {
        const wasm = await initManifold()
        const corners = square2D(2, [-1, -1]) // [-1,-1]..[1,1]
        const doc = viewsDoc([
            { plane: "front", corners2D: corners },
            { plane: "top", corners2D: corners },
            { plane: "side", corners2D: corners }
        ])

        const solid = drawingToManifold(wasm, doc)
        expect(solid).not.toBeNull()
        const cube = solid as NonNullable<typeof solid>

        expect(cube.volume()).toBeCloseTo(8, 4)
        const { min, max } = cube.boundingBox()
        for (let i = 0; i < 3; i++) {
            expect(max[i] - min[i]).toBeCloseTo(2, 4)
        }
        cube.delete()
    })

    it("reconstructs a bounded solid from just two views (front + top)", async () => {
        const wasm = await initManifold()
        const corners = square2D(2, [-1, -1])
        const doc = viewsDoc([
            { plane: "front", corners2D: corners },
            { plane: "top", corners2D: corners }
        ])

        const solid = drawingToManifold(wasm, doc)
        expect(solid).not.toBeNull()
        const part = solid as NonNullable<typeof solid>

        // A positive-volume solid that is finite (bounded) on all three axes.
        expect(part.volume()).toBeGreaterThan(0)
        const { min, max } = part.boundingBox()
        for (let i = 0; i < 3; i++) {
            expect(Number.isFinite(min[i])).toBe(true)
            expect(Number.isFinite(max[i])).toBe(true)
            expect(max[i] - min[i]).toBeGreaterThan(0)
        }
        part.delete()
    })

    it("intersects inconsistent views down to the shared overlap (smaller wins)", async () => {
        const wasm = await initManifold()
        // The front and top views SHARE the x axis but disagree on its extent.
        //   front (u,v)=(x,y):  x ∈ [-1, 1] (width 2), y ∈ [-1, 1]
        //   top   (u,v)=(x,-z): x ∈ [-2, 2] (width 4), z ∈ [-1, 1]
        // Front's bar fixes x to [-1,1]; top's bar fixes x to [-2,2]. Their
        // intersection takes the OVERLAP — the smaller, [-1,1] — so the solid's
        // x spans exactly 2 (the larger 4 is trimmed away by the front view).
        const front = square2D(2, [-1, -1]) // x:[-1,1], y:[-1,1]
        const top: Vec2[] = [
            [-2, -1],
            [2, -1],
            [2, 1],
            [-2, 1]
        ] // x:[-2,2], z:[-1,1]
        const doc = viewsDoc([
            { plane: "front", corners2D: front },
            { plane: "top", corners2D: top }
        ])

        const solid = drawingToManifold(wasm, doc)
        expect(solid).not.toBeNull()
        const part = solid as NonNullable<typeof solid>

        const { min, max } = part.boundingBox()
        expect(max[0] - min[0]).toBeCloseTo(2, 4)
        part.delete()
    })

    it("returns null with only one view (a single silhouette cannot bound the solid)", async () => {
        const wasm = await initManifold()
        const doc = viewsDoc([{ plane: "front", corners2D: square2D(40) }])
        expect(drawingToManifold(wasm, doc)).toBeNull()
    })

    it("returns null for a drawing with no closed region (an open polyline)", async () => {
        const wasm = await initManifold()
        const open = addEntity(createDrawing(), {
            id: "open",
            type: "polyline",
            closed: false,
            points: SQUARE_2D.map((q) => unprojectPoint(q, "front"))
        })
        expect(drawingToManifold(wasm, open)).toBeNull()
    })

    it("returns null for an empty drawing", async () => {
        const wasm = await initManifold()
        expect(drawingToManifold(wasm, createDrawing())).toBeNull()
    })
})
