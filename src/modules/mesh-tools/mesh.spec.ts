import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Manifold } from "manifold-3d"
import { initManifold } from "../../lib/manifold"
import { geometryToManifold, meshToBufferGeometry } from "../../lib/model"
import { exportStl, parseStl } from "../../lib/stl"
import { isValidSolid } from "../../lib/validate"
import { adaptiveRefine, simplify, smooth, VARY_MAX_AMPLITUDE, vary } from "./mesh"

const context = describe

/** Flat xyz array of every vertex position in the manifold (via its mesh). */
const vertexPositions = (manifold: Manifold): Float32Array => {
    const mesh = manifold.getMesh()
    const stride = mesh.numProp
    const out = new Float32Array(mesh.numVert * 3)
    for (let i = 0; i < mesh.numVert; i++) {
        out[i * 3 + 0] = mesh.vertProperties[i * stride + 0]
        out[i * 3 + 1] = mesh.vertProperties[i * stride + 1]
        out[i * 3 + 2] = mesh.vertProperties[i * stride + 2]
    }
    return out
}

/**
 * Load the real `Little_Opossum.stl` fixture (230k tris, organic/curved) through
 * the exact import path the panel uses, so these ops are exercised against a
 * detailed model rather than a primitive. Caller owns the returned handle.
 */
const FIXTURE = resolve(import.meta.dir, "../../../__fixtures__/Little_Opossum.stl")
// The fixture is a large binary kept out of git (see .gitignore), so it only
// exists locally. Skip the fixture-backed cases when it is absent (e.g. CI)
// instead of crashing on ENOENT; they still run wherever the file is present.
const hasFixture = existsSync(FIXTURE)
if (!hasFixture) {
    console.warn(`[mesh.spec] fixture absent — skipping fixture-backed tests: ${FIXTURE}`)
}
const loadFixture = (wasm: Awaited<ReturnType<typeof initManifold>>): Manifold => {
    const buf = readFileSync(FIXTURE)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const geometry = parseStl(ab as ArrayBuffer)
    const manifold = geometryToManifold(wasm, geometry)
    geometry.dispose()
    return manifold
}

const MAX_TRIANGLES = 2_000_000

describe("mesh", () => {
    context("simplify", () => {
        it("reduces the triangle count of a refined solid", async () => {
            const wasm = await initManifold()
            // Refine a cube so there are interior verts/triangles to collapse;
            // a raw cube is already minimal and nothing could be removed.
            const cube = wasm.Manifold.cube([10, 10, 10], true)
            const dense = cube.refine(8)
            const before = dense.numTri()

            // Tolerance well above the (zero) curvature of the flat faces, so the
            // refinement triangles collapse back toward the original cube.
            const simplified = simplify(dense, 1)
            const after = simplified.numTri()

            expect(before).toBeGreaterThan(12)
            expect(after).toBeLessThan(before)
            // The shape survives: still a closed, non-empty solid ~ the cube volume.
            expect(simplified.isEmpty()).toBe(false)
            expect(simplified.volume()).toBeCloseTo(1000, 0)

            cube.delete()
            dense.delete()
            simplified.delete()
        })

        // The panel labels Tolerance as a deviation budget (not a "more = fewer
        // triangles" slider) precisely because the relationship is NOT monotonic
        // on a curved model: past a sweet spot, a larger tolerance re-triangulates
        // collapsed regions and the count rises again. This guards the honest
        // labeling against a future "invert/relabel as reduction %" regression.
        it.skipIf(!hasFixture)(
            "tolerance is a deviation budget, not a monotonic reduction knob (fixture)",
            async () => {
                const wasm = await initManifold()
                const src = loadFixture(wasm)

                const at = (tol: number): number => {
                    const r = simplify(src, tol)
                    const tris = r.numTri()
                    expect(isValidSolid(r)).toBe(true)
                    r.delete()
                    return tris
                }
                const small = at(0.05)
                const large = at(1.0)
                // A larger tolerance yields MORE triangles here — the opposite of what a
                // naive "higher = more reduction" reading expects, hence the honest label.
                expect(large).toBeGreaterThan(small)

                src.delete()
            },
            30000
        )
    })

    context("smooth", () => {
        it("refines the mesh and moves vertices off the original surface", async () => {
            const wasm = await initManifold()
            // A low-poly sphere has curvature for smoothing to act on.
            const sphere = wasm.Manifold.sphere(5, 16)
            const before = sphere.numTri()
            const beforeVolume = sphere.volume()

            const smoothed = smooth(sphere, { minSharpAngle: 180, refine: 3 })

            // refine(n) splits each edge into n pieces -> more triangles.
            expect(smoothed.numTri()).toBeGreaterThan(before)
            // Smoothing inflates the faceted sphere toward its true curve, so the
            // volume grows measurably (tangents actually moved the new verts).
            expect(smoothed.volume()).toBeGreaterThan(beforeVolume)
            expect(smoothed.isEmpty()).toBe(false)

            sphere.delete()
            smoothed.delete()
        })

        // Regression: at the adaptive default refine, Smooth must stay within the
        // triangle budget on a detailed model (so it is not auto-disabled) and
        // still produce a valid solid.
        it.skipIf(!hasFixture)(
            "at the adaptive default refine stays within the triangle budget (fixture)",
            async () => {
                const wasm = await initManifold()
                const src = loadFixture(wasm)
                const factor = adaptiveRefine(src.numTri(), MAX_TRIANGLES)

                const smoothed = smooth(src, { refine: factor })
                expect(smoothed.numTri()).toBeLessThanOrEqual(MAX_TRIANGLES)
                expect(isValidSolid(smoothed)).toBe(true)

                src.delete()
                smoothed.delete()
            },
            30000
        )
    })

    context("adaptiveRefine", () => {
        it("picks the largest in-budget edge-split factor, clamped to [2, 4]", () => {
            // sqrt(2_000_000 / 230_376) ≈ 2.95 -> floor 2: the fixture's default.
            expect(adaptiveRefine(230_376, MAX_TRIANGLES)).toBe(2)
            // sqrt(2_000_000 / 200_000) ≈ 3.16 -> 3 (200k×9 = 1.8M fits).
            expect(adaptiveRefine(200_000, MAX_TRIANGLES)).toBe(3)
            // Tiny model: factor capped at the ceiling rather than exploding.
            expect(adaptiveRefine(1_000, MAX_TRIANGLES)).toBe(4)
            // Very dense input: floored at 2 (refine(1) is a no-op); the caller
            // is responsible for gating when even 2 exceeds the budget.
            expect(adaptiveRefine(1_000_000, MAX_TRIANGLES)).toBe(2)
        })
    })

    context("vary", () => {
        it("deforms the shape: bounding box and vertices differ from the original", async () => {
            const wasm = await initManifold()
            const cube = wasm.Manifold.cube([10, 10, 10], true)
            const originalBox = cube.boundingBox()

            const varied = vary(cube, { amplitude: 0.1, seed: 1, resolution: 4 })
            const variedBox = varied.boundingBox()

            // A genuine shape change shifts the bounding box off the original.
            const boxMoved =
                Math.abs(variedBox.min[0] - originalBox.min[0]) > 1e-3 ||
                Math.abs(variedBox.min[1] - originalBox.min[1]) > 1e-3 ||
                Math.abs(variedBox.min[2] - originalBox.min[2]) > 1e-3 ||
                Math.abs(variedBox.max[0] - originalBox.max[0]) > 1e-3 ||
                Math.abs(variedBox.max[1] - originalBox.max[1]) > 1e-3 ||
                Math.abs(variedBox.max[2] - originalBox.max[2]) > 1e-3
            expect(boxMoved).toBe(true)
            expect(varied.isEmpty()).toBe(false)

            cube.delete()
            varied.delete()
        })

        it("is deterministic: the same seed yields identical vertices", async () => {
            const wasm = await initManifold()
            const cube = wasm.Manifold.cube([10, 10, 10], true)

            const a = vary(cube, { amplitude: 0.1, seed: 42, resolution: 4 })
            const b = vary(cube, { amplitude: 0.1, seed: 42, resolution: 4 })

            const va = vertexPositions(a)
            const vb = vertexPositions(b)
            expect(va.length).toBe(vb.length)
            let maxDelta = 0
            for (let i = 0; i < va.length; i++) {
                maxDelta = Math.max(maxDelta, Math.abs(va[i] - vb[i]))
            }
            expect(maxDelta).toBe(0)

            cube.delete()
            a.delete()
            b.delete()
        })

        it("differs between seeds", async () => {
            const wasm = await initManifold()
            const cube = wasm.Manifold.cube([10, 10, 10], true)

            const a = vary(cube, { amplitude: 0.1, seed: 1, resolution: 4 })
            const b = vary(cube, { amplitude: 0.1, seed: 2, resolution: 4 })

            const va = vertexPositions(a)
            const vb = vertexPositions(b)
            let maxDelta = 0
            for (let i = 0; i < Math.min(va.length, vb.length); i++) {
                maxDelta = Math.max(maxDelta, Math.abs(va[i] - vb[i]))
            }
            expect(maxDelta).toBeGreaterThan(1e-3)

            cube.delete()
            a.delete()
            b.delete()
        })

        // Core regression for Defect 1: at the panel's enforced ceiling the warp
        // must stay a VALID solid on the real fixture — across several seeds,
        // since the panel reseeds randomly on every click. If a future change
        // raises VARY_MAX_AMPLITUDE back into the self-intersecting range this
        // fails. The displacement scales with the bbox diagonal, so the cap is the
        // worst case the panel can request.
        it.skipIf(!hasFixture)(
            "stays a valid solid at VARY_MAX_AMPLITUDE across seeds (fixture)",
            async () => {
                const wasm = await initManifold()
                const src = loadFixture(wasm)
                const factor = adaptiveRefine(src.numTri(), MAX_TRIANGLES)

                for (const seed of [1, 7, 42, 123, 9999]) {
                    const r = vary(src, { amplitude: VARY_MAX_AMPLITUDE, seed, resolution: factor })
                    expect(isValidSolid(r)).toBe(true)
                    // And it survives the panel/export re-bake round-trip.
                    const geo = meshToBufferGeometry(r.getMesh())
                    const rebaked = geometryToManifold(wasm, geo)
                    expect(isValidSolid(rebaked)).toBe(true)
                    expect(() => exportStl(geo)).not.toThrow()
                    rebaked.delete()
                    geo.dispose()
                    r.delete()
                }

                src.delete()
            },
            60000
        )

        // Backstop for Defect 1: even within the cap, `warp` can't detect
        // self-intersection, so a pathological shape/seed can still fold. The op
        // must throw a clear error (and not leak the bad handle) rather than
        // return a broken, non-exportable solid. A thin plate at the cap folds
        // through itself for seed 1, which `isValidSolid` rejects.
        it("throws (not returns) when the warp self-intersects", async () => {
            const wasm = await initManifold()
            const plate = wasm.Manifold.cube([10, 10, 0.1], true)

            expect(() => vary(plate, { amplitude: VARY_MAX_AMPLITUDE, seed: 1, resolution: 2 })).toThrow(
                /self-intersect/i
            )

            plate.delete()
        })
    })
})
