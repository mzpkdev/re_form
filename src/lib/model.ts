import type { Manifold, ManifoldToplevel, Mesh } from "manifold-3d"
import * as THREE from "three"
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"

export type Vec3 = [number, number, number]

export type Transform = {
    position: Vec3
    rotation: Vec3
    scale: Vec3
}

export const IDENTITY_TRANSFORM: Transform = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
}

/**
 * Convert a manifold Mesh into a three.js BufferGeometry. Copies the
 * interleaved vertex properties down to a tight xyz position buffer (the mesh
 * may carry more than 3 props per vertex), indexes the triangles, and derives
 * vertex normals. This is the single conversion shared by Widget and the
 * transform pipeline.
 */
export const meshToBufferGeometry = (mesh: Mesh): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry()
    const stride = mesh.numProp
    const positions = new Float32Array(mesh.numVert * 3)
    for (let i = 0; i < mesh.numVert; i++) {
        positions[i * 3 + 0] = mesh.vertProperties[i * stride + 0]
        positions[i * 3 + 1] = mesh.vertProperties[i * stride + 1]
        positions[i * 3 + 2] = mesh.vertProperties[i * stride + 2]
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1))
    geometry.computeVertexNormals()
    return geometry
}

/**
 * Build a manifold Manifold from an arbitrary three.js BufferGeometry.
 *
 * STL geometry arrives as a non-indexed triangle soup with duplicate vertices
 * at shared edges, which manifold rejects as non-manifold. We weld first
 * (mergeVertices → indexed) so co-located vertices share an index, then hand
 * the indexed position/index buffers to manifold. The result is validated and,
 * if degenerate, deleted before throwing. The caller owns the returned handle.
 */
export const geometryToManifold = (wasm: ManifoldToplevel, geometry: THREE.BufferGeometry): Manifold => {
    // Weld by POSITION only. mergeVertices keys on every attribute, so normals/
    // UVs that differ at a shared corner (true of box faces and STL output)
    // would keep those vertices split and leave the mesh non-manifold. We strip
    // to a position-only clone first so co-located vertices actually merge.
    const positionOnly = new THREE.BufferGeometry()
    const sourcePosition = geometry.getAttribute("position")
    positionOnly.setAttribute("position", sourcePosition.clone())
    const sourceIndex = geometry.getIndex()
    if (sourceIndex) {
        positionOnly.setIndex(sourceIndex.clone())
    }
    const welded = mergeVertices(positionOnly)
    positionOnly.dispose()

    const position = welded.getAttribute("position")
    const index = welded.getIndex()
    if (!index) {
        welded.dispose()
        throw new Error("mesh is not manifold")
    }
    const mesh = new wasm.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(position.array),
        triVerts: new Uint32Array(index.array)
    })
    welded.dispose()

    // The Manifold constructor throws ManifoldError when the mesh is not
    // watertight; treat that and any degenerate result as a clean failure.
    let manifold: Manifold
    try {
        manifold = new wasm.Manifold(mesh)
    } catch {
        throw new Error("mesh is not manifold")
    }
    if (manifold.isEmpty() || manifold.status() !== "NoError" || manifold.volume() <= 0) {
        manifold.delete()
        throw new Error("mesh is not manifold")
    }
    return manifold
}

/**
 * Apply a TRS transform to a source Manifold and bake it into a fresh
 * BufferGeometry. Order is scale → rotate → translate, matching how a TRS
 * matrix composes. Rotation is in degrees (manifold's convention, applied
 * x→y→z). Every intermediate Manifold is deleted; `source` belongs to the
 * caller and is left intact.
 */
export const transformedGeometry = (source: Manifold, t: Transform): THREE.BufferGeometry => {
    const scaled = source.scale(t.scale)
    const rotated = scaled.rotate(t.rotation)
    const translated = rotated.translate(t.position)
    const mesh = translated.getMesh()
    const geometry = meshToBufferGeometry(mesh)
    scaled.delete()
    rotated.delete()
    translated.delete()
    return geometry
}
