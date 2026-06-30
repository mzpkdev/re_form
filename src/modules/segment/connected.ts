import type { MeshTopology } from "./types"

/**
 * Split a face subset into connected components over `topo.faceAdjacency`,
 * counting an edge **only when BOTH incident faces are in the subset**. This is
 * the coplanar CC-split (§6.5 fix-a): a single infinite-plane RANSAC fit claims
 * every coplanar triangle on the mesh (a top face and a recessed shelf at the
 * same height become one shape), so its inlier triangles are re-grouped here into
 * one component per topologically-connected region, all sharing the plane params
 * but with disjoint triangle lists.
 *
 * The subset is treated as an induced subgraph: two subset faces are linked iff
 * they share a manifold edge (an adjacency slot `>= 0`) AND the neighbour is also
 * in the subset. Boundary (`-1`) and non-manifold (`-2`) slots never link, and an
 * adjacency to a face outside the subset is ignored — so faces that are coplanar
 * but separated by a gap, a hole, or a non-subset face land in different
 * components.
 *
 * Each returned component is a **sorted** `Int32Array`. The components partition
 * the input exactly: they are pairwise disjoint and their union is the input set
 * (deduplicated). Order of the returned components is by ascending smallest
 * member, so the result is deterministic regardless of input order. An empty
 * subset returns `[]`; a fully-connected subset returns a single component.
 *
 * Implemented as iterative BFS over an adjacency-membership test; O(|subset|)
 * with the membership lookup, no recursion (so it is safe on large face sets).
 */
export const connectedComponents = (faces: Int32Array | readonly number[], topo: MeshTopology): Int32Array[] => {
    // Membership of the subset, keyed by face index, so the "both faces in the
    // subset" edge test is O(1). A duplicate face index in the input collapses to
    // one membership entry, so components dedupe the input by construction.
    const inSubset = new Uint8Array(topo.faceCount)
    for (const f of faces) {
        // Guard out-of-range indices defensively; a malformed subset must not
        // index past the adjacency/membership arrays.
        if (f >= 0 && f < topo.faceCount) inSubset[f] = 1
    }

    const visited = new Uint8Array(topo.faceCount)
    const components: Int32Array[] = []

    // Seed BFS from each unvisited subset face in ascending index order, so the
    // emitted components are already ordered by ascending smallest member.
    for (let seed = 0; seed < topo.faceCount; seed++) {
        if (inSubset[seed] === 0 || visited[seed] === 1) continue

        const component: number[] = []
        // Explicit queue (no recursion) — a single growing array with a read head.
        const queue: number[] = [seed]
        visited[seed] = 1
        for (let head = 0; head < queue.length; head++) {
            const f = queue[head]
            component.push(f)
            // Walk the three edge slots of `f`; follow only manifold edges whose
            // neighbour is also in the subset and not yet visited.
            for (let slot = 0; slot < 3; slot++) {
                const neighbour = topo.faceAdjacency[3 * f + slot]
                if (neighbour < 0) continue // -1 boundary / -2 non-manifold edge
                if (inSubset[neighbour] === 0 || visited[neighbour] === 1) continue
                visited[neighbour] = 1
                queue.push(neighbour)
            }
        }

        // BFS visit order is not sorted; sort each component for a stable result.
        component.sort((a, b) => a - b)
        components.push(Int32Array.from(component))
    }

    return components
}
