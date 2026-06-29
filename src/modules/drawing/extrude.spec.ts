import { describe, expect, it } from "bun:test"
import { initManifold } from "../../lib/manifold"
import { inferPlane, profileToManifold } from "./extrude"
import { planeNormal, unprojectPoint } from "./project"
import type { Plane, Polyline, Vec2 } from "./types"

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

const squareOnPlane = (plane: Plane): Polyline => ({
    id: "p",
    type: "polyline",
    closed: true,
    points: SQUARE_2D.map((q) => unprojectPoint(q, plane))
})

const DEPTH = 10

// The axis-aligned bounding box the spec REQUIRES the solid to occupy: every
// local point (u, v, w) must land at `unprojectPoint([u,v], plane) + w*normal`.
// We evaluate that contract over the profile corners (in 2D view space) and both
// extrusion caps (w = 0 and w = depth), then take the min/max per world axis.
// Deriving the box this way — rather than hardcoding 0..40 — bakes the per-plane
// sign convention into the expectation, so a mirror or swapped axis fails it.
const expectedBox = (plane: Plane, depth: number): { min: [number, number, number]; max: [number, number, number] } => {
    const n = planeNormal(plane)
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const corner of SQUARE_2D) {
        const base = unprojectPoint(corner, plane)
        for (const w of [0, depth]) {
            for (let i = 0; i < 3; i++) {
                const c = base[i] + w * n[i]
                min[i] = Math.min(min[i], c)
                max[i] = Math.max(max[i], c)
            }
        }
    }
    return { min, max }
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

    context("profileToManifold", () => {
        // For each plane: extruding the lifted square must land a 40×40×10 box
        // exactly where it was drawn — its bounding box must equal the one the
        // unproject+normal contract predicts, and its volume must be 40·40·10.
        // This is the proof the per-plane transform has the right axis and sign
        // (a mirror or swapped axis would shift the box off the profile).
        for (const plane of ["front", "top", "side"] as const) {
            it(`extrudes a ${plane}-plane square into a 40×40×${DEPTH} box on the profile`, async () => {
                const wasm = await initManifold()
                const solid = profileToManifold(wasm, squareOnPlane(plane), plane, DEPTH)

                const { min, max } = solid.boundingBox()
                const want = expectedBox(plane, DEPTH)
                for (let i = 0; i < 3; i++) {
                    expect(min[i]).toBeCloseTo(want.min[i], 5)
                    expect(max[i]).toBeCloseTo(want.max[i], 5)
                }
                expect(solid.volume()).toBeCloseTo(40 * 40 * DEPTH, 1)

                solid.delete()
            })
        }

        it("extrudes a clockwise profile into the same solid (winding-agnostic)", async () => {
            const wasm = await initManifold()
            const cw: Polyline = {
                id: "p",
                type: "polyline",
                closed: true,
                points: [...SQUARE_2D].reverse().map((q) => unprojectPoint(q, "front"))
            }
            const solid = profileToManifold(wasm, cw, "front", DEPTH)
            expect(solid.numTri()).toBeGreaterThan(0)
            expect(solid.volume()).toBeCloseTo(40 * 40 * DEPTH, 1)
            solid.delete()
        })

        it("throws on an open polyline", async () => {
            const wasm = await initManifold()
            const open: Polyline = { ...squareOnPlane("front"), closed: false }
            expect(() => profileToManifold(wasm, open, "front", DEPTH)).toThrow()
        })

        it("throws on fewer than 3 points", async () => {
            const wasm = await initManifold()
            const tooFew: Polyline = {
                id: "p",
                type: "polyline",
                closed: true,
                points: [
                    [0, 0, 0],
                    [40, 0, 0]
                ]
            }
            expect(() => profileToManifold(wasm, tooFew, "front", DEPTH)).toThrow()
        })

        it("throws on a non-positive depth", async () => {
            const wasm = await initManifold()
            const square = squareOnPlane("front")
            expect(() => profileToManifold(wasm, square, "front", 0)).toThrow()
            expect(() => profileToManifold(wasm, square, "front", -5)).toThrow()
        })
    })
})
