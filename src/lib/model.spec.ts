import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { initManifold } from "./manifold"
import { geometryToManifold, transformedBounds, transformedGeometry } from "./model"

const context = describe

describe("model", () => {
    context("geometryToManifold", () => {
        it("welds a non-indexed triangle soup into a valid solid", async () => {
            const wasm = await initManifold()
            // BoxGeometry is a non-indexed soup once de-indexed, mirroring the
            // STLLoader output that manifold would otherwise reject.
            const soup = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
            expect(soup.getIndex()).toBeNull()

            const manifold = geometryToManifold(wasm, soup)
            expect(manifold.isEmpty()).toBe(false)
            expect(manifold.volume()).toBeGreaterThan(0)
            // A 2×2×2 cube is 8 cubic units; welding is required to reach it.
            expect(manifold.volume()).toBeCloseTo(8, 1)

            manifold.delete()
            soup.dispose()
        })
    })

    context("transformedGeometry", () => {
        it("bakes scale + translate into the returned geometry's bounds", async () => {
            const wasm = await initManifold()
            const source = wasm.Manifold.cube([2, 2, 2], true)

            const geometry = transformedGeometry(source, {
                position: [5, 0, 0],
                rotation: [0, 0, 0],
                scale: [2, 2, 2]
            })

            geometry.computeBoundingBox()
            const box = geometry.boundingBox as THREE.Box3
            const center = box.getCenter(new THREE.Vector3())
            const size = box.getSize(new THREE.Vector3())

            // 2-unit centered cube scaled ×2 → size 4, then shifted +5 in X.
            expect(center.x).toBeCloseTo(5, 5)
            expect(center.y).toBeCloseTo(0, 5)
            expect(center.z).toBeCloseTo(0, 5)
            expect(size.x).toBeCloseTo(4, 5)
            expect(size.y).toBeCloseTo(4, 5)
            expect(size.z).toBeCloseTo(4, 5)

            geometry.dispose()
            source.delete()
        })
    })

    context("transformedBounds", () => {
        it("reports the post-transform AABB without meshing", async () => {
            const wasm = await initManifold()
            // 10mm cube centred at origin → [-5,5]^3.
            const source = wasm.Manifold.cube([10, 10, 10], true)

            const { min, max } = transformedBounds(source, {
                position: [5, 0, 0],
                rotation: [0, 0, 0],
                scale: [2, 1, 1]
            })

            // Scaled ×[2,1,1] → 20×10×10 about origin, then shifted +5 in X:
            // X spans [-5, 15]; Y and Z stay [-5, 5].
            expect(min[0]).toBeCloseTo(-5, 5)
            expect(max[0]).toBeCloseTo(15, 5)
            expect(min[1]).toBeCloseTo(-5, 5)
            expect(max[1]).toBeCloseTo(5, 5)
            expect(min[2]).toBeCloseTo(-5, 5)
            expect(max[2]).toBeCloseTo(5, 5)

            // The source is left intact for the caller.
            expect(source.volume()).toBeCloseTo(1000, 0)
            source.delete()
        })
    })
})
