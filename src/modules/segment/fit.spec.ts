import { describe, expect, it } from "bun:test"
import {
    fitCone,
    fitCylinder,
    fitPlane,
    fitSphere,
    pointDistance,
    refitCone,
    refitCylinder,
    refitPlane,
    refitSphere,
    surfaceNormal,
    type Vec3
} from "./fit"

const context = describe

// ─────────────────────────────────────────────────────────────────────────────
// vec3 helpers — local copies so the fixtures are self-contained and the spec
// asserts against hand-computed truth, never the implementation's internals.
// ─────────────────────────────────────────────────────────────────────────────

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
]
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const unit = (a: Vec3): Vec3 => {
    const l = length(a)
    return [a[0] / l, a[1] / l, a[2] / l]
}
/** Perpendicular distance from `p` to the infinite line through `point` with unit `axis`. */
const distToAxisLine = (p: Vec3, point: Vec3, axis: Vec3): number => {
    const rel = sub(p, point)
    const radial = sub(rel, scale(axis, dot(rel, axis)))
    return length(radial)
}

const DEG = Math.PI / 180

describe("fit — closed-form constructors (§6.3)", () => {
    context("fitPlane from one oriented point", () => {
        it("returns the unit normal and offset n·p", () => {
            // Un-normalized normal on purpose; the fitter must normalize it.
            const plane = fitPlane([1, 1, 5], [0, 0, 2])
            expect(plane.kind).toBe("plane")
            expect(plane.normal[0]).toBeCloseTo(0, 12)
            expect(plane.normal[1]).toBeCloseTo(0, 12)
            expect(plane.normal[2]).toBeCloseTo(1, 12)
            expect(plane.offset).toBeCloseTo(5, 12) // n·p = 1*0 + 1*0 + 5*1
        })

        it("offset is the signed distance of the point along the unit normal", () => {
            const n = unit([1, 2, 2]) // length 3 → unit [1/3,2/3,2/3]
            const p: Vec3 = [4, -1, 7]
            const plane = fitPlane(p, n)
            expect(plane.offset).toBeCloseTo(dot(n, p), 12)
            // The point lies exactly on the returned plane.
            expect(Math.abs(dot(plane.normal, p) - plane.offset)).toBeCloseTo(0, 12)
        })
    })

    context("fitSphere from two oriented points on a known sphere", () => {
        // Sphere center C, radius R; points are C + R·d with OUTWARD normal d.
        const C: Vec3 = [1, 2, 3]
        const R = 5

        it("recovers center and radius from outward-oriented points", () => {
            const p0 = add(C, scale([1, 0, 0], R)) // [6,2,3]
            const p1 = add(C, scale([0, 1, 0], R)) // [1,7,3]
            const sphere = fitSphere(p0, [1, 0, 0], p1, [0, 1, 0])
            expect(sphere).not.toBeNull()
            if (!sphere) return
            expect(sphere.kind).toBe("sphere")
            expect(sphere.center[0]).toBeCloseTo(C[0], 9)
            expect(sphere.center[1]).toBeCloseTo(C[1], 9)
            expect(sphere.center[2]).toBeCloseTo(C[2], 9)
            expect(sphere.radius).toBeCloseTo(R, 9)
        })

        it("recovers center from oblique outward normals", () => {
            const d0 = unit([1, 1, 0])
            const d1 = unit([0, 1, 1])
            const sphere = fitSphere(add(C, scale(d0, R)), d0, add(C, scale(d1, R)), d1)
            expect(sphere).not.toBeNull()
            if (!sphere) return
            expect(length(sub(sphere.center, C))).toBeCloseTo(0, 9)
            expect(sphere.radius).toBeCloseTo(R, 9)
        })

        it("returns null when the two normals are parallel", () => {
            expect(fitSphere([0, 0, 0], [1, 0, 0], [3, 0, 0], [1, 0, 0])).toBeNull()
            // Anti-parallel is also a singular projector sum.
            expect(fitSphere([0, 0, 0], [1, 0, 0], [3, 0, 0], [-1, 0, 0])).toBeNull()
        })
    })

    context("fitCylinder from two radial-normal points on a known cylinder", () => {
        // Axis along +Z through A; radius R; radial points A + R·(cos,sin,0).
        const axisTrue: Vec3 = [0, 0, 1]
        const A: Vec3 = [1, 2, 0]
        const R = 3

        it("recovers axis ∥ n₀×n₁, the radius, and a point on the axis", () => {
            const n0: Vec3 = [1, 0, 0]
            const n1: Vec3 = [0, 1, 0]
            const p0 = add(A, scale(n0, R)) // [4,2,0]
            const p1 = add(A, scale(n1, R)) // [1,5,0]
            const cyl = fitCylinder(p0, n0, p1, n1)
            expect(cyl).not.toBeNull()
            if (!cyl) return
            expect(cyl.kind).toBe("cylinder")

            // axis parallel (up to sign) to normalize(n₀×n₁) = ±[0,0,1].
            const wanted = unit(cross(n0, n1))
            expect(Math.abs(dot(cyl.axis, wanted))).toBeCloseTo(1, 9)

            expect(cyl.radius).toBeCloseTo(R, 9)

            // The returned point lies on the true axis line.
            expect(distToAxisLine(cyl.point, A, axisTrue)).toBeCloseTo(0, 9)
        })

        it("works for a tilted axis with oblique radial normals", () => {
            // Axis = unit[1,1,1]; build two distinct radial dirs ⟂ axis.
            const axis = unit([1, 1, 1])
            const r0 = unit(cross(axis, [1, 0, 0]))
            const r1 = unit(cross(axis, r0)) // a second radial dir ⟂ axis, ≠ r0
            const point: Vec3 = [2, -1, 4]
            const radius = 2.5
            const p0 = add(point, scale(r0, radius))
            const p1 = add(point, scale(r1, radius))
            const cyl = fitCylinder(p0, r0, p1, r1)
            expect(cyl).not.toBeNull()
            if (!cyl) return
            expect(Math.abs(dot(cyl.axis, axis))).toBeCloseTo(1, 9)
            expect(cyl.radius).toBeCloseTo(radius, 9)
            expect(distToAxisLine(cyl.point, point, axis)).toBeCloseTo(0, 9)
        })

        it("returns null when the two normals are parallel (no unique axis)", () => {
            expect(fitCylinder([0, 0, 0], [1, 0, 0], [0, 5, 0], [1, 0, 0])).toBeNull()
        })
    })

    context("fitCone from three points on a known cone", () => {
        // Apex at origin, axis +Z, half-angle 30°. A generator at azimuth φ has
        // direction sinH·(cosφ,sinφ,0)+cosH·(0,0,1); outward normal there is
        // cosH·r̂ − sinH·axis.
        const apexTrue: Vec3 = [0, 0, 0]
        const axisTrue: Vec3 = [0, 0, 1]
        const half = 30 * DEG
        const sinH = Math.sin(half)
        const cosH = Math.cos(half)
        const conePoint = (phi: number, s: number): Vec3 => scale([sinH * Math.cos(phi), sinH * Math.sin(phi), cosH], s)
        const coneNormal = (phi: number): Vec3 =>
            unit(sub(scale([Math.cos(phi), Math.sin(phi), 0], cosH), scale(axisTrue, sinH)))

        it("recovers apex, axis and half-angle", () => {
            const phis = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
            const ss = [2, 3, 4] // different slant distances → independent generators
            const cone = fitCone(
                conePoint(phis[0], ss[0]),
                coneNormal(phis[0]),
                conePoint(phis[1], ss[1]),
                coneNormal(phis[1]),
                conePoint(phis[2], ss[2]),
                coneNormal(phis[2])
            )
            expect(cone).not.toBeNull()
            if (!cone) return
            expect(cone.kind).toBe("cone")
            expect(length(sub(cone.apex, apexTrue))).toBeCloseTo(0, 9)
            // axis oriented apex→base, so it should match +Z (not −Z).
            expect(cone.axis[2]).toBeCloseTo(1, 9)
            expect(cone.halfAngle).toBeCloseTo(half, 9)
        })

        it("returns null when the three tangent planes are degenerate (parallel normals)", () => {
            // All normals equal → planes parallel → apex solve singular.
            const n: Vec3 = unit([1, 0, -1])
            expect(fitCone([1, 0, 1], n, [2, 0, 2], n, [3, 0, 3], n)).toBeNull()
        })
    })
})

describe("fit — least-squares refit", () => {
    context("refitPlane (PCA)", () => {
        it("recovers the plane of many exactly-coplanar points", () => {
            // Plane z = 2.
            const pts: Vec3[] = [
                [0, 0, 2],
                [1, 0, 2],
                [0, 1, 2],
                [1, 1, 2],
                [2, 3, 2],
                [-1, 4, 2],
                [5, 5, 2]
            ]
            const plane = refitPlane(pts)
            expect(Math.abs(plane.normal[2])).toBeCloseTo(1, 6) // normal ≈ ±Z
            expect(Math.abs(plane.offset)).toBeCloseTo(2, 6) // |n·centroid| = 2
            // Every point sits on the fitted plane regardless of normal sign.
            for (const p of pts) {
                expect(Math.abs(dot(plane.normal, p) - plane.offset)).toBeCloseTo(0, 6)
            }
        })

        it("recovers a tilted plane from noisy-but-coplanar points (deterministic noise)", () => {
            // Plane through origin with unit normal n; sample a grid in-plane, then
            // add a tiny DETERMINISTIC in-plane-free perturbation that stays on the
            // plane (so the true normal is still the min-variance direction).
            const n = unit([1, 2, 3])
            const u = unit(cross(n, [0, 0, 1]))
            const v = cross(n, u) // {u,v} span the plane
            const pts: Vec3[] = []
            for (let i = -3; i <= 3; i++) {
                for (let j = -3; j <= 3; j++) {
                    // points lie EXACTLY on the plane (no out-of-plane component)
                    pts.push(add(scale(u, i), scale(v, j * 1.7)))
                }
            }
            const plane = refitPlane(pts)
            expect(Math.abs(dot(plane.normal, n))).toBeCloseTo(1, 6)
            expect(plane.offset).toBeCloseTo(0, 6) // plane passes through origin
        })
    })

    context("refitSphere (LM) tightens a perturbed guess", () => {
        // True sphere: center origin, radius 2. Cloud of points exactly on it.
        const C: Vec3 = [0, 0, 0]
        const R = 2
        const cloud: Vec3[] = []
        for (let a = 0; a < 6; a++) {
            for (let b = 1; b <= 3; b++) {
                const th = a
                const ph = (b * Math.PI) / 4
                cloud.push([R * Math.sin(ph) * Math.cos(th), R * Math.sin(ph) * Math.sin(th), R * Math.cos(ph)])
            }
        }

        it("converges toward the true center and radius from an off guess", () => {
            const init = { kind: "sphere" as const, center: [0.4, -0.3, 0.2] as Vec3, radius: 1.4 }
            const out = refitSphere(init, cloud)
            expect(length(sub(out.center, C))).toBeLessThan(1e-3)
            expect(out.radius).toBeCloseTo(R, 3)
        })

        it("returns the init unchanged when there are too few points (<4)", () => {
            const init = { kind: "sphere" as const, center: [9, 9, 9] as Vec3, radius: 7 }
            const out = refitSphere(init, [
                [0, 0, 0],
                [1, 0, 0],
                [0, 1, 0]
            ])
            expect(out).toEqual(init)
        })
    })

    context("refitCylinder (LM) tightens a perturbed guess", () => {
        // True cylinder: axis +Z, point origin, radius 1.5.
        const radius = 1.5
        const cloud: Vec3[] = []
        for (let a = 0; a < 6; a++) {
            for (const z of [-1, 0, 1]) {
                cloud.push([radius * Math.cos(a), radius * Math.sin(a), z])
            }
        }

        it("converges toward the true axis and radius from an off guess", () => {
            const init = {
                kind: "cylinder" as const,
                axis: unit([0.06, 0.03, 0.99]),
                point: [0.2, -0.15, 0] as Vec3,
                radius: 1.1
            }
            const out = refitCylinder(init, cloud)
            expect(Math.abs(dot(out.axis, [0, 0, 1]))).toBeCloseTo(1, 4)
            expect(out.radius).toBeCloseTo(radius, 3)
            // The fitted axis line coincides with the true axis (origin, +Z).
            expect(distToAxisLine(out.point, [0, 0, 0], unit(out.axis))).toBeLessThan(1e-3)
        })

        it("preserves axialRange and returns init unchanged when too few points (<5)", () => {
            const init = {
                kind: "cylinder" as const,
                axis: [0, 0, 1] as Vec3,
                point: [0, 0, 0] as Vec3,
                radius: 2,
                axialRange: [-1, 1] as [number, number]
            }
            const out = refitCylinder(init, [
                [2, 0, 0],
                [0, 2, 0],
                [-2, 0, 0]
            ])
            expect(out).toEqual(init)
        })
    })

    context("refitCone (LM) tightens a perturbed guess", () => {
        // True cone: apex origin, axis +Z, half-angle 30°.
        const half = 30 * DEG
        const sinH = Math.sin(half)
        const cosH = Math.cos(half)
        const cloud: Vec3[] = []
        for (let a = 0; a < 6; a++) {
            for (const s of [1, 2, 3]) {
                cloud.push([s * sinH * Math.cos(a), s * sinH * Math.sin(a), s * cosH])
            }
        }

        it("converges toward the true apex, axis and half-angle from an off guess", () => {
            const init = {
                kind: "cone" as const,
                apex: [0.12, -0.08, 0.1] as Vec3,
                axis: unit([0.04, 0.02, 0.99]),
                halfAngle: 0.42
            }
            const out = refitCone(init, cloud)
            expect(length(sub(out.apex, [0, 0, 0]))).toBeLessThan(1e-2)
            expect(Math.abs(dot(out.axis, [0, 0, 1]))).toBeCloseTo(1, 3)
            expect(out.halfAngle).toBeCloseTo(half, 3)
        })

        it("returns init unchanged when too few points (<6)", () => {
            const init = {
                kind: "cone" as const,
                apex: [1, 1, 1] as Vec3,
                axis: [0, 0, 1] as Vec3,
                halfAngle: 0.5
            }
            const out = refitCone(init, [
                [0, 0, 0],
                [1, 0, 0],
                [0, 1, 0]
            ])
            expect(out).toEqual(init)
        })
    })

    context("refit accepts a Float32Array point source", () => {
        it("refits a plane from interleaved xyz floats identically to a Vec3[]", () => {
            const arr = new Float32Array([0, 0, 2, 1, 0, 2, 0, 1, 2, 1, 1, 2, 2, 3, 2])
            const plane = refitPlane(arr)
            expect(Math.abs(plane.normal[2])).toBeCloseTo(1, 5)
            expect(Math.abs(plane.offset)).toBeCloseTo(2, 5)
        })
    })
})

describe("fit — geometry helpers (RANSAC dual inlier test)", () => {
    context("pointDistance", () => {
        it("is the perpendicular distance to a plane (on- and off-surface)", () => {
            const plane = { kind: "plane" as const, normal: [0, 0, 1] as Vec3, offset: 2 }
            expect(pointDistance(plane, [3, 4, 2])).toBeCloseTo(0, 12)
            expect(pointDistance(plane, [3, 4, 5])).toBeCloseTo(3, 12)
            expect(pointDistance(plane, [3, 4, -1])).toBeCloseTo(3, 12) // below the plane
        })

        it("is |‖p−c‖−r| for a sphere", () => {
            const sphere = { kind: "sphere" as const, center: [0, 0, 0] as Vec3, radius: 2 }
            expect(pointDistance(sphere, [2, 0, 0])).toBeCloseTo(0, 12)
            expect(pointDistance(sphere, [5, 0, 0])).toBeCloseTo(3, 12) // outside
            expect(pointDistance(sphere, [0.5, 0, 0])).toBeCloseTo(1.5, 12) // inside
        })

        it("is the radial deviation for a cylinder, independent of axial position", () => {
            const cyl = {
                kind: "cylinder" as const,
                axis: [0, 0, 1] as Vec3,
                point: [0, 0, 0] as Vec3,
                radius: 2
            }
            expect(pointDistance(cyl, [2, 0, 9])).toBeCloseTo(0, 12)
            expect(pointDistance(cyl, [5, 0, -7])).toBeCloseTo(3, 12)
        })

        it("is ~0 on the cone surface and grows off it", () => {
            const half = 30 * DEG
            const cone = {
                kind: "cone" as const,
                apex: [0, 0, 0] as Vec3,
                axis: [0, 0, 1] as Vec3,
                halfAngle: half
            }
            const sinH = Math.sin(half)
            const cosH = Math.cos(half)
            const on: Vec3 = [2 * sinH, 0, 2 * cosH] // slant distance 2 from apex
            expect(pointDistance(cone, on)).toBeCloseTo(0, 12)
            // A point pushed radially outward by δ along the surface normal is δ away.
            const nrm = surfaceNormal(cone, on)
            const off = add(on, scale(nrm, 0.5))
            expect(pointDistance(cone, off)).toBeCloseTo(0.5, 6)
        })
    })

    context("surfaceNormal", () => {
        it("is the constant plane normal", () => {
            const n = surfaceNormal({ kind: "plane", normal: [0, 0, 1], offset: 2 }, [9, 9, 9])
            expect(n).toEqual([0, 0, 1])
        })

        it("points radially outward from a sphere center", () => {
            const n = surfaceNormal({ kind: "sphere", center: [0, 0, 0], radius: 2 }, [0, 0, 5])
            expect(n[0]).toBeCloseTo(0, 12)
            expect(n[1]).toBeCloseTo(0, 12)
            expect(n[2]).toBeCloseTo(1, 12)
        })

        it("is the radial direction for a cylinder (⟂ axis)", () => {
            const n = surfaceNormal({ kind: "cylinder", axis: [0, 0, 1], point: [0, 0, 0], radius: 2 }, [2, 0, 7])
            expect(n[0]).toBeCloseTo(1, 12)
            expect(n[1]).toBeCloseTo(0, 12)
            expect(n[2]).toBeCloseTo(0, 12) // no axial component
        })

        it("matches cosθ·r̂ − sinθ·axis on a cone surface", () => {
            const half = 30 * DEG
            const sinH = Math.sin(half)
            const cosH = Math.cos(half)
            const on: Vec3 = [2 * sinH, 0, 2 * cosH]
            const n = surfaceNormal({ kind: "cone", apex: [0, 0, 0], axis: [0, 0, 1], halfAngle: half }, on)
            // Expected outward normal: r̂=+X here → [cosH, 0, −sinH].
            expect(n[0]).toBeCloseTo(cosH, 9)
            expect(n[1]).toBeCloseTo(0, 9)
            expect(n[2]).toBeCloseTo(-sinH, 9)
            expect(length(n)).toBeCloseTo(1, 12)
        })

        it("falls back to a fixed axis at the sphere center (undefined normal)", () => {
            const n = surfaceNormal({ kind: "sphere", center: [0, 0, 0], radius: 2 }, [0, 0, 0])
            expect(length(n)).toBeCloseTo(1, 12) // a valid unit vector, no NaN/throw
        })
    })
})
