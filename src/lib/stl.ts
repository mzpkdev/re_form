import type * as THREE from "three"
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
