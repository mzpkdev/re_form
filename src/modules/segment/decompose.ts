import type { Manifold, ManifoldToplevel } from "manifold-3d"
import type * as THREE from "three"
import { geometryToManifold } from "../../lib/model"
import { weldAndAnalyze } from "./mesh"

/**
 * Tier 1 — split a part into separate connected bodies, one triangle-index array
 * per body. The returned indices are in the CANONICAL welded face space, which
 * equals the SOURCE geometry's triangle order: `weldAndAnalyze` welds a
 * position-only clone via `mergeVertices`, preserving triangle count and order
 * 1:1 (welded face `f` ≡ original triangle `f`). So these arrays index the
 * original geometry's faces directly.
 *
 * PRIMARY (always): union-find over `topo.faceAdjacency`. Two faces join when
 * they share a manifold edge (a slot `>= 0`); boundary (`-1`) and non-manifold
 * (`-2`) slots are ignored, so a `-2` edge is a hard boundary that bodies never
 * cross. One connected component = one body. This is exact, indexes canonical
 * faces with no Manifold back-mapping, and works for manifold AND non-manifold
 * input alike.
 *
 * CROSS-CHECK (manifold input only, sanity): when `geometryToManifold` succeeds
 * we call `Manifold.decompose()` and confirm its body count matches the
 * union-find component count, then delete every handle immediately. Manifold
 * canonicalizes triangles, so we deliberately do NOT map its triangles back to
 * source faces — the face sets always come from union-find. When the input is
 * non-manifold (`geometryToManifold` throws `"mesh is not manifold"`) the
 * cross-check is skipped and union-find stands alone.
 */
export const decomposeBodies = (wasm: ManifoldToplevel, geometry: THREE.BufferGeometry): Int32Array[] => {
    const topo = weldAndAnalyze(geometry)
    const { faceCount, faceAdjacency } = topo

    // Union-find over manifold-edge adjacency. Path-compressed find + union by
    // size keeps it near-linear over the F faces.
    const parent = new Int32Array(faceCount)
    const size = new Int32Array(faceCount).fill(1)
    for (let f = 0; f < faceCount; f++) {
        parent[f] = f
    }
    const find = (x: number): number => {
        let root = x
        while (parent[root] !== root) {
            root = parent[root]
        }
        // Path compression: point every node on the walk straight at the root.
        let node = x
        while (parent[node] !== root) {
            const next = parent[node]
            parent[node] = root
            node = next
        }
        return root
    }
    const union = (a: number, b: number): void => {
        const ra = find(a)
        const rb = find(b)
        if (ra === rb) {
            return
        }
        if (size[ra] < size[rb]) {
            parent[ra] = rb
            size[rb] += size[ra]
        } else {
            parent[rb] = ra
            size[ra] += size[rb]
        }
    }

    for (let f = 0; f < faceCount; f++) {
        for (let slot = 0; slot < 3; slot++) {
            const neighbour = faceAdjacency[3 * f + slot]
            // Only manifold edges (a single named neighbour) connect bodies.
            // -1 (boundary) and -2 (non-manifold) are hard boundaries.
            if (neighbour >= 0) {
                union(f, neighbour)
            }
        }
    }

    // Bucket faces by their component root, preserving ascending face order so
    // each returned array is already sorted.
    const buckets = new Map<number, number[]>()
    for (let f = 0; f < faceCount; f++) {
        const root = find(f)
        const bucket = buckets.get(root)
        if (bucket) {
            bucket.push(f)
        } else {
            buckets.set(root, [f])
        }
    }
    const components = Array.from(buckets.values(), (faces) => Int32Array.from(faces))

    // Sanity cross-check on manifold input only: Manifold.decompose() must agree
    // on the BODY COUNT. We never read its triangles (canonicalization makes the
    // back-map unreliable) — face sets come from union-find. Delete every handle
    // immediately so nothing leaks regardless of the assertion outcome.
    let manifold: Manifold | undefined
    try {
        manifold = geometryToManifold(wasm, geometry)
    } catch {
        // Non-manifold input (`"mesh is not manifold"`): skip the cross-check;
        // union-find stands alone.
        manifold = undefined
    }
    if (manifold) {
        const subManifolds = manifold.decompose()
        const manifoldBodyCount = subManifolds.length
        for (const sub of subManifolds) {
            sub.delete()
        }
        manifold.delete()
        if (manifoldBodyCount !== components.length) {
            throw new Error(
                `decomposeBodies: union-find found ${components.length} bodies but Manifold.decompose() found ${manifoldBodyCount}`
            )
        }
    }

    return components
}
