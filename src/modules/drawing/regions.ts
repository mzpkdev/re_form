import { inferPlane } from "./extrude"
import { projectPoint } from "./project"
import type { Drawing, Entity, Plane, Vec2 } from "./types"

/**
 * Closed-region detection: the pure core that turns a 2D drawing into the set of
 * closed loops the Editor view extrudes into solids. A region is either a single
 * CLOSED polyline (an explicit, self-declared loop) or a loop ASSEMBLED from
 * separate lines/open polylines that meet end-to-end — so the user is not forced
 * to draw a profile with one tool. React-free; the only inputs are the immutable
 * `Drawing` and its plain geometry.
 *
 * Algorithm:
 *   1. Bucket entities by the principal plane they lie on (`inferPlane`), skipping
 *      anything off a principal plane or with no straight segments (circle/arc).
 *   2. A CLOSED polyline already names its own contour, so it is emitted as a
 *      region directly (its projected points) and does NOT enter the shared graph.
 *      This is what lets two closed profiles that share an edge on one plane (two
 *      stacked rectangles in a top view, say) both be detected — dissolving them
 *      into one graph would raise their shared nodes past degree 2 and disqualify
 *      BOTH.
 *   3. The remaining entities (lines + open polylines) per plane build an
 *      undirected graph: nodes are unique 2D points (grid-snapped, so equal
 *      coordinates are EXACT — keyed by a rounded "x,y" string); edges are the
 *      segments (a line → one a–b; an open polyline → consecutive pairs).
 *   4. A connected component in which EVERY node has degree exactly 2 is a single
 *      closed loop — walked into an ordered contour. Components with any node of
 *      degree ≠ 2 (open paths, dangling spurs, branches, junctions) are skipped.
 *
 * KNOWN LIMITATION (deferred): a stray segment touching a loop ASSEMBLED from open
 * segments still pushes a node's degree past 2, so that loop is skipped — a
 * self-declared closed polyline is immune to this (step 2). Nested loops (holes)
 * remain out of scope: each loop is its own filled region, with no subtraction.
 */

/** How precisely a node coordinate is rounded before it becomes a graph key. */
const KEY_DECIMALS = 6

/** A stable string key for a 2D point. Grid-snapped points compare exactly. */
const keyOf = (p: Vec2): string => `${p[0].toFixed(KEY_DECIMALS)},${p[1].toFixed(KEY_DECIMALS)}`

/** Undirected key for a 2D segment — its two endpoint keys, order-independent. */
const edgeKey = (a: Vec2, b: Vec2): string => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/** A graph node: its 2D coordinate plus the keys of every node it connects to. */
interface Node {
    point: Vec2
    /** Keys of adjacent nodes (a Set, so a duplicate segment counts once). */
    neighbors: Set<string>
}

/** Find or create the node for `point`, returning its key. */
const ensureNode = (nodes: Map<string, Node>, point: Vec2): string => {
    const key = keyOf(point)
    if (!nodes.has(key)) {
        nodes.set(key, { point, neighbors: new Set() })
    }
    return key
}

/** Add an undirected edge between two 2D points to the plane's graph. */
const addEdge = (nodes: Map<string, Node>, a: Vec2, b: Vec2): void => {
    const ka = ensureNode(nodes, a)
    const kb = ensureNode(nodes, b)
    if (ka === kb) return // a degenerate zero-length segment is not an edge
    const na = nodes.get(ka)
    const nb = nodes.get(kb)
    if (!na || !nb) return
    na.neighbors.add(kb)
    nb.neighbors.add(ka)
}

/**
 * The straight 2D segments an entity contributes on `plane`, projected into that
 * plane's view space. A line yields one segment; a polyline yields consecutive
 * pairs, plus the closing last→first pair when `closed`. Returns an empty list for
 * entities with no straight segments (circle, arc) — those are not connected-line
 * geometry.
 */
const entitySegments = (entity: Entity, plane: Plane): [Vec2, Vec2][] => {
    if (entity.type === "line") {
        return [[projectPoint(entity.a, plane), projectPoint(entity.b, plane)]]
    }
    if (entity.type === "polyline") {
        const pts = entity.points.map((p) => projectPoint(p, plane))
        const segs: [Vec2, Vec2][] = []
        for (let i = 0; i + 1 < pts.length; i++) {
            segs.push([pts[i], pts[i + 1]])
        }
        if (entity.closed && pts.length > 2) {
            segs.push([pts[pts.length - 1], pts[0]])
        }
        return segs
    }
    return []
}

/** The world-space points that decide which principal plane an entity lies on. */
const planePoints = (entity: Entity) => {
    if (entity.type === "line") return [entity.a, entity.b]
    if (entity.type === "polyline") return entity.points
    return null
}

/**
 * Walk a connected, all-degree-2 component into an ordered contour. Starts at
 * `startKey` and always steps to the neighbor it did not just come from; since
 * every node has exactly two neighbors, the walk is unambiguous and returns to the
 * start after visiting each node once. The returned contour lists each node once,
 * in loop order (no repeated closing point).
 */
const walkLoop = (nodes: Map<string, Node>, startKey: string): Vec2[] => {
    const contour: Vec2[] = []
    let prevKey: string | null = null
    let currentKey: string = startKey
    do {
        const node = nodes.get(currentKey)
        if (!node) break
        contour.push(node.point)
        const [a, b] = [...node.neighbors]
        const nextKey = a === prevKey ? b : a
        prevKey = currentKey
        currentKey = nextKey
    } while (currentKey !== startKey && contour.length <= nodes.size)
    return contour
}

/**
 * Split a plane's graph into connected components (returns the node keys of each).
 */
const components = (nodes: Map<string, Node>): string[][] => {
    const seen = new Set<string>()
    const out: string[][] = []
    for (const startKey of nodes.keys()) {
        if (seen.has(startKey)) continue
        const comp: string[] = []
        const stack = [startKey]
        seen.add(startKey)
        while (stack.length > 0) {
            const key = stack.pop()
            if (key === undefined) break
            comp.push(key)
            const node = nodes.get(key)
            if (!node) continue
            for (const neighbor of node.neighbors) {
                if (!seen.has(neighbor)) {
                    seen.add(neighbor)
                    stack.push(neighbor)
                }
            }
        }
        out.push(comp)
    }
    return out
}

/**
 * Detect every closed region in `doc`: each is a closed loop of connected
 * straight segments lying on a principal plane, returned as the plane it lives on
 * plus its ordered 2D contour (view space, one point per corner, no repeated
 * closing point). Open paths, dangling spurs, branches, and junctions are not
 * regions and are skipped; curves (circle/arc) do not participate. The order of
 * regions is not significant.
 */
export const detectRegions = (doc: Drawing): { plane: Plane; contour: Vec2[] }[] => {
    const regions: { plane: Plane; contour: Vec2[] }[] = []

    // Bucket the GRAPH-fed entities (lines + open polylines) by plane. A closed
    // polyline names its own loop, so it is emitted as a region directly and kept
    // out of the shared graph (so it can't be disqualified by — or disqualify — a
    // neighbour sharing one of its edges).
    const byPlane = new Map<Plane, Entity[]>()
    for (const entity of doc.entities) {
        const pts = planePoints(entity)
        if (!pts) continue
        const plane = inferPlane(pts)
        if (!plane) continue
        if (entity.type === "polyline" && entity.closed) {
            if (entity.points.length >= 3) {
                regions.push({ plane, contour: entity.points.map((p) => projectPoint(p, plane)) })
            }
            continue
        }
        const bucket = byPlane.get(plane)
        if (bucket) {
            bucket.push(entity)
        } else {
            byPlane.set(plane, [entity])
        }
    }

    // Assemble loops from the connected straight segments left on each plane.
    for (const [plane, entities] of byPlane) {
        const nodes = new Map<string, Node>()
        for (const entity of entities) {
            for (const [a, b] of entitySegments(entity, plane)) {
                addEdge(nodes, a, b)
            }
        }
        for (const comp of components(nodes)) {
            // A single closed loop: at least 3 nodes, every node degree exactly 2.
            if (comp.length < 3) continue
            const allDegreeTwo = comp.every((key) => nodes.get(key)?.neighbors.size === 2)
            if (!allDegreeTwo) continue
            const contour = walkLoop(nodes, comp[0])
            // Guard: a well-formed loop visits every node in the component exactly
            // once. Anything else (an impossible shape) is not emitted.
            if (contour.length !== comp.length) continue
            regions.push({ plane, contour })
        }
    }
    return regions
}

/**
 * Classify which line/polyline entities BREAK the 3D reconstruction: the ones
 * carrying a straight segment that does not bound any detected closed region.
 * The Editor reconstructs solids only from closed loops (`detectRegions`), so
 * every other straight segment is dead geometry the build silently drops — and
 * worse, a single stray segment touching a loop ASSEMBLED from open segments
 * raises a node's degree past 2 and disqualifies the whole loop, turning a
 * would-be face into nothing. Surfacing these lets the UI flag exactly what to fix.
 *
 * An entity id is returned when the entity is a line or polyline AND either:
 *   - it lies on no principal plane (skew — it can never be an orthographic
 *     view), or
 *   - any of its projected segments is not an edge of a detected region.
 *
 * Curves (circle/arc) carry no straight segments and are never classified — they
 * are not "lines". A degenerate single-point polyline draws and breaks nothing.
 * Pure: the only inputs are the immutable `Drawing` and its geometry.
 */
export const detectBrokenEntities = (doc: Drawing): Set<string> => {
    // The segments that DO bound a closed region — the silhouette geometry the
    // reconstruction can actually use. Everything else is dead.
    const goodEdges = new Set<string>()
    for (const { contour } of detectRegions(doc)) {
        for (let i = 0; i < contour.length; i++) {
            goodEdges.add(edgeKey(contour[i], contour[(i + 1) % contour.length]))
        }
    }

    const broken = new Set<string>()
    for (const entity of doc.entities) {
        const pts = planePoints(entity)
        if (!pts) continue // curves have no straight segments — never "lines"
        const plane = inferPlane(pts)
        if (!plane) {
            broken.add(entity.id) // skew: cannot be an orthographic view at all
            continue
        }
        const segments = entitySegments(entity, plane)
        if (segments.length === 0) continue // a 1-point polyline breaks nothing
        if (segments.some(([a, b]) => !goodEdges.has(edgeKey(a, b)))) {
            broken.add(entity.id)
        }
    }
    return broken
}
