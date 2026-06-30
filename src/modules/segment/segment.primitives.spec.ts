import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { initManifold } from "../../lib/manifold"
import { plateWithHole, sphere } from "./fixtures"
import { weldAndAnalyze } from "./mesh"
import { segment } from "./segment"
import type { CylinderParams, SegmentationParams, SegmentInput, ShapeGroup, ShapeKind, SphereParams } from "./types"

const context = describe

// ─────────────────────────────────────────────────────────────────────────────
// Seeded params. `epsilon` here is a FRACTION of the bbox diagonal D (spec §7) —
// the orchestrator scales it to an absolute distance by D before handing it to
// RANSAC, so we keep the §7 default 0.004 and only tune `minPoints` DOWN: the
// test fixtures are a few hundred points, well under the production floor of 50,
// so a low floor lets RANSAC clear `minPoints` on these small clouds while the
// loop stays fast. All four primitive types stay enabled so conflict resolution
// is actually exercised. `seed` fixes the RNG so every run is reproducible.
// ─────────────────────────────────────────────────────────────────────────────
const makeParams = (overrides: Partial<SegmentationParams> = {}): SegmentationParams => ({
    epsilon: 0.004,
    cosNormal: Math.cos((20 * Math.PI) / 180), // ≈ 0.94
    minPoints: 20,
    probability: 0.02,
    thetaCrease: (37 * Math.PI) / 180,
    thetaGrow: (18 * Math.PI) / 180,
    enabled: { plane: true, cylinder: true, sphere: true, cone: true },
    seed: 1,
    ...overrides
})

// bodies + regions + primitives — the M3 live combination: bodies are parentId
// targets (no body group), and the leaves are the fitted primitives plus the
// region patches plus the unknown bucket. Primitives run BEFORE regions (§6.6),
// so regions only catch faces no primitive claimed.
const fullPipeline = (geometry: THREE.BufferGeometry, overrides: Partial<SegmentInput> = {}): SegmentInput => ({
    geometry,
    params: makeParams(),
    tiers: { bodies: true, regions: true, primitives: true },
    ...overrides
})

// ── In-code dense fixtures (do NOT edit fixtures.ts) ──────────────────────────
//
// The repo's coarse `cube()` is 12 triangles → ~24 cloud points, far too sparse
// for localized RANSAC to clear `minPoints` (it would fall through to patches —
// still complete, but not a primitive). These builders subdivide each flat face
// into an N×N grid of quads so the sampled cloud is a real RANSAC target, while
// staying small enough that the loop is fast. Each returns a NON-INDEXED
// `BufferGeometry` (triangle soup) like `parseStl` / `fixtures.ts`.

type Vec3 = [number, number, number]

const geometryFromPositions = (positions: number[]): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3))
    return geometry
}

const pushQuad = (out: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3): void => {
    out.push(...a, ...b, ...c)
    out.push(...a, ...c, ...d)
}

/**
 * An axis-aligned cube whose 6 faces are each subdivided into an `n × n` grid of
 * outward-wound quads. `size` is the full edge length. With `n = 6` this is 432
 * triangles → ~864 cloud points: each face is a dense planar patch RANSAC can fit
 * and the §6.5a CC-split keeps as its own group (6 distinct connected planes).
 */
const subdividedCube = (size = 2, n = 6): THREE.BufferGeometry => {
    const h = size / 2
    const out: number[] = []
    // Lay an n×n quad grid over a face spanned by `du`, `dv` from `origin`.
    const face = (origin: Vec3, du: Vec3, dv: Vec3): void => {
        const pt = (u: number, v: number): Vec3 => [
            origin[0] + du[0] * u + dv[0] * v,
            origin[1] + du[1] * u + dv[1] * v,
            origin[2] + du[2] * u + dv[2] * v
        ]
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                pushQuad(
                    out,
                    pt(i / n, j / n),
                    pt((i + 1) / n, j / n),
                    pt((i + 1) / n, (j + 1) / n),
                    pt(i / n, (j + 1) / n)
                )
            }
        }
    }
    face([-h, -h, h], [size, 0, 0], [0, size, 0]) // +Z
    face([h, -h, -h], [-size, 0, 0], [0, size, 0]) // -Z
    face([h, -h, h], [0, 0, -size], [0, size, 0]) // +X
    face([-h, -h, -h], [0, 0, size], [0, size, 0]) // -X
    face([-h, h, h], [size, 0, 0], [0, 0, -size]) // +Y
    face([-h, -h, -h], [size, 0, 0], [0, 0, size]) // -Y
    return geometryFromPositions(out)
}

/**
 * Two squares lying in XZ planes (normal +Y) at DIFFERENT heights `y0`/`y1`,
 * offset along X so they are disjoint, each subdivided into an `n × n` grid. They
 * are coplanar in ORIENTATION but not in OFFSET, and topologically disconnected —
 * the canonical CC-split fixture: RANSAC fits them as planes and the mesh-topology
 * CC-split keeps them as two distinct groups.
 */
const denseTwoCoplanarSquares = (size = 2, y0 = 0, y1 = 1, gap = 1, n = 6): THREE.BufferGeometry => {
    const h = size / 2
    const offset = h + gap / 2
    const out: number[] = []
    const square = (cx: number, y: number): void => {
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const x0 = cx - h + (size * i) / n
                const x1 = cx - h + (size * (i + 1)) / n
                const z0 = -h + (size * j) / n
                const z1 = -h + (size * (j + 1)) / n
                pushQuad(out, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0])
            }
        }
    }
    square(-offset, y0)
    square(offset, y1)
    return geometryFromPositions(out)
}

// ── Shared assertions ─────────────────────────────────────────────────────────

const groupsOfKind = (groups: ShapeGroup[], kind: ShapeKind): ShapeGroup[] => groups.filter((g) => g.kind === kind)

const weldedFaceCount = (geometry: THREE.BufferGeometry): number => weldAndAnalyze(geometry).faceCount

// The §6.6 completeness invariant, asserted directly off a result: sizes sum to
// F, the membership sets are pairwise disjoint, and their union is exactly
// [0, F). `assertComplete` inside `segment` already throws on a violation (so a
// passing run is itself evidence), but we re-check here to fail with a readable
// diff rather than an opaque throw.
const expectPartition = (result: ReturnType<typeof segment>, F: number): void => {
    expect(result.triangleCount).toBe(F)
    const seen = new Set<number>()
    let total = 0
    for (const group of result.groups) {
        for (const f of group.triangleIndices) {
            expect(f).toBeGreaterThanOrEqual(0)
            expect(f).toBeLessThan(F)
            expect(seen.has(f)).toBe(false)
            seen.add(f)
            total++
        }
    }
    expect(total).toBe(F)
    expect(seen.size).toBe(F)
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe("segment — primitives tier (M3.4)", () => {
    context("subdivided cube with the full pipeline", () => {
        // A purely planar solid: each of the 6 faces is a distinct plane (different
        // normal/offset), so RANSAC fits 6 planes and the CC-split keeps each as
        // one connected group → 6 plane groups, no patch fallback needed.
        const geometry = subdividedCube(2, 6)

        it("emits six plane groups (CC-split yields six distinct connected planes)", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            expect(groupsOfKind(result.groups, "plane")).toHaveLength(6)
        })

        it("labels the planes Plane 1..Plane 6 and parents them to the single body", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))
            const planes = groupsOfKind(result.groups, "plane")

            const labels = new Set(planes.map((g) => g.label))
            expect(labels.size).toBe(6) // distinct, sequential labels
            for (const g of planes) expect(g.label).toMatch(/^Plane \d+$/)
            // A cube is one body, so every primitive shares one real parent id.
            const parents = new Set(planes.map((g) => g.parentId))
            expect(parents.size).toBe(1)
            expect([...parents][0]).toMatch(/^[0-9a-f-]{36}$/)
        })

        it("each plane's params normal is axis-aligned", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            for (const g of groupsOfKind(result.groups, "plane")) {
                if (g.params.kind !== "plane") continue
                const n = g.params.normal
                const maxComp = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]))
                expect(maxComp).toBeCloseTo(1, 2) // one component ≈ ±1, the rest ≈ 0
            }
        })

        it("partitions [0, F) over the leaf groups", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            expectPartition(result, weldedFaceCount(geometry))
        })

        it("is deterministic: same seed ⇒ same group kinds and count", async () => {
            const wasm = await initManifold()

            const a = segment(fullPipeline(geometry, { wasm }))
            const b = segment(fullPipeline(geometry, { wasm }))

            expect(a.groups.length).toBe(b.groups.length)
            expect(a.groups.map((g) => g.kind).sort()).toEqual(b.groups.map((g) => g.kind).sort())
        })
    })

    context("plate with a through-hole (dense enough for RANSAC)", () => {
        // 200 welded faces → 400 points: enough for the flat faces to fit as planes
        // and the bore wall to fit as one cylinder.
        const geometry = plateWithHole(4, 4, 1, 0.8, 32)

        it("detects planes plus exactly one cylinder for the bore", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            expect(groupsOfKind(result.groups, "cylinder")).toHaveLength(1)
            expect(groupsOfKind(result.groups, "plane").length).toBeGreaterThanOrEqual(2)
        })

        it("recovers the bore radius and a vertical axis within tolerance", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))
            const cyl = groupsOfKind(result.groups, "cylinder")[0].params as CylinderParams

            expect(cyl.radius).toBeCloseTo(0.8, 1) // within ~0.05 of the true 0.8
            expect(Math.abs(dot(cyl.axis, [0, 1, 0]))).toBeCloseTo(1, 2) // axis ∥ ±Y
        })

        it("partitions [0, F) with primitives + any region/unknown fallback", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            expectPartition(result, weldedFaceCount(geometry))
        })
    })

    context("two coplanar squares at different heights", () => {
        // Same orientation (+Y), different offsets, topologically disconnected.
        const geometry = denseTwoCoplanarSquares(2, 0, 1, 1, 6)

        it("yields two separate plane groups (proves the §6.5a CC-split)", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            expect(groupsOfKind(result.groups, "plane")).toHaveLength(2)
        })

        it("partitions [0, F)", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            expectPartition(result, weldedFaceCount(geometry))
        })
    })

    context("sphere", () => {
        // 816 welded faces → enough points; one curved surface fits as one sphere.
        const geometry = sphere(1, 24, 18)

        it("detects exactly one sphere with radius within tolerance", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))
            const spheres = groupsOfKind(result.groups, "sphere")

            expect(spheres).toHaveLength(1)
            expect((spheres[0].params as SphereParams).radius).toBeCloseTo(1, 1)
        })

        it("partitions [0, F)", async () => {
            const wasm = await initManifold()

            const result = segment(fullPipeline(geometry, { wasm }))

            expectPartition(result, weldedFaceCount(geometry))
        })
    })

    context("region/unknown fallback still catches what RANSAC misses", () => {
        // Disable EVERY primitive type: RANSAC detects nothing, so the primitives
        // seam claims no face and every face falls through to the region grow (and
        // the unknown bucket). This proves primitives sit cleanly in front of the
        // existing M2 path without swallowing the fallback — a flat solid still
        // splits into its faces, just labelled `patch` rather than `plane`.
        it("a flat solid with primitives disabled still splits into patches and stays complete", async () => {
            const wasm = await initManifold()
            const geometry = subdividedCube(2, 6)

            const result = segment(
                fullPipeline(geometry, {
                    wasm,
                    params: makeParams({ enabled: { plane: false, cylinder: false, sphere: false, cone: false } })
                })
            )

            expect(groupsOfKind(result.groups, "plane")).toHaveLength(0)
            expect(groupsOfKind(result.groups, "patch")).toHaveLength(6) // the 6 faces, region-grown
            expectPartition(result, weldedFaceCount(geometry))
        })
    })
})
