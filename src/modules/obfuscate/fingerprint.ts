import type { Mesh } from "manifold-3d"

/**
 * Visual fingerprint of a mesh — a digest derived from the EXACT data that gets
 * exported (vertex positions + the triangle index list), so it changes if and
 * only if the saved STL would change. This is what lets the panel prove an
 * obfuscate "took": a different sigil means a genuinely different file.
 *
 * Both inputs matter, and each maps to a knob: jitter moves vertices, subdivide
 * adds them (vertProperties), and reorder permutes the triangle list (triVerts,
 * which manifold leaves un-canonicalized). Hashing both catches all three.
 */

const FNV_PRIME = 0x01000193

/** FNV-1a over a byte view, seedable so several independent lanes can be mixed. */
const hashBytes = (bytes: Uint8Array, seed: number): number => {
    let h = seed >>> 0
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i]
        h = Math.imul(h, FNV_PRIME) >>> 0
    }
    return h >>> 0
}

const bytesOf = (a: Float32Array | Uint32Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

/**
 * One 32-bit lane: hash the positions, then continue the same accumulator into
 * the triangle list so triangle order participates in the result rather than
 * being hashed independently.
 */
const lane = (vp: Uint8Array, tv: Uint8Array, seed: number): string =>
    hashBytes(tv, hashBytes(vp, seed)).toString(16).padStart(8, "0")

/**
 * 24-hex-char digest of a mesh (three FNV-1a lanes with distinct seeds).
 * Deterministic, and sensitive to vertex moves, added vertices and triangle
 * reordering/winding alike.
 */
export const meshDigest = (mesh: Pick<Mesh, "vertProperties" | "triVerts">): string => {
    const vp = bytesOf(mesh.vertProperties)
    const tv = bytesOf(mesh.triVerts)
    return lane(vp, tv, 0x811c9dc5) + lane(vp, tv, 0x9e3779b1) + lane(vp, tv, 0x85ebca77)
}

/** A 5×5 left-right-symmetric identicon plus a hue, both derived from a digest. */
export type Identicon = { cells: boolean[]; hue: number }

/**
 * Build a GitHub-style symmetric identicon from a {@link meshDigest}: the first
 * 15 nibbles drive the left three columns (mirrored to five), and a later byte
 * sets the hue. FNV's avalanche means a one-triangle change repaints it.
 */
export const identicon = (digest: string): Identicon => {
    const control: boolean[] = []
    for (let i = 0; i < 15; i++) {
        control.push(Number.parseInt(digest[i], 16) >= 8)
    }
    const cells: boolean[] = new Array(25)
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const mirrored = c < 3 ? c : 4 - c
            cells[r * 5 + c] = control[r * 3 + mirrored]
        }
    }
    const hue = Math.round((Number.parseInt(digest.slice(16, 18), 16) / 255) * 360)
    return { cells, hue }
}
