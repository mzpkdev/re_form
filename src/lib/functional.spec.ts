import { describe, expect, it } from "bun:test"
import { applyEdit } from "./edits"
import { holeForPeg, measureGap, pegForHole } from "./fit"
import { initManifold } from "./manifold"
import { IDENTITY_TRANSFORM, meshToBufferGeometry, transformedGeometry } from "./model"
import { makeShell, makeTube } from "./primitives"
import { checkPrintability } from "./printability"
import { exportStl, stlBounds, verifyStlDimensions } from "./stl"

const context = describe

/**
 * Offline end-to-end functional-part scenarios.
 *
 * Where the per-module specs prove each operation in isolation, these compose
 * the real CSG tools through the real WASM kernel and assert dimension + fit +
 * printability + watertightness TOGETHER — the "does it actually fit and print"
 * proof for a whole part. No network, no React; every Manifold handle is freed.
 */

const wasm = await initManifold()

describe("functional end-to-end", () => {
    context("press-fit plug for a 20 mm-diameter hole", () => {
        it("sizes the plug 0.1 mm under the hole wall, watertight and printable", () => {
            // A 20 mm-diameter hole has radius 10. A press-fit plug is sized DOWN
            // by the press clearance so it interferes lightly when pushed in.
            const pegRadius = pegForHole(10, "press")
            expect(pegRadius).toBeCloseTo(9.9, 5)

            const plug = wasm.Manifold.cylinder(20, pegRadius, pegRadius, 48, true)

            // Reference hole: the WALL around a 20 mm-diameter bore, modelled as a
            // tube whose inner radius is exactly 10. The minimum gap between the
            // concentric plug and that wall is the achieved per-side clearance.
            const holeWall = makeTube(wasm, { outerRadius: 14, wall: 4, height: 24 })
            const gap = measureGap(plug, holeWall)
            // ≈0.1 mm per side (slightly under because the circle is faceted).
            expect(gap).toBeCloseTo(0.1, 2)

            // The plug itself is a sound, printable solid.
            expect(plug.status()).toBe("NoError")
            expect(plug.volume()).toBeGreaterThan(0)
            expect(checkPrintability(wasm, plug).ok).toBe(true)

            plug.delete()
            holeWall.delete()
        })
    })

    context("slip-fit drilled bracket", () => {
        it("bores a 5.4 mm-radius slip hole through a 30×30×10 plate, watertight and printable", () => {
            const plate = applyEdit(wasm, null, "create_primitive", {
                shape: "cube",
                size_x: 30,
                size_y: 30,
                size_z: 10
            })
            const solidVolume = plate.volume()

            // Nominal radius 5 with a slip fit ⇒ the bore is opened up to 5.4.
            const boreRadius = holeForPeg(5, "slip")
            expect(boreRadius).toBeCloseTo(5.4, 5)

            const drilled = applyEdit(wasm, plate, "drill_hole", {
                radius: 5,
                depth: 20,
                axis: "z",
                fit: "slip"
            })

            // The removed material is the annulus of the drilled bore: a 5.4 mm
            // radius cylinder spanning the 10 mm plate thickness.
            const removed = solidVolume - drilled.volume()
            const expectedAnnulus = Math.PI * boreRadius * boreRadius * 10
            expect(removed).toBeCloseTo(expectedAnnulus, -1)

            // The bore reflects the slip clearance, not the nominal radius.
            const plainPlate = applyEdit(wasm, null, "create_primitive", {
                shape: "cube",
                size_x: 30,
                size_y: 30,
                size_z: 10
            })
            const plainDrilled = applyEdit(wasm, plainPlate, "drill_hole", { radius: 5, depth: 20, axis: "z" })
            // A slip bore is wider than the exact-size bore, so less material remains.
            expect(drilled.volume()).toBeLessThan(plainDrilled.volume())

            expect(drilled.status()).toBe("NoError")
            expect(drilled.isEmpty()).toBe(false)
            expect(checkPrintability(wasm, drilled).ok).toBe(true)

            plate.delete()
            drilled.delete()
            plainPlate.delete()
            plainDrilled.delete()
        })
    })

    context("hollow shell", () => {
        it("scoops a cube into a closed 2 mm shell with less volume, watertight", () => {
            const cube = wasm.Manifold.cube([24, 24, 24], true)
            const solidVolume = cube.volume()

            const shell = makeShell(wasm, { solid: cube, wall: 2 })

            // A makeShell result is a single, watertight Manifold (NoError, positive volume).
            expect(shell.status()).toBe("NoError")
            expect(shell.isEmpty()).toBe(false)
            expect(shell.volume()).toBeGreaterThan(0)
            // Hollowing removes the core, so the shell holds far less material.
            expect(shell.volume()).toBeLessThan(solidVolume)

            // A CLOSED shell has two boundary surfaces (outer skin + inner cavity
            // wall), so decompose() reports 2 pieces — but it is ONE connected
            // solid, not two disjoint ones. The gate tells them apart via a
            // bbox nest test: the inner cavity nests inside the skin, so this is
            // an `enclosed_void` WARNING (it still prints — it just risks trapping
            // support/powder), and the part stays ok. It is NOT `disconnected`.
            const report = checkPrintability(wasm, shell)
            expect(report.ok).toBe(true)
            expect(report.issues.find((issue) => issue.code === "enclosed_void")?.level).toBe("warning")
            expect(report.issues.some((issue) => issue.code === "disconnected")).toBe(false)
            // Still watertight: a sealed shell is a sound, manifold solid.
            expect(shell.status()).toBe("NoError")

            // The source cube is left intact for the caller.
            expect(cube.volume()).toBeCloseTo(solidVolume, 5)

            cube.delete()
            shell.delete()
        })
    })

    context("export integrity", () => {
        it("round-trips a built part through STL with its intended dimensions intact", () => {
            const part = applyEdit(wasm, null, "create_primitive", {
                shape: "cube",
                size_x: 18,
                size_y: 12,
                size_z: 6
            })
            const box = part.boundingBox()
            const intended = {
                x: box.max[0] - box.min[0],
                y: box.max[1] - box.min[1],
                z: box.max[2] - box.min[2]
            }

            // Bake the identity transform into geometry exactly as the export path does.
            const geometry = transformedGeometry(part, IDENTITY_TRANSFORM)
            const buffer = exportStl(geometry)

            // The bytes on disk encode the intended size…
            expect(verifyStlDimensions(buffer, intended)).toBe(true)
            // …and re-parsing them matches the manifold's own bounds.
            const bounds = stlBounds(buffer)
            expect(bounds.x).toBeCloseTo(intended.x, 2)
            expect(bounds.y).toBeCloseTo(intended.y, 2)
            expect(bounds.z).toBeCloseTo(intended.z, 2)

            geometry.dispose()
            part.delete()
        })

        it("also exports a manifold via meshToBufferGeometry with matching bounds", () => {
            const part = wasm.Manifold.cylinder(20, 10, 10, 48, true)
            const box = part.boundingBox()
            const intended = {
                x: box.max[0] - box.min[0],
                y: box.max[1] - box.min[1],
                z: box.max[2] - box.min[2]
            }

            const geometry = meshToBufferGeometry(part.getMesh())
            const buffer = exportStl(geometry)

            expect(verifyStlDimensions(buffer, intended, 0.05)).toBe(true)
            const bounds = stlBounds(buffer)
            expect(bounds.x).toBeCloseTo(intended.x, 1)
            expect(bounds.y).toBeCloseTo(intended.y, 1)
            expect(bounds.z).toBeCloseTo(intended.z, 1)

            geometry.dispose()
            part.delete()
        })
    })

    context("printability gate catches bad geometry", () => {
        it("warns (but does not error) on a 0.2 mm-thin plate", () => {
            const plate = wasm.Manifold.cube([20, 20, 0.2], true)
            const report = checkPrintability(wasm, plate)
            plate.delete()

            const codes = report.issues.map((issue) => issue.code)
            expect(codes.includes("min_feature") || codes.includes("thin_wall")).toBe(true)
            // The plate is structurally sound, so these are warnings — still ok.
            expect(report.issues.some((issue) => issue.level === "error")).toBe(false)
            expect(report.ok).toBe(true)
        })

        it("errors with `disconnected` on two disjoint solids unioned", () => {
            const a = wasm.Manifold.cube([10, 10, 10], true)
            const b = wasm.Manifold.cube([10, 10, 10], true).translate([100, 0, 0])
            const joined = wasm.Manifold.union(a, b)
            a.delete()
            b.delete()

            const report = checkPrintability(wasm, joined)
            joined.delete()

            expect(report.ok).toBe(false)
            const disconnected = report.issues.find((issue) => issue.code === "disconnected")
            expect(disconnected?.level).toBe("error")
        })
    })
})
