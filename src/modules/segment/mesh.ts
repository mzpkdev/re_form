import * as THREE from "three"
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { MeshTopology } from "./types"

/**
 * Weld an STL triangle soup by position and derive everything topology-dependent:
 * bbox diagonal `D` (computed FIRST — the weld tolerance is `1e-4 * D`),
 * position-only `mergeVertices` weld, FLAT per-face normals (never the smoothed
 * vertex normals `meshToBufferGeometry` bakes), `edge→faces` then `face→faces`
 * adjacency keyed `min(vi,vj)*V + max(vi,vj)`, and the `dihedral` method. Edges
 * with >2 incident faces are recorded as non-manifold hard boundaries.
 *
 * See `MeshTopology` for the exact `faceAdjacency` slot/sentinel scheme.
 */
export const weldAndAnalyze = (geometry: THREE.BufferGeometry): MeshTopology => {
    // 1. Bbox diagonal D on the RAW geometry — the weld tolerance is a fraction
    // of it, so it must be known before welding.
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new THREE.Box3()
    const D = box.min.distanceTo(box.max)

    // 2. Weld by POSITION only. mergeVertices keys on every attribute, so
    // normals/UVs that differ at a shared corner (STL soup, box faces) would
    // keep co-located vertices split. Strip to a position-only clone first so
    // they actually merge — matching `geometryToManifold` in lib/model.ts.
    const positionOnly = new THREE.BufferGeometry()
    positionOnly.setAttribute("position", geometry.getAttribute("position").clone())
    const sourceIndex = geometry.getIndex()
    if (sourceIndex) {
        positionOnly.setIndex(sourceIndex.clone())
    }
    const welded = mergeVertices(positionOnly, 1e-4 * D)
    positionOnly.dispose()

    const positionAttr = welded.getAttribute("position")
    const positions = new Float32Array(positionAttr.array)
    const indexAttr = welded.getIndex()
    // mergeVertices always returns an indexed geometry; fall back to identity
    // indices defensively so the rest of the pipeline has a valid index buffer.
    const triangles = indexAttr
        ? new Uint32Array(indexAttr.array)
        : Uint32Array.from({ length: positionAttr.count }, (_unused, i) => i)
    welded.dispose()

    const vertexCount = positions.length / 3
    const faceCount = triangles.length / 3

    // 3. Flat per-face unit normals n_f = normalize((b - a) × (c - a)).
    const faceNormals = new Float32Array(faceCount * 3)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (let f = 0; f < faceCount; f++) {
        const i0 = triangles[3 * f] * 3
        const i1 = triangles[3 * f + 1] * 3
        const i2 = triangles[3 * f + 2] * 3
        a.set(positions[i0], positions[i0 + 1], positions[i0 + 2])
        b.set(positions[i1], positions[i1 + 1], positions[i1 + 2])
        c.set(positions[i2], positions[i2 + 1], positions[i2 + 2])
        ab.subVectors(b, a)
        ac.subVectors(c, a)
        n.crossVectors(ab, ac)
        // A zero-length cross product (degenerate triangle) normalizes to (0,0,0).
        n.normalize()
        faceNormals[3 * f] = n.x
        faceNormals[3 * f + 1] = n.y
        faceNormals[3 * f + 2] = n.z
    }

    // 4. Adjacency. Build edge → incident faces, then collapse to face → faces.
    // Each face contributes its three edges in slot order (v0→v1, v1→v2, v2→v0).
    // edgeKey = min(vi,vj) * V + max(vi,vj). We remember, per edge, every
    // (face, slot) that touches it so we can write neighbours back into slots.
    const edgeIncidence = new Map<number, { face: number; slot: number }[]>()
    for (let f = 0; f < faceCount; f++) {
        const v0 = triangles[3 * f]
        const v1 = triangles[3 * f + 1]
        const v2 = triangles[3 * f + 2]
        const edges: [number, number][] = [
            [v0, v1],
            [v1, v2],
            [v2, v0]
        ]
        for (let slot = 0; slot < 3; slot++) {
            const [vi, vj] = edges[slot]
            const lo = vi < vj ? vi : vj
            const hi = vi < vj ? vj : vi
            const key = lo * vertexCount + hi
            const list = edgeIncidence.get(key)
            if (list) {
                list.push({ face: f, slot })
            } else {
                edgeIncidence.set(key, [{ face: f, slot }])
            }
        }
    }

    // -1 = boundary (default); overwritten with the neighbour face for manifold
    // edges and with -2 for non-manifold edges.
    const faceAdjacency = new Int32Array(faceCount * 3).fill(-1)
    const nonManifoldEdges = new Set<number>()
    for (const [key, incident] of edgeIncidence) {
        if (incident.length === 2) {
            // Manifold edge: each side points at the other's face.
            const [p, q] = incident
            faceAdjacency[3 * p.face + p.slot] = q.face
            faceAdjacency[3 * q.face + q.slot] = p.face
        } else if (incident.length > 2) {
            // Non-manifold edge: hard boundary. Record the edge key and mark
            // every incident slot -2 so region growing never crosses it.
            nonManifoldEdges.add(key)
            for (const { face, slot } of incident) {
                faceAdjacency[3 * face + slot] = -2
            }
        }
        // length === 1 → boundary edge; the slot stays -1.
    }

    // 5. Unsigned dihedral angle between two faces' flat normals.
    const dihedral = (faceA: number, faceB: number): number => {
        const dot =
            faceNormals[3 * faceA] * faceNormals[3 * faceB] +
            faceNormals[3 * faceA + 1] * faceNormals[3 * faceB + 1] +
            faceNormals[3 * faceA + 2] * faceNormals[3 * faceB + 2]
        return Math.acos(Math.min(1, Math.max(-1, dot)))
    }

    return {
        positions,
        triangles,
        faceNormals,
        faceCount,
        vertexCount,
        D,
        faceAdjacency,
        nonManifoldEdges,
        dihedral
    }
}
