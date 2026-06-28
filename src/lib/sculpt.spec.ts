import { describe, expect, it } from "bun:test"
import { initManifold } from "./manifold"
import { buildSculpt, compileScene, SCULPT_TOOL, type SculptScene } from "./sculpt"

const context = describe

const wasm = await initManifold()

const SPHERE_R10_VOLUME = (4 / 3) * Math.PI * 10 ** 3 // ≈ 4188.79

describe("compileScene", () => {
    context("a single sphere", () => {
        it("encloses the sphere with margin and keeps the conventional sign", () => {
            const { sdf, bounds } = compileScene({ parts: [{ shape: "sphere", radius: 10 }], smoothness: 0 })

            // bounds enclose [-10,10]^3 plus margin (>= 2), and not absurdly large.
            for (const axis of [0, 1, 2]) {
                expect(bounds.min[axis]).toBeLessThanOrEqual(-12)
                expect(bounds.max[axis]).toBeGreaterThanOrEqual(12)
                expect(bounds.min[axis]).toBeGreaterThan(-30)
                expect(bounds.max[axis]).toBeLessThan(30)
            }

            // Negative inside, positive outside (conventional).
            expect(sdf([0, 0, 0])).toBeLessThan(0)
            expect(sdf([100, 0, 0])).toBeGreaterThan(0)
        })
    })
})

describe("buildSculpt", () => {
    context("a single sphere", () => {
        it("produces a valid manifold whose volume matches the analytic sphere", () => {
            const solid = buildSculpt(wasm, { parts: [{ shape: "sphere", radius: 10 }], smoothness: 0 })
            try {
                expect(solid.isEmpty()).toBe(false)
                expect(solid.status()).toBe("NoError")
                expect(solid.volume()).toBeCloseTo(SPHERE_R10_VOLUME, -2)
                // tighter: within ±8%
                expect(Math.abs(solid.volume() - SPHERE_R10_VOLUME) / SPHERE_R10_VOLUME).toBeLessThan(0.08)
            } finally {
                solid.delete()
            }
        })
    })

    context("two overlapping spheres with smoothness", () => {
        it("blends into a solid between one sphere and two disjoint spheres", () => {
            const scene: SculptScene = {
                parts: [
                    { shape: "sphere", radius: 10, position: [0, 0, 0] },
                    { shape: "sphere", radius: 10, position: [12, 0, 0] }
                ],
                smoothness: 3
            }
            const solid = buildSculpt(wasm, scene)
            try {
                expect(solid.isEmpty()).toBe(false)
                expect(solid.status()).toBe("NoError")
                const v = solid.volume()
                expect(v).toBeGreaterThan(SPHERE_R10_VOLUME)
                expect(v).toBeLessThan(2 * SPHERE_R10_VOLUME)
            } finally {
                solid.delete()
            }
        })
    })

    context("a mini multi-part creature", () => {
        it("produces a non-empty manifold and bounds enclose every part", () => {
            const scene: SculptScene = {
                parts: [
                    { shape: "ellipsoid", radii: [12, 8, 8], position: [0, 0, 0] },
                    { shape: "sphere", radius: 5, position: [15, 1, 0] },
                    { shape: "capsule", a: [-12, 0, 0], b: [-24, 3, 4], radius: 1.5 }
                ],
                smoothness: 2
            }

            const { bounds } = compileScene(scene)
            // The head at x=15 (+5) and the tail tip near x=-24 must be inside the bounds.
            expect(bounds.max[0]).toBeGreaterThan(20)
            expect(bounds.min[0]).toBeLessThan(-25)

            const solid = buildSculpt(wasm, scene)
            try {
                expect(solid.isEmpty()).toBe(false)
                expect(solid.status()).toBe("NoError")
                expect(solid.volume()).toBeGreaterThan(0)
            } finally {
                solid.delete()
            }
        })
    })

    context("invalid scenes", () => {
        it("throws on empty parts", () => {
            expect(() => buildSculpt(wasm, { parts: [] })).toThrow()
        })

        it("throws on a negative radius", () => {
            expect(() => buildSculpt(wasm, { parts: [{ shape: "sphere", radius: -5 }] })).toThrow()
        })

        it("throws on a NaN in a position", () => {
            expect(() =>
                buildSculpt(wasm, { parts: [{ shape: "sphere", radius: 5, position: [Number.NaN, 0, 0] }] })
            ).toThrow()
        })
    })
})

describe("SCULPT_TOOL", () => {
    it("is a function tool named sculpt with an object schema exposing parts", () => {
        expect(SCULPT_TOOL.type).toBe("function")
        expect(SCULPT_TOOL.function.name).toBe("sculpt")
        const parameters = SCULPT_TOOL.function.parameters as {
            type: string
            required: string[]
            properties: Record<string, unknown>
        }
        expect(parameters.type).toBe("object")
        expect(parameters.required).toContain("parts")
        expect(parameters.properties.parts).toBeDefined()
    })
})
