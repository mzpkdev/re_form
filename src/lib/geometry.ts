import type { ManifoldToplevel, Mesh } from "manifold-3d"
import * as THREE from "three"

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
        const geometry = new THREE.BufferGeometry()
        const stride = this.mesh.numProp
        const positions = new Float32Array(this.mesh.numVert * 3)
        for (let i = 0; i < this.mesh.numVert; i++) {
            positions[i * 3 + 0] = this.mesh.vertProperties[i * stride + 0]
            positions[i * 3 + 1] = this.mesh.vertProperties[i * stride + 1]
            positions[i * 3 + 2] = this.mesh.vertProperties[i * stride + 2]
        }
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
        geometry.setIndex(new THREE.BufferAttribute(this.mesh.triVerts, 1))
        geometry.computeVertexNormals()
        return geometry
    }
}
