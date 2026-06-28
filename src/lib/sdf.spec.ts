import { describe, expect, it } from "bun:test"
import {
    box,
    capsule,
    cylinder,
    ellipsoid,
    intersect,
    rotated,
    roundBox,
    scaled,
    smoothSubtract,
    smoothUnion,
    sphere,
    subtract,
    translated,
    union
} from "./sdf"

const context = describe

// loose because some SDFs (ellipsoid) are approximate and floating point creeps
const close = (actual: number, expected: number, tol = 1e-6): void => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol)
}

describe("sdf primitives", () => {
    context("sphere", () => {
        const s = sphere(5)
        it("is negative at the center", () => {
            expect(s([0, 0, 0])).toBeLessThan(0)
            close(s([0, 0, 0]), -5)
        })
        it("is ~0 on the surface", () => {
            close(s([5, 0, 0]), 0)
            close(s([0, 5, 0]), 0)
            close(s([0, 0, 5]), 0)
        })
        it("is positive and equals the gap well outside", () => {
            expect(s([10, 0, 0])).toBeGreaterThan(0)
            close(s([10, 0, 0]), 5)
        })
    })

    context("ellipsoid", () => {
        const e = ellipsoid([4, 2, 1])
        it("is negative inside", () => {
            expect(e([0, 0, 0])).toBeLessThan(0)
        })
        it("is ~0 on the surface along each axis (loose, it is approximate)", () => {
            expect(Math.abs(e([4, 0, 0]))).toBeLessThan(0.5)
            expect(Math.abs(e([0, 2, 0]))).toBeLessThan(0.5)
            expect(Math.abs(e([0, 0, 1]))).toBeLessThan(0.5)
        })
        it("is positive well outside", () => {
            expect(e([20, 0, 0])).toBeGreaterThan(0)
        })
    })

    context("box", () => {
        const b = box([2, 3, 4])
        it("is negative inside", () => {
            expect(b([0, 0, 0])).toBeLessThan(0)
        })
        it("is ~0 on a face", () => {
            close(b([2, 0, 0]), 0)
            close(b([0, 3, 0]), 0)
        })
        it("is the exact euclidean distance outside a face", () => {
            close(b([5, 0, 0]), 3)
        })
        it("is the exact distance at a point beyond a corner", () => {
            // corner at (2,3,4); query 3 away diagonally on each axis from the corner
            close(b([5, 6, 7]), Math.sqrt(3 * 3 + 3 * 3 + 3 * 3))
        })
    })

    context("roundBox", () => {
        const rb = roundBox([3, 3, 3], 1)
        it("is negative inside", () => {
            expect(rb([0, 0, 0])).toBeLessThan(0)
        })
        it("reaches the surface at the rounded half-extent on a face", () => {
            close(rb([3, 0, 0]), 0)
        })
        it("carves the corner: at the sharp corner it reads outside while a sharp box reads ~0", () => {
            // rounding removes material at corners, so the rounded surface sits inside
            // the sharp corner — the SDF there is positive (outside) while a sharp box is 0.
            const sharp = box([3, 3, 3])
            close(sharp([3, 3, 3]), 0)
            expect(rb([3, 3, 3])).toBeGreaterThan(0)
        })
        it("is the exact distance to the rounded corner past a face axis", () => {
            // inner box half-extent is 2; query 3 past the inner corner on each axis,
            // distance to the rounded surface = length(diag) - radius
            const diag = Math.sqrt(3 * 3 + 3 * 3 + 3 * 3)
            close(rb([5, 5, 5]), diag - 1)
        })
    })

    context("capsule", () => {
        // segment along X from (-3,0,0) to (3,0,0), radius 1
        const c = capsule([-3, 0, 0], [3, 0, 0], 1)
        it("is negative on the axis inside the segment", () => {
            expect(c([0, 0, 0])).toBeLessThan(0)
            close(c([0, 0, 0]), -1)
        })
        it("is ~0 on the tube surface", () => {
            close(c([0, 1, 0]), 0)
        })
        it("gives the correct distance off the segment side", () => {
            // 3 units off the axis, radius 1 → distance 2
            close(c([0, 3, 0]), 2)
        })
        it("caps the ends: distance measured from the nearest endpoint", () => {
            // beyond the (3,0,0) cap by 2 along X → distance 2 - radius = 1
            close(c([5, 0, 0]), 1)
        })
    })

    context("cylinder", () => {
        // height 6 (y in [-3,3]), radius 2, axis +Y
        const cy = cylinder(6, 2)
        it("is negative inside", () => {
            expect(cy([0, 0, 0])).toBeLessThan(0)
        })
        it("is ~0 on the round wall", () => {
            close(cy([2, 0, 0]), 0)
        })
        it("is ~0 on the flat cap", () => {
            close(cy([0, 3, 0]), 0)
        })
        it("is the radial distance outside the wall", () => {
            close(cy([5, 0, 0]), 3)
        })
        it("is the axial distance beyond the cap", () => {
            close(cy([0, 5, 0]), 2)
        })
    })
})

describe("sdf boolean ops", () => {
    const a = sphere(2)
    const b = translated(sphere(2), [3, 0, 0])

    context("union", () => {
        it("is the min of its operands", () => {
            const u = union(a, b)
            const p: [number, number, number] = [1.5, 0.5, 0]
            close(u(p), Math.min(a(p), b(p)))
        })
    })

    context("intersect", () => {
        it("is the max of its operands", () => {
            const i = intersect(a, b)
            const p: [number, number, number] = [1.5, 0.5, 0]
            close(i(p), Math.max(a(p), b(p)))
        })
    })

    context("subtract", () => {
        it("is max(a, -b)", () => {
            const s = subtract(a, b)
            const p: [number, number, number] = [1.5, 0.5, 0]
            close(s(p), Math.max(a(p), -b(p)))
        })
    })

    context("smoothUnion", () => {
        const k = 0.5
        it("is <= the hard union near the seam", () => {
            const hard = union(a, b)
            const smooth = smoothUnion(k, a, b)
            // sample along the bridge between the two spheres
            for (const x of [1.2, 1.5, 1.8]) {
                const p: [number, number, number] = [x, 0, 0]
                expect(smooth(p)).toBeLessThanOrEqual(hard(p) + 1e-9)
            }
        })
        it("equals the hard union when the shapes are far apart", () => {
            const far = translated(sphere(2), [100, 0, 0])
            const hard = union(a, far)
            const smooth = smoothUnion(k, a, far)
            const p: [number, number, number] = [0, 0, 0]
            close(smooth(p), hard(p), 1e-6)
        })
        it("behaves like union when k <= 0", () => {
            const hard = union(a, b)
            const smooth = smoothUnion(0, a, b)
            const p: [number, number, number] = [1.5, 0.5, 0]
            close(smooth(p), hard(p))
        })
        it("is continuous across the seam", () => {
            const smooth = smoothUnion(k, a, b)
            let prev = smooth([0, 0, 0])
            for (let x = 0; x <= 3; x += 0.05) {
                const v = smooth([x, 0, 0])
                expect(Math.abs(v - prev)).toBeLessThan(0.1)
                prev = v
            }
        })
    })

    context("smoothSubtract", () => {
        const k = 0.5
        it("matches hard subtract when k <= 0", () => {
            const hard = subtract(a, b)
            const smooth = smoothSubtract(0, a, b)
            const p: [number, number, number] = [1.5, 0.5, 0]
            close(smooth(p), hard(p))
        })
        it("is continuous near the cut", () => {
            const smooth = smoothSubtract(k, a, b)
            let prev = smooth([0, 0, 0])
            for (let x = 0; x <= 3; x += 0.05) {
                const v = smooth([x, 0, 0])
                expect(Math.abs(v - prev)).toBeLessThan(0.1)
                prev = v
            }
        })
    })
})

describe("sdf transforms", () => {
    context("translated", () => {
        const s = translated(sphere(2), [5, 0, 0])
        it("is ~0 at offset ± radius along the axis", () => {
            close(s([7, 0, 0]), 0)
            close(s([3, 0, 0]), 0)
        })
        it("is negative at the new center", () => {
            close(s([5, 0, 0]), -2)
        })
    })

    context("rotated", () => {
        it("a capsule along X rotated 90° about Z lies along Y", () => {
            const c = capsule([-3, 0, 0], [3, 0, 0], 1)
            const r = rotated(c, [0, 0, 90])
            // the segment now runs along Y from -3..3: points on the axis within the
            // segment are at distance -radius from the surface.
            close(r([0, 2, 0]), -1)
            close(r([0, 0, 0]), -1)
            // the end-cap tip along Y is on the surface
            close(r([0, 4, 0]), 0)
            // radially off the rotated axis: 3 off the segment, minus radius → 2 outside
            expect(r([3, 0, 0])).toBeGreaterThan(0)
            close(r([3, 0, 0]), 2)
            // a point on the tube wall (1 off the axis, within the segment) is ~0
            close(r([1, 1, 0]), 0)
        })
        it("rotating a sphere is a no-op (rotationally symmetric)", () => {
            const s = sphere(3)
            const r = rotated(s, [10, 20, 30])
            close(r([3, 0, 0]), s([3, 0, 0]))
            close(r([1, 2, 2]), s([1, 2, 2]))
        })
    })

    context("scaled", () => {
        const s = scaled(sphere(2), 2)
        it("reads ~0 at factor * radius", () => {
            close(s([4, 0, 0]), 0)
        })
        it("is negative inside and scales the interior distance", () => {
            close(s([0, 0, 0]), -4)
        })
    })
})
