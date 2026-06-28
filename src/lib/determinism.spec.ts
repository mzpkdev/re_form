import { describe, expect, it } from "bun:test"
import type { Manifold } from "manifold-3d"
import { applyEdit } from "./edits"
import { initManifold } from "./manifold"

const context = describe

/**
 * A compact, comparable fingerprint of a solid's geometry: enclosed volume,
 * triangle count, and axis-aligned bounding-box corners. Two builds of the same
 * model from the same params must produce identical fingerprints — that is the
 * determinism guarantee these tests defend.
 */
const fingerprint = (m: Manifold) => {
    const box = m.boundingBox()
    return {
        volume: m.volume(),
        numTri: m.numTri(),
        min: [...box.min] as [number, number, number],
        max: [...box.max] as [number, number, number]
    }
}

/** Assert two fingerprints are identical: volume to high precision, the rest exact. */
const expectSameGeometry = (a: ReturnType<typeof fingerprint>, b: ReturnType<typeof fingerprint>) => {
    expect(a.volume).toBeCloseTo(b.volume, 10)
    expect(a.numTri).toBe(b.numTri)
    expect(a.min[0]).toBeCloseTo(b.min[0], 10)
    expect(a.min[1]).toBeCloseTo(b.min[1], 10)
    expect(a.min[2]).toBeCloseTo(b.min[2], 10)
    expect(a.max[0]).toBeCloseTo(b.max[0], 10)
    expect(a.max[1]).toBeCloseTo(b.max[1], 10)
    expect(a.max[2]).toBeCloseTo(b.max[2], 10)
}

describe("determinism", () => {
    context("same params produce the same geometry", () => {
        it("a drilled cylinder is byte-for-byte reproducible (volume, numTri, bbox)", async () => {
            const wasm = await initManifold()

            const build = () => {
                const cylinder = applyEdit(wasm, null, "create_primitive", {
                    shape: "cylinder",
                    radius: 8,
                    height: 20
                })
                const drilled = applyEdit(wasm, cylinder, "drill_hole", { radius: 3, depth: 30, axis: "z" })
                cylinder.delete()
                return drilled
            }

            const first = build()
            const second = build()

            expectSameGeometry(fingerprint(first), fingerprint(second))

            first.delete()
            second.delete()
        })

        it("a cone with a fit drill_hole is reproducible across two builds", async () => {
            const wasm = await initManifold()

            const build = () => {
                const cone = applyEdit(wasm, null, "create_primitive", {
                    shape: "cone",
                    radius_bottom: 10,
                    radius_top: 4,
                    height: 16
                })
                const drilled = applyEdit(wasm, cone, "drill_hole", {
                    radius: 3,
                    depth: 30,
                    axis: "z",
                    fit: "slip"
                })
                cone.delete()
                return drilled
            }

            const first = build()
            const second = build()

            expectSameGeometry(fingerprint(first), fingerprint(second))

            first.delete()
            second.delete()
        })
    })
})
