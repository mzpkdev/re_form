import * as THREE from "three"
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"

/**
 * Parse STL bytes (ASCII or binary) into a three.js BufferGeometry.
 *
 * The geometry is returned raw — positions are left in their original
 * coordinates and nothing is centered or mutated; the Viewport frames the
 * camera around it. Vertex normals are computed when the STL omits them so the
 * mesh shades correctly under lighting.
 */
export const parseStl = (data: ArrayBuffer): THREE.BufferGeometry => {
    const geometry = new STLLoader().parse(data)
    if (!geometry.getAttribute("normal")) {
        geometry.computeVertexNormals()
    }
    return geometry
}

/**
 * Serialize a three.js BufferGeometry to a binary STL.
 *
 * STLExporter only walks Object3Ds whose `isMesh` is true, so the geometry is
 * wrapped in a throwaway Mesh purely to be serialized. The wrapper holds no
 * material/textures to dispose, and the caller's geometry is never disposed —
 * it stays owned by the caller. `{ binary: true }` makes parse return an
 * DataView over the standard binary STL layout (80-byte header + uint32
 * triangle count + 50 bytes per triangle); we hand back its backing
 * ArrayBuffer.
 */
export const exportStl = (geometry: THREE.BufferGeometry): ArrayBuffer => {
    const mesh = new THREE.Mesh(geometry)
    const view = new STLExporter().parse(mesh, { binary: true })
    return view.buffer
}
