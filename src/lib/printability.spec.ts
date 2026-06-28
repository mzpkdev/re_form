import { describe, expect, it } from "bun:test"
import { initManifold } from "./manifold"
import { makeShell } from "./primitives"
import { checkPrintability } from "./printability"

const context = describe

const wasm = await initManifold()

describe("checkPrintability", () => {
    context("with a clean 20mm cube", () => {
        it("reports ok with no error-level issues and the expected measurements", () => {
            const cube = wasm.Manifold.cube([20, 20, 20], true)
            const report = checkPrintability(wasm, cube)
            cube.delete()

            expect(report.ok).toBe(true)
            expect(report.issues.some((issue) => issue.level === "error")).toBe(false)
            expect(report.dimensions.x).toBeCloseTo(20, 5)
            expect(report.dimensions.y).toBeCloseTo(20, 5)
            expect(report.dimensions.z).toBeCloseTo(20, 5)
            expect(report.volume).toBeCloseTo(8000, 1)
        })
    })

    context("with two non-overlapping cubes unioned", () => {
        it("flags a disconnected error and is not ok", () => {
            const a = wasm.Manifold.cube([10, 10, 10], true)
            const b = wasm.Manifold.cube([10, 10, 10], true).translate(100, 0, 0)
            const joined = wasm.Manifold.union(a, b)
            a.delete()
            b.delete()

            const report = checkPrintability(wasm, joined)
            joined.delete()

            expect(report.ok).toBe(false)
            const disconnected = report.issues.find((issue) => issue.code === "disconnected")
            expect(disconnected?.level).toBe("error")
            expect(disconnected?.message).toContain("2")
        })
    })

    context("with a closed hollow shell (one solid enclosing a sealed void)", () => {
        it("warns about an enclosed void but stays ok (it still prints)", () => {
            // A makeShell result is ONE connected solid wrapping a sealed cavity.
            // decompose() reports 2 pieces (outer skin + void boundary), but the
            // void boundary's bbox nests inside the skin's, so it is an
            // `enclosed_void` warning — NOT a `disconnected` error.
            const cube = wasm.Manifold.cube([24, 24, 24], true)
            const shell = makeShell(wasm, { solid: cube, wall: 2 })
            cube.delete()

            const report = checkPrintability(wasm, shell)
            shell.delete()

            const enclosedVoid = report.issues.find((issue) => issue.code === "enclosed_void")
            expect(enclosedVoid?.level).toBe("warning")
            // A sealed shell is not "disconnected" — it is one connected piece.
            expect(report.issues.some((issue) => issue.code === "disconnected")).toBe(false)
            // The warning leaves the part printable.
            expect(report.ok).toBe(true)
        })
    })

    context("with a 0.2mm-thin plate", () => {
        it("warns about a sub-minimum feature and/or thin wall", () => {
            const plate = wasm.Manifold.cube([20, 20, 0.2], true)
            const report = checkPrintability(wasm, plate)
            plate.delete()

            const codes = report.issues.map((issue) => issue.code)
            expect(codes.includes("min_feature") || codes.includes("thin_wall")).toBe(true)
            // Geometry is structurally valid, so these are warnings, not errors.
            expect(report.issues.some((issue) => issue.level === "error")).toBe(false)
        })
    })

    context("with a 500mm cube", () => {
        it("warns that it exceeds the build volume", () => {
            const cube = wasm.Manifold.cube([500, 500, 500], true)
            const report = checkPrintability(wasm, cube)
            cube.delete()

            const oversized = report.issues.find((issue) => issue.code === "exceeds_build_volume")
            expect(oversized?.level).toBe("warning")
        })
    })

    context("with an empty geometry", () => {
        it("flags an empty error, zeroes the measurements, and is not ok", () => {
            // Intersecting two disjoint cubes yields an empty (degenerate) handle.
            const a = wasm.Manifold.cube([10, 10, 10], true)
            const b = wasm.Manifold.cube([10, 10, 10], true).translate(100, 0, 0)
            const empty = wasm.Manifold.intersection(a, b)
            a.delete()
            b.delete()

            const report = checkPrintability(wasm, empty)
            empty.delete()

            expect(report.ok).toBe(false)
            expect(report.issues.some((issue) => issue.code === "empty")).toBe(true)
            expect(report.dimensions).toEqual({ x: 0, y: 0, z: 0 })
            expect(report.volume).toBe(0)
        })
    })
})
