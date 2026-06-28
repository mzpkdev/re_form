import { describe, expect, it } from "bun:test"
import { applyEdit, EDIT_TOOLS } from "./edits"
import { initManifold } from "./manifold"

const context = describe

describe("edits", () => {
    context("EDIT_TOOLS", () => {
        it("exposes the v1 op vocabulary as well-formed tool defs", () => {
            const names = EDIT_TOOLS.map((t) => t.function.name)
            expect(names).toEqual([
                "create_primitive",
                "drill_hole",
                "add_primitive",
                "cut_primitive",
                "intersect_primitive",
                "hollow"
            ])
            for (const tool of EDIT_TOOLS) {
                expect(tool.type).toBe("function")
                const params = tool.function.parameters as Record<string, unknown>
                expect(params.type).toBe("object")
                expect(params.additionalProperties).toBe(false)
                expect(Array.isArray(params.required)).toBe(true)
            }
        })
    })

    context("create_primitive", () => {
        it("builds a 20×20×20 cube centred at the origin (volume ≈ 8000)", async () => {
            const wasm = await initManifold()
            const cube = applyEdit(wasm, null, "create_primitive", {
                shape: "cube",
                size_x: 20,
                size_y: 20,
                size_z: 20
            })
            expect(cube.isEmpty()).toBe(false)
            expect(cube.status()).toBe("NoError")
            expect(cube.volume()).toBeCloseTo(8000, 0)
            cube.delete()
        })

        it("ignores source and builds sphere/cylinder primitives", async () => {
            const wasm = await initManifold()
            const sphere = applyEdit(wasm, null, "create_primitive", { shape: "sphere", radius: 5 })
            expect(sphere.status()).toBe("NoError")
            expect(sphere.volume()).toBeGreaterThan(0)
            sphere.delete()

            const cylinder = applyEdit(wasm, null, "create_primitive", { shape: "cylinder", radius: 4, height: 10 })
            expect(cylinder.status()).toBe("NoError")
            expect(cylinder.volume()).toBeGreaterThan(0)
            cylinder.delete()
        })

        it("builds a cone with the frustum volume π/3·h·(r1²+r1·r2+r2²)", async () => {
            const wasm = await initManifold()
            const r1 = 8
            const r2 = 3
            const h = 12
            const cone = applyEdit(wasm, null, "create_primitive", {
                shape: "cone",
                radius_bottom: r1,
                radius_top: r2,
                height: h
            })
            expect(cone.status()).toBe("NoError")
            const expected = (Math.PI / 3) * h * (r1 * r1 + r1 * r2 + r2 * r2)
            expect(cone.volume()).toBeCloseTo(expected, -1)
            cone.delete()
        })

        it("builds a pointed cone when radius_top is 0", async () => {
            const wasm = await initManifold()
            const r1 = 6
            const h = 10
            const cone = applyEdit(wasm, null, "create_primitive", {
                shape: "cone",
                radius_bottom: r1,
                radius_top: 0,
                height: h
            })
            expect(cone.status()).toBe("NoError")
            // A pointed cone's volume is π/3·r²·h.
            expect(cone.volume()).toBeCloseTo((Math.PI / 3) * r1 * r1 * h, -1)
            cone.delete()
        })

        it("builds a tube that is hollow (less volume than a solid cylinder) and as tall as its height", async () => {
            const wasm = await initManifold()
            const outerRadius = 10
            const height = 20
            const tube = applyEdit(wasm, null, "create_primitive", {
                shape: "tube",
                outer_radius: outerRadius,
                wall: 2,
                height
            })
            expect(tube.status()).toBe("NoError")

            const solid = applyEdit(wasm, null, "create_primitive", {
                shape: "cylinder",
                radius: outerRadius,
                height
            })
            expect(tube.volume()).toBeLessThan(solid.volume())

            const box = tube.boundingBox()
            expect(box.max[2] - box.min[2]).toBeCloseTo(height, 5)

            tube.delete()
            solid.delete()
        })

        it("builds a chamfered_box whose bbox matches the base sizes with less volume than the full box", async () => {
            const wasm = await initManifold()
            const sizeX = 20
            const sizeY = 16
            const sizeZ = 12
            const box = applyEdit(wasm, null, "create_primitive", {
                shape: "chamfered_box",
                size_x: sizeX,
                size_y: sizeY,
                size_z: sizeZ,
                chamfer: 3
            })
            expect(box.status()).toBe("NoError")

            const bbox = box.boundingBox()
            expect(bbox.max[0] - bbox.min[0]).toBeCloseTo(sizeX, 5)
            expect(bbox.max[1] - bbox.min[1]).toBeCloseTo(sizeY, 5)
            expect(bbox.max[2] - bbox.min[2]).toBeCloseTo(sizeZ, 5)
            // The tapered top removes material, so volume is below the full box.
            expect(box.volume()).toBeLessThan(sizeX * sizeY * sizeZ)

            box.delete()
        })
    })

    context("hollow", () => {
        it("scoops a cube into a closed shell with less volume, still valid", async () => {
            const wasm = await initManifold()
            const cube = applyEdit(wasm, null, "create_primitive", {
                shape: "cube",
                size_x: 20,
                size_y: 20,
                size_z: 20
            })
            const before = cube.volume()

            const hollowed = applyEdit(wasm, cube, "hollow", { wall: 2 })
            expect(hollowed.status()).toBe("NoError")
            expect(hollowed.isEmpty()).toBe(false)
            expect(hollowed.volume()).toBeGreaterThan(0)
            expect(hollowed.volume()).toBeLessThan(before)

            // Source survives the edit.
            expect(cube.volume()).toBeCloseTo(before, 5)

            hollowed.delete()
            cube.delete()
        })
    })

    context("drill_hole", () => {
        it("subtracts a bore, yielding a valid solid with less volume than the source", async () => {
            const wasm = await initManifold()
            const cube = applyEdit(wasm, null, "create_primitive", {
                shape: "cube",
                size_x: 20,
                size_y: 20,
                size_z: 20
            })
            const before = cube.volume()

            const drilled = applyEdit(wasm, cube, "drill_hole", { radius: 4, depth: 30, axis: "z" })
            expect(drilled.isEmpty()).toBe(false)
            expect(drilled.status()).toBe("NoError")
            expect(drilled.volume()).toBeGreaterThan(0)
            expect(drilled.volume()).toBeLessThan(before)

            // The source must be left intact for the caller — its volume is unchanged.
            expect(cube.volume()).toBeCloseTo(before, 5)

            drilled.delete()
            cube.delete()
        })

        it("drills along each axis", async () => {
            const wasm = await initManifold()
            for (const axis of ["x", "y", "z"] as const) {
                const cube = applyEdit(wasm, null, "create_primitive", {
                    shape: "cube",
                    size_x: 20,
                    size_y: 20,
                    size_z: 20
                })
                const drilled = applyEdit(wasm, cube, "drill_hole", { radius: 3, depth: 30, axis })
                expect(drilled.status()).toBe("NoError")
                expect(drilled.volume()).toBeLessThan(cube.volume())
                drilled.delete()
                cube.delete()
            }
        })
    })

    context("add_primitive / cut_primitive / intersect_primitive", () => {
        it("each returns a valid manifold without deleting the source", async () => {
            const wasm = await initManifold()

            const base = applyEdit(wasm, null, "create_primitive", {
                shape: "cube",
                size_x: 20,
                size_y: 20,
                size_z: 20
            })
            const baseVolume = base.volume()

            const unioned = applyEdit(wasm, base, "add_primitive", { shape: "sphere", radius: 8, x: 10 })
            expect(unioned.status()).toBe("NoError")
            expect(unioned.volume()).toBeGreaterThan(0)
            unioned.delete()

            const cut = applyEdit(wasm, base, "cut_primitive", { shape: "cube", size_x: 6, size_y: 6, size_z: 30 })
            expect(cut.status()).toBe("NoError")
            expect(cut.volume()).toBeGreaterThan(0)
            expect(cut.volume()).toBeLessThan(baseVolume)
            cut.delete()

            const intersected = applyEdit(wasm, base, "intersect_primitive", { shape: "sphere", radius: 12 })
            expect(intersected.status()).toBe("NoError")
            expect(intersected.volume()).toBeGreaterThan(0)
            expect(intersected.volume()).toBeLessThan(baseVolume)
            intersected.delete()

            // Source survived all three ops.
            expect(base.volume()).toBeCloseTo(baseVolume, 5)
            base.delete()
        })
    })

    context("fit / tolerance", () => {
        it("drill_hole with fit='slip' removes more material than no fit (smaller resulting volume)", async () => {
            const wasm = await initManifold()
            const makeCube = () =>
                applyEdit(wasm, null, "create_primitive", { shape: "cube", size_x: 20, size_y: 20, size_z: 20 })

            const cubeA = makeCube()
            const plain = applyEdit(wasm, cubeA, "drill_hole", { radius: 4, depth: 30, axis: "z" })

            const cubeB = makeCube()
            const slip = applyEdit(wasm, cubeB, "drill_hole", { radius: 4, depth: 30, axis: "z", fit: "slip" })

            // A slip hole is bored wider, so more material is gone and less remains.
            expect(slip.volume()).toBeLessThan(plain.volume())

            plain.delete()
            slip.delete()
            cubeA.delete()
            cubeB.delete()
        })

        it("cut_primitive with a fit enlarges the cut (smaller resulting volume than no fit)", async () => {
            const wasm = await initManifold()
            const makeCube = () =>
                applyEdit(wasm, null, "create_primitive", { shape: "cube", size_x: 30, size_y: 30, size_z: 30 })

            const cubeA = makeCube()
            const plain = applyEdit(wasm, cubeA, "cut_primitive", {
                shape: "cube",
                size_x: 10,
                size_y: 10,
                size_z: 40
            })

            const cubeB = makeCube()
            const slip = applyEdit(wasm, cubeB, "cut_primitive", {
                shape: "cube",
                size_x: 10,
                size_y: 10,
                size_z: 40,
                fit: "slip"
            })

            // The fit oversizes the pocket per side, so more is removed and less remains.
            expect(slip.volume()).toBeLessThan(plain.volume())

            plain.delete()
            slip.delete()
            cubeA.delete()
            cubeB.delete()
        })
    })

    context("argument validation", () => {
        it("throws on a negative radius", async () => {
            const wasm = await initManifold()
            expect(() => applyEdit(wasm, null, "create_primitive", { shape: "sphere", radius: -5 })).toThrow()
        })

        it("throws on a NaN size", async () => {
            const wasm = await initManifold()
            expect(() => applyEdit(wasm, null, "create_primitive", { shape: "cube", size_x: Number.NaN })).toThrow()
        })

        it("throws on an unknown shape", async () => {
            const wasm = await initManifold()
            expect(() => applyEdit(wasm, null, "create_primitive", { shape: "pyramid" })).toThrow()
        })

        it("throws on an unknown axis for drill_hole", async () => {
            const wasm = await initManifold()
            const cube = applyEdit(wasm, null, "create_primitive", { shape: "cube" })
            expect(() => applyEdit(wasm, cube, "drill_hole", { radius: 2, depth: 20, axis: "w" })).toThrow()
            cube.delete()
        })

        it("throws the 'no editable solid' message when a geometry op has no source", async () => {
            const wasm = await initManifold()
            expect(() => applyEdit(wasm, null, "drill_hole", { radius: 2, depth: 20, axis: "z" })).toThrow(
                "no editable solid — create a primitive or import an STL first"
            )
            expect(() => applyEdit(wasm, null, "add_primitive", { shape: "cube" })).toThrow(
                "no editable solid — create a primitive or import an STL first"
            )
        })
    })
})
