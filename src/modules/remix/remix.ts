import * as THREE from "three"
import { parseStl } from "../../lib/stl"

/**
 * Options for {@link remixGeometry}. Every op is opt-in (or has a no-op
 * default) so callers dial in exactly how much the mesh is remixed. A fixed
 * {@link RemixOptions.seed} makes the whole pipeline deterministic.
 */
export type RemixOptions = {
    /** Shuffle triangle order + rotate winding (default true). */
    reorder?: boolean
    /** Number of 1→4 midpoint-split passes (default 0). */
    subdivide?: number
    /** Max per-vertex displacement in model units (default 0). */
    jitter?: number
    /** PRNG seed for determinism (default 1). */
    seed?: number
}

/** A single vertex position in model space. */
type Vertex = [number, number, number]

/** A triangle is three corner vertices, winding-ordered. */
type Triangle = [Vertex, Vertex, Vertex]

/**
 * mulberry32 — a tiny, fast, seedable PRNG. Returns a function yielding floats
 * in [0, 1). Used everywhere instead of Math.random so the remix is
 * reproducible from `seed` alone.
 */
const makeRng = (seed: number) => () => {
    seed += 0x6d2b79f5
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Read the non-indexed position attribute into a flat triangle list. */
const toTriangles = (geometry: THREE.BufferGeometry): Triangle[] => {
    const position = geometry.getAttribute("position")
    const array = position.array
    const triangles: Triangle[] = []
    for (let i = 0; i < array.length; i += 9) {
        triangles.push([
            [array[i], array[i + 1], array[i + 2]],
            [array[i + 3], array[i + 4], array[i + 5]],
            [array[i + 6], array[i + 7], array[i + 8]]
        ])
    }
    return triangles
}

/** Build a fresh non-indexed BufferGeometry from a triangle list. */
const fromTriangles = (triangles: Triangle[]): THREE.BufferGeometry => {
    const array = new Float32Array(triangles.length * 9)
    let o = 0
    for (const [v0, v1, v2] of triangles) {
        array[o++] = v0[0]
        array[o++] = v0[1]
        array[o++] = v0[2]
        array[o++] = v1[0]
        array[o++] = v1[1]
        array[o++] = v1[2]
        array[o++] = v2[0]
        array[o++] = v2[1]
        array[o++] = v2[2]
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(array, 3))
    return geometry
}

/** Midpoint of two vertices — lies on the flat triangle, so adds no shape. */
const midpoint = (a: Vertex, b: Vertex): Vertex => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

/**
 * Split every triangle into 4 by its edge midpoints. The surface is unchanged
 * (midpoints are coplanar with the parent), but the triangle count quadruples
 * per pass — giving jitter/reorder finer geometry to act on.
 */
const subdividePass = (triangles: Triangle[]): Triangle[] => {
    const out: Triangle[] = []
    for (const [v0, v1, v2] of triangles) {
        const m01 = midpoint(v0, v1)
        const m12 = midpoint(v1, v2)
        const m20 = midpoint(v2, v0)
        out.push([v0, m01, m20], [m01, v1, m12], [m20, m12, v2], [m01, m12, m20])
    }
    return out
}

/** Quantized position key — welds vertices that round to the same coordinate. */
const vertexKey = (v: Vertex): string => `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`

/**
 * Displace vertices by up to `amplitude` while staying watertight. Coincident
 * corners (welded by rounded position) share one random displacement, so seams
 * move together and the mesh never cracks. Mutates the corners in place.
 */
const applyJitter = (triangles: Triangle[], amplitude: number, rng: () => number): void => {
    const displacements = new Map<string, Vertex>()
    const displacementFor = (v: Vertex): Vertex => {
        const key = vertexKey(v)
        let d = displacements.get(key)
        if (!d) {
            d = [(rng() * 2 - 1) * amplitude, (rng() * 2 - 1) * amplitude, (rng() * 2 - 1) * amplitude]
            displacements.set(key, d)
        }
        return d
    }
    for (const triangle of triangles) {
        for (const v of triangle) {
            const d = displacementFor(v)
            v[0] += d[0]
            v[1] += d[1]
            v[2] += d[2]
        }
    }
}

/**
 * Shuffle triangle order (Fisher–Yates) and rotate each triangle's winding by
 * one step (v0,v1,v2)→(v1,v2,v0). The rotation preserves orientation (and thus
 * the recomputed normal) but changes the byte layout. Mutates the array.
 */
const applyReorder = (triangles: Triangle[], rng: () => number): void => {
    for (let i = triangles.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        const tmp = triangles[i]
        triangles[i] = triangles[j]
        triangles[j] = tmp
    }
    for (let i = 0; i < triangles.length; i++) {
        const [v0, v1, v2] = triangles[i]
        triangles[i] = [v1, v2, v0]
    }
}

/**
 * Apply the remix ops and return a new non-indexed geometry. Pure: the input
 * geometry is never mutated. Deterministic given `seed`.
 *
 * Op order is subdivide → jitter → reorder, so jitter and reorder act on the
 * final, subdivided triangle set and the cheap reorder runs last.
 */
export const remixGeometry = (geometry: THREE.BufferGeometry, opts?: RemixOptions): THREE.BufferGeometry => {
    const { reorder = true, subdivide = 0, jitter = 0, seed = 1 } = opts ?? {}
    const rng = makeRng(seed)

    let triangles = toTriangles(geometry)
    for (let pass = 0; pass < subdivide; pass++) {
        triangles = subdividePass(triangles)
    }
    if (jitter > 0) {
        applyJitter(triangles, jitter, rng)
    }
    if (reorder) {
        applyReorder(triangles, rng)
    }
    return fromTriangles(triangles)
}

/** Unit-length face normal from a triangle's winding: (v1-v0)×(v2-v0). */
const faceNormal = (v0: Vertex, v1: Vertex, v2: Vertex): Vertex => {
    const ax = v1[0] - v0[0]
    const ay = v1[1] - v0[1]
    const az = v1[2] - v0[2]
    const bx = v2[0] - v0[0]
    const by = v2[1] - v0[1]
    const bz = v2[2] - v0[2]
    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz)
    if (len === 0) {
        return [0, 0, 0]
    }
    return [nx / len, ny / len, nz / len]
}

/**
 * Serialize a geometry to a binary STL ArrayBuffer. Layout: 80-byte zero
 * header, uint32 triangle count, then 50 bytes per triangle (normal + 3 verts
 * as little-endian float32, then a uint16 attribute count of 0). Each normal is
 * recomputed from the triangle's verts rather than read from any attribute.
 */
export const geometryToBinaryStl = (geometry: THREE.BufferGeometry): ArrayBuffer => {
    const triangles = toTriangles(geometry)
    const buffer = new ArrayBuffer(84 + triangles.length * 50)
    const view = new DataView(buffer)
    view.setUint32(80, triangles.length, true)
    let offset = 84
    for (const [v0, v1, v2] of triangles) {
        const [nx, ny, nz] = faceNormal(v0, v1, v2)
        view.setFloat32(offset, nx, true)
        view.setFloat32(offset + 4, ny, true)
        view.setFloat32(offset + 8, nz, true)
        view.setFloat32(offset + 12, v0[0], true)
        view.setFloat32(offset + 16, v0[1], true)
        view.setFloat32(offset + 20, v0[2], true)
        view.setFloat32(offset + 24, v1[0], true)
        view.setFloat32(offset + 28, v1[1], true)
        view.setFloat32(offset + 32, v1[2], true)
        view.setFloat32(offset + 36, v2[0], true)
        view.setFloat32(offset + 40, v2[1], true)
        view.setFloat32(offset + 44, v2[2], true)
        view.setUint16(offset + 48, 0, true)
        offset += 50
    }
    return buffer
}

/** Convenience: parse STL bytes → remix the geometry → serialize to binary STL. */
export const remixStl = (input: ArrayBuffer, opts?: RemixOptions): ArrayBuffer =>
    geometryToBinaryStl(remixGeometry(parseStl(input), opts))
