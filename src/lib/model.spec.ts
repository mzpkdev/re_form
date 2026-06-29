import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { initManifold } from "./manifold"
import { geometryToManifold } from "./model"

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
})
