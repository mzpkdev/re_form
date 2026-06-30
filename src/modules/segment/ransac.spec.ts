import { describe, expect, it } from "bun:test"
import type * as THREE from "three"
import type { Vec3 } from "./fit"
import { cube, plateWithHole } from "./fixtures"
import { weldAndAnalyze } from "./mesh"
import { type DetectedShape, detectPrimitives } from "./ransac"
import { sampleCloud } from "./sample"
import type { CylinderParams, OrientedCloud, SegmentationParams } from "./types"

const context = describe

// ─────────────────────────────────────────────────────────────────────────────
// Seeded params. epsilon/cosNormal are ABSOLUTE here (the dual test uses them as
// `pointDistance ≤ epsilon`, `|n·n_S| ≥ cosNormal` directly). The fixtures are
// unit-ish scale, so epsilon ≈ 0.02 comfortably accepts on-surface points while
// rejecting a perpendicular face. minPoints is kept LOW so the small clouds (a
// few hundred points) still clear the floor and the loop stays fast.
const makeParams = (overrides: Partial<SegmentationParams> = {}): SegmentationParams => ({
    epsilon: 0.02,
    cosNormal: Math.cos((20 * Math.PI) / 180), // ≈ 0.94
    minPoints: 8,
    probability: 0.02,
    thetaCrease: 0.6,
    thetaGrow: 0.3,
    enabled: { plane: true, cylinder: true, sphere: true, cone: true },
    seed: 1,
    ...overrides
})

const cloudFor = (geometry: THREE.BufferGeometry, params: SegmentationParams): OrientedCloud =>
    sampleCloud(weldAndAnalyze(geometry), params)

const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const planes = (d: DetectedShape[]): DetectedShape[] => d.filter((s) => s.params.kind === "plane")
const cylinders = (d: DetectedShape[]): DetectedShape[] => d.filter((s) => s.params.kind === "cylinder")

// A stable, value-only fingerprint of the detections so determinism can be
// asserted on SORTED params (RANSAC order can vary run-to-run only if the seed
// changes; here we also sort defensively so the assertion is on content).
const f4 = (xs: number[]): string => xs.map((v) => v.toFixed(4)).join(",")
const printShape = (p: DetectedShape["params"]): string => {
    if (p.kind === "plane") return `plane|${f4(p.normal)}|${p.offset.toFixed(4)}`
    if (p.kind === "cylinder") return `cyl|${f4(p.axis)}|${p.radius.toFixed(4)}`
    if (p.kind === "sphere") return `sph|${f4(p.center)}|${p.radius.toFixed(4)}`
    return `cone|${f4(p.axis)}|${p.halfAngle.toFixed(4)}`
}
const fingerprint = (d: DetectedShape[]): string =>
    d
        .map((s) => printShape(s.params))
        .sort()
        .join("\n")

describe("ransac — detectPrimitives (§6.3)", () => {
    context("plate with a through-hole", () => {
        // Small plate, coarse hole → a few hundred points, fast.
        const params = makeParams()
        const cloud = cloudFor(plateWithHole(4, 4, 1, 0.8, 16), params)
        const { detected, remaining } = detectPrimitives(cloud, params)

        it("detects exactly one cylinder for the bore", () => {
            expect(cylinders(detected).length).toBe(1)
        })

        it("recovers the bore radius and a vertical axis within tolerance", () => {
            const cyl = cylinders(detected)[0].params as CylinderParams
            expect(cyl.radius).toBeCloseTo(0.8, 1) // within ~0.05 of true 0.8
            // Hole runs down Y → axis ∥ ±[0,1,0].
            expect(Math.abs(dot(cyl.axis, [0, 1, 0]))).toBeCloseTo(1, 2)
        })

        it("also detects the plate's flat faces as planes", () => {
            expect(planes(detected).length).toBeGreaterThanOrEqual(2)
        })

        it("leaves remaining as point indices within the cloud range", () => {
            const total = cloud.position.length / 3
            for (const i of remaining) {
                expect(i).toBeGreaterThanOrEqual(0)
                expect(i).toBeLessThan(total)
            }
        })

        it("every detected fitRms is small (points sit on their surface)", () => {
            for (const s of detected) expect(s.fitRms).toBeLessThanOrEqual(params.epsilon)
        })
    })

    context("cube (densely sampled so faces clear the floor)", () => {
        // The fixture cube is only 12 triangles → ~24 cloud points, too sparse for
        // localized sampling to ever clear `minPoints`. Build a denser oriented
        // cloud directly: each of the 6 axis-aligned faces gets a GRID×GRID lattice
        // of points carrying the exact outward face normal. Small (6·64 = 384 pts)
        // and fast, but a real RANSAC target.
        const buildCubeCloud = (half = 1, grid = 8): OrientedCloud => {
            const pos: number[] = []
            const nrm: number[] = []
            const tri: number[] = []
            const axes: { n: Vec3; f: number }[] = [
                { n: [1, 0, 0], f: 0 },
                { n: [-1, 0, 0], f: 1 },
                { n: [0, 1, 0], f: 2 },
                { n: [0, -1, 0], f: 3 },
                { n: [0, 0, 1], f: 4 },
                { n: [0, 0, -1], f: 5 }
            ]
            const span = (k: number): number => -half + (2 * half * k) / (grid - 1)
            for (const { n, f } of axes) {
                for (let a = 0; a < grid; a++) {
                    for (let b = 0; b < grid; b++) {
                        const u = span(a)
                        const v = span(b)
                        // Lay (u,v) into the two axes orthogonal to the face normal.
                        const p: Vec3 =
                            n[0] !== 0 ? [n[0] * half, u, v] : n[1] !== 0 ? [u, n[1] * half, v] : [u, v, n[2] * half]
                        pos.push(p[0], p[1], p[2])
                        nrm.push(n[0], n[1], n[2])
                        tri.push(f)
                    }
                }
            }
            return {
                position: new Float32Array(pos),
                normal: new Float32Array(nrm),
                pointToTri: new Int32Array(tri)
            }
        }

        const params = makeParams({ minPoints: 20 })
        const cloud = buildCubeCloud(1, 8)
        const { detected } = detectPrimitives(cloud, params)

        it("detects several planes (the cube's flat faces)", () => {
            expect(planes(detected).length).toBeGreaterThanOrEqual(3)
        })

        it("is plane-dominated on a purely planar solid", () => {
            // Curved primitives can momentarily out-score a plane on a flat patch
            // during the trial loop, but a flat lattice refits/commits as a plane;
            // planes should make up the bulk of what survives.
            expect(planes(detected).length).toBeGreaterThanOrEqual(detected.length - 1)
        })

        it("the detected planes are axis-aligned", () => {
            for (const s of planes(detected)) {
                if (s.params.kind !== "plane") continue
                const n = s.params.normal
                const maxComp = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]))
                expect(maxComp).toBeCloseTo(1, 2) // one component ≈ ±1, rest ≈ 0
            }
        })
    })

    context("determinism", () => {
        it("same seed + params ⇒ identical detected count and sorted params", () => {
            const params = makeParams({ seed: 7 })
            const cloudA = cloudFor(plateWithHole(4, 4, 1, 0.8, 16), params)
            const cloudB = cloudFor(plateWithHole(4, 4, 1, 0.8, 16), params)
            const a = detectPrimitives(cloudA, params)
            const b = detectPrimitives(cloudB, params)
            expect(a.detected.length).toBe(b.detected.length)
            expect(fingerprint(a.detected)).toBe(fingerprint(b.detected))
            expect(Array.from(a.remaining)).toEqual(Array.from(b.remaining))
        })

        it("a different seed is still internally reproducible", () => {
            const params = makeParams({ seed: 99 })
            const cloud = cloudFor(cube(2), params)
            const a = detectPrimitives(cloud, params)
            const b = detectPrimitives(cloud, params)
            expect(fingerprint(a.detected)).toBe(fingerprint(b.detected))
        })
    })

    context("dual inlier test rejects a perpendicular face at equal distance", () => {
        // Two clusters of oriented points the SAME distance from a candidate plane
        // but with PERPENDICULAR normals: a +Z-facing patch at z=0 and a +X-facing
        // patch at x=0. A plane fit seeded on the +Z patch must NOT swallow the +X
        // patch even though many of its points satisfy the distance test, because
        // their normals disagree. With the normal test OFF (cosNormal = -1) it
        // would; with it ON the two stay separate.
        const buildTwoFaceCloud = (): OrientedCloud => {
            const pos: number[] = []
            const nrm: number[] = []
            const tri: number[] = []
            // +Z face: points on z=0, normal +Z, spread in x,y ∈ [-0.5,0.5].
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 6; j++) {
                    pos.push(-0.5 + i * 0.2, -0.5 + j * 0.2, 0)
                    nrm.push(0, 0, 1)
                    tri.push(0)
                }
            }
            // +X face: points on x=0 (so within epsilon of the z=0 plane near the
            // shared edge is irrelevant — these are far in z too), normal +X. Place
            // them on the plane x=0 spanning y,z so a z=0 plane only touches the
            // z≈0 row, but their normals are ⟂.
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 6; j++) {
                    pos.push(0, -0.5 + i * 0.2, -0.5 + j * 0.2)
                    nrm.push(1, 0, 0)
                    tri.push(1)
                }
            }
            return {
                position: new Float32Array(pos),
                normal: new Float32Array(nrm),
                pointToTri: new Int32Array(tri)
            }
        }

        it("a plane group never mixes the two perpendicular faces", () => {
            const params = makeParams({ enabled: { plane: true, cylinder: false, sphere: false, cone: false } })
            const cloud = buildTwoFaceCloud()
            const { detected } = detectPrimitives(cloud, params)
            // Each plane's inliers must be normal-consistent: every inlier normal
            // aligns with the inlier set's mean normal (no ⟂ mixing).
            for (const s of detected) {
                const meanN: Vec3 = [0, 0, 0]
                for (const i of s.inliers) {
                    meanN[0] += cloud.normal[i * 3]
                    meanN[1] += cloud.normal[i * 3 + 1]
                    meanN[2] += cloud.normal[i * 3 + 2]
                }
                const len = length(meanN)
                const unitMean: Vec3 = [meanN[0] / len, meanN[1] / len, meanN[2] / len]
                for (const i of s.inliers) {
                    const n: Vec3 = [cloud.normal[i * 3], cloud.normal[i * 3 + 1], cloud.normal[i * 3 + 2]]
                    // All inliers point essentially the same way (cos ≈ 1), never ⟂.
                    expect(Math.abs(dot(n, unitMean))).toBeGreaterThan(0.9)
                }
            }
        })
    })

    context("enabled flags are honored", () => {
        it("disabling cylinder yields no cylinder on the plate+hole", () => {
            const params = makeParams({ enabled: { plane: true, cylinder: false, sphere: false, cone: false } })
            const cloud = cloudFor(plateWithHole(4, 4, 1, 0.8, 16), params)
            const { detected } = detectPrimitives(cloud, params)
            expect(cylinders(detected).length).toBe(0)
        })

        it("disabling every primitive type detects nothing", () => {
            const params = makeParams({ enabled: { plane: false, cylinder: false, sphere: false, cone: false } })
            const cloud = cloudFor(cube(2), params)
            const { detected, remaining } = detectPrimitives(cloud, params)
            expect(detected.length).toBe(0)
            expect(remaining.length).toBe(cloud.position.length / 3)
        })
    })

    context("minPoints floor is respected", () => {
        it("a floor larger than any extractable face detects nothing", () => {
            const params = makeParams({ minPoints: 100_000 })
            const cloud = cloudFor(cube(2), params)
            const { detected, remaining } = detectPrimitives(cloud, params)
            expect(detected.length).toBe(0)
            expect(remaining.length).toBe(cloud.position.length / 3)
        })

        it("every committed shape has at least minPoints inliers", () => {
            const params = makeParams({ minPoints: 12 })
            const cloud = cloudFor(plateWithHole(4, 4, 1, 0.8, 16), params)
            const { detected } = detectPrimitives(cloud, params)
            for (const s of detected) expect(s.inliers.length).toBeGreaterThanOrEqual(params.minPoints)
        })
    })
})
