import type { ManifoldToplevel, Mesh } from "manifold-3d"
import type * as THREE from "three"
import { meshToBufferGeometry } from "./model"

export class Widget {
    private constructor(
        readonly mesh: Mesh,
        readonly volume: number,
        readonly surfaceArea: number
    ) {}

    static build(wasm: ManifoldToplevel): Widget {
        const { Manifold } = wasm
        const box = Manifold.cube([20, 20, 20], true)
        const sphere = Manifold.sphere(13, 64)
        const rounded = box.intersect(sphere)
        const boreZ = Manifold.cylinder(30, 4, 4, 48, true)
        const boreX = boreZ.rotate([0, 90, 0])
        const boreY = boreZ.rotate([90, 0, 0])
        const cut1 = rounded.subtract(boreX)
        const cut2 = cut1.subtract(boreY)
        const drilled = cut2.subtract(boreZ)
        const widget = new Widget(drilled.getMesh(), drilled.volume(), drilled.surfaceArea())
        for (const handle of [box, sphere, rounded, boreZ, boreX, boreY, cut1, cut2, drilled]) {
            handle.delete()
        }
        return widget
    }

    toBufferGeometry(): THREE.BufferGeometry {
        return meshToBufferGeometry(this.mesh)
    }
}
