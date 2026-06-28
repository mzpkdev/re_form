import * as THREE from "three"
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"

/**
 * Supported export formats. Only binary STL ships today.
 *
 * `"3mf"` is planned: unlike STL, 3MF carries an explicit units declaration and
 * arbitrary per-object metadata in its XML, so the units/name we already thread
 * through {@link ExportOptions} would become first-class rather than a header
 * convention. No 3MF writer exists yet — this type reserves the surface.
 */
export type ExportFormat = "stl"

/**
 * Forward-looking export knobs. `name` will drive the on-disk filename and,
 * once 3MF lands, the per-object name; `units` records the coordinate unit
 * (millimetres throughout this app). Both are advisory for STL today — the
 * units identifier is stamped into the binary STL header by {@link exportStl}.
 */
export type ExportOptions = { name?: string; units?: "mm" }

/**
 * Free-form 80-byte header stamped at the start of every binary STL we write.
 * Identifies the producer and—critically for a dimensionally-exact part—the
 * coordinate units, since the STL format itself carries none. Kept ASCII and
 * ≤80 bytes so it fits the fixed header without colliding with the triangle
 * count at byte 80.
 */
const STL_HEADER = "hublinator binary STL; units=mm"

/**
 * Binary STL layout: an 80-byte free-form header, then a uint32 triangle count,
 * then 50 bytes per triangle. Only the header is ours to overwrite.
 */
const HEADER_BYTES = 80

/**
 * Triangle count of a BufferGeometry: indexed geometries count index entries,
 * non-indexed ones count raw vertices. Three vertices per triangle either way.
 */
const triangleCount = (geometry: THREE.BufferGeometry): number => {
    const index = geometry.getIndex()
    if (index) {
        return index.count / 3
    }
    const position = geometry.getAttribute("position")
    return position ? position.count / 3 : 0
}

/**
 * Overwrite the 80-byte header of a binary STL buffer in place with `text`
 * (ASCII, NUL-padded, truncated to 80 bytes). Only the header is touched — the
 * triangle count at byte 80 and the triangle data after it are left untouched.
 */
const stampHeader = (buffer: ArrayBuffer, text: string): void => {
    const header = new Uint8Array(buffer, 0, HEADER_BYTES)
    header.fill(0)
    // TextEncoder.encodeInto writes at most `header.length` bytes and never
    // splits past the view, so an over-long header is simply truncated.
    new TextEncoder().encodeInto(text, header)
}

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
 * it stays owned by the caller. `{ binary: true }` makes parse return a
 * DataView over the standard binary STL layout (80-byte header + uint32
 * triangle count + 50 bytes per triangle).
 *
 * Two things happen on top of the raw export:
 *  - Empty geometry (no positions / zero triangles) is rejected up front — an
 *    empty STL is never a valid printable part.
 *  - The 80-byte header is stamped with a producer + units identifier so the
 *    file records that its coordinates are millimetres.
 *
 * `opts` is forward-looking (name/units for 3MF + filename plumbing) and does
 * not change the bytes written today.
 */
export const exportStl = (geometry: THREE.BufferGeometry, _opts?: ExportOptions): ArrayBuffer => {
    if (triangleCount(geometry) === 0) {
        throw new Error("cannot export empty geometry")
    }

    const mesh = new THREE.Mesh(geometry)
    const view = new STLExporter().parse(mesh, { binary: true })

    // The DataView may be a window into a larger backing buffer; slice to the
    // exact STL byte range so the header stamp and the returned buffer cover
    // only the file's own bytes.
    const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    stampHeader(buffer, STL_HEADER)
    return buffer
}

/**
 * Re-parse a binary STL buffer and return its bounding-box SIZE per axis (the
 * part's extent in millimetres). Reads back the bytes we actually wrote, so it
 * reflects the file on disk rather than the in-memory geometry.
 */
export const stlBounds = (buffer: ArrayBuffer): { x: number; y: number; z: number } => {
    const geometry = parseStl(buffer)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3()
    geometry.dispose()
    return { x: size.x, y: size.y, z: size.z }
}

/**
 * Verify an exported STL's dimensions match what was intended, within
 * `epsilon` millimetres per axis. Round-trips through {@link stlBounds} so a
 * `true` result guarantees the bytes on disk encode the intended size — the
 * dimensional-integrity check for a printable part.
 */
export const verifyStlDimensions = (
    buffer: ArrayBuffer,
    expected: { x: number; y: number; z: number },
    epsilon = 0.01
): boolean => {
    const actual = stlBounds(buffer)
    return (
        Math.abs(actual.x - expected.x) <= epsilon &&
        Math.abs(actual.y - expected.y) <= epsilon &&
        Math.abs(actual.z - expected.z) <= epsilon
    )
}
