import * as THREE from "three"

/**
 * Extract the triangles at `indices` from a NON-INDEXED source geometry into a
 * fresh NON-INDEXED `BufferGeometry` (triangle soup), in the order given.
 *
 * MEMBERSHIP INVARIANT: `indices` are triangle indices in the ORIGINAL imported
 * geometry's triangle order — the same order `ShapeGroup.triangleIndices` use.
 * Welding (`weldAndAnalyze`) preserves triangle count + order 1:1, so welded face
 * `f` ≡ original triangle `f`. `source` is that original non-indexed geometry, so
 * triangle `f` occupies position floats `[9f, 9f+9)`; this copies those 9 floats
 * per index verbatim. Output positions length is exactly `indices.length * 9`.
 *
 * The result carries only a `position` attribute (no index) — the same shape as
 * {@link parseStl}'s output — with `computeVertexNormals()` applied so it shades
 * correctly. `source` is never mutated (positions are copied out of its buffer).
 * Empty `indices` yields an empty geometry rather than throwing.
 *
 * Dependency-free and exact: reused by the segment viewport (M1.3b) and export
 * (M1.4), where the copied triangles must match the source bit-for-bit.
 */
export const triangleIndicesToGeometry = (
    source: THREE.BufferGeometry,
    indices: Int32Array | readonly number[]
): THREE.BufferGeometry => {
    const sourcePositions = source.getAttribute("position").array
    const out = new Float32Array(indices.length * 9)

    for (let i = 0; i < indices.length; i++) {
        // Triangle `f` occupies the 9 contiguous floats [9f, 9f+9) in both arrays.
        const src = indices[i] * 9
        out.set(sourcePositions.subarray(src, src + 9), i * 9)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(out, 3))
    geometry.computeVertexNormals()
    return geometry
}
