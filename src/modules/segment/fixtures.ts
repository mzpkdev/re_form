import * as THREE from "three"

/**
 * React-free, in-code geometry builders for segment specs. Each returns a
 * NON-INDEXED `THREE.BufferGeometry` — a triangle soup with a `position`
 * attribute only — exactly matching `parseStl`'s output shape (`src/lib/stl.ts`),
 * so segmentation code (weld, adjacency, sampling, decompose) is exercised on the
 * same kind of input it sees in production. No files, no fetch: every fixture is
 * built from explicit coordinates so the geometry under test is fully known.
 *
 * Winding is counter-clockwise when viewed from OUTSIDE the solid (outward face
 * normal), so `(b-a) × (c-a)` points out — the convention the flat-normal and
 * manifold paths expect.
 */

/** A point in 3-space. */
type Vec3 = [number, number, number]

/**
 * Build a non-indexed `BufferGeometry` from a flat list of triangle-soup
 * positions (xyz per vertex, 3 vertices per triangle, length a multiple of 9).
 */
const geometryFromPositions = (positions: ArrayLike<number>): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3))
    return geometry
}

/** Push the two triangles of a planar quad `a→b→c→d` (CCW from outside) as a soup. */
const pushQuad = (out: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3): void => {
    out.push(...a, ...b, ...c)
    out.push(...a, ...c, ...d)
}

/** Push a single triangle `a→b→c` as a soup. */
const pushTri = (out: number[], a: Vec3, b: Vec3, c: Vec3): void => {
    out.push(...a, ...b, ...c)
}

/**
 * Append an axis-aligned box of the given half-extents centred at `cx,cy,cz`,
 * outward-wound, to `out`. Shared by `cube`, `twoDisjointCubes` and the plate
 * builders so every box uses one correct winding.
 */
const pushBox = (out: number[], cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void => {
    const x0 = cx - hx
    const x1 = cx + hx
    const y0 = cy - hy
    const y1 = cy + hy
    const z0 = cz - hz
    const z1 = cz + hz
    // +Z (front) and -Z (back)
    pushQuad(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
    pushQuad(out, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0])
    // +X (right) and -X (left)
    pushQuad(out, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1])
    pushQuad(out, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0])
    // +Y (top) and -Y (bottom)
    pushQuad(out, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0])
    pushQuad(out, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1])
}

/**
 * Axis-aligned cube centred at the origin. 12 triangles, 6 flat faces — the
 * canonical "6 planes / 6 patches" fixture. `size` is the full edge length.
 */
export const cube = (size = 1): THREE.BufferGeometry => {
    const h = size / 2
    const out: number[] = []
    pushBox(out, 0, 0, 0, h, h, h)
    return geometryFromPositions(out)
}

/**
 * Two axis-aligned cubes of the given `size`, separated by `gap` along X, baked
 * into ONE geometry. Welds into a single non-manifold-free mesh with two
 * disconnected components — the Tier-1 decompose / union-find fixture (→ 2
 * bodies).
 */
export const twoDisjointCubes = (size = 1, gap = 1): THREE.BufferGeometry => {
    const h = size / 2
    const offset = h + gap / 2
    const out: number[] = []
    pushBox(out, -offset, 0, 0, h, h, h)
    pushBox(out, offset, 0, 0, h, h, h)
    return geometryFromPositions(out)
}

/**
 * A rectangular plate (full extents `width × depth`, thickness `height` centred
 * on the XZ plane in Y) with a cylindrical through-hole of `radius` down the Y
 * axis, approximated with `segments` facets. Top and bottom become annulus rings,
 * the outer boundary becomes 4 walls, and the hole contributes an inward-facing
 * cylinder wall — the "planes + 1 cylinder" fixture.
 */
export const plateWithHole = (width = 4, depth = 4, height = 1, radius = 0.8, segments = 24): THREE.BufferGeometry => {
    const hw = width / 2
    const hd = depth / 2
    const hh = height / 2
    const out: number[] = []

    // Outer side walls of the plate.
    pushQuad(out, [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]) // +Z
    pushQuad(out, [hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]) // -Z
    pushQuad(out, [hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]) // +X
    pushQuad(out, [-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]) // -X

    // Top (y=+hh) and bottom (y=-hh) annulus rings + the hole's cylinder wall.
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2
        const a1 = ((i + 1) / segments) * Math.PI * 2
        const c0: Vec3 = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius]
        const c1: Vec3 = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius]

        // The outer-rectangle corner nearest each hole point, so the annulus
        // tessellation stays inside the plate footprint.
        const r0: Vec3 = [Math.sign(c0[0]) * hw || hw, 0, Math.sign(c0[2]) * hd || hd]
        const r1: Vec3 = [Math.sign(c1[0]) * hw || hw, 0, Math.sign(c1[2]) * hd || hd]

        // Top ring (normal +Y): outer CCW from above.
        pushTri(out, [r0[0], hh, r0[2]], [r1[0], hh, r1[2]], [c1[0], hh, c1[2]])
        pushTri(out, [r0[0], hh, r0[2]], [c1[0], hh, c1[2]], [c0[0], hh, c0[2]])
        // Bottom ring (normal -Y): reversed winding.
        pushTri(out, [r1[0], -hh, r1[2]], [r0[0], -hh, r0[2]], [c0[0], -hh, c0[2]])
        pushTri(out, [r1[0], -hh, r1[2]], [c0[0], -hh, c0[2]], [c1[0], -hh, c1[2]])

        // Inward-facing cylinder wall of the bore (normal points toward axis).
        pushQuad(out, [c1[0], -hh, c1[2]], [c0[0], -hh, c0[2]], [c0[0], hh, c0[2]], [c1[0], hh, c1[2]])
    }
    return geometryFromPositions(out)
}

/**
 * Two coplanar-oriented squares (each `size × size`, lying in an XZ plane, normal
 * +Y) at DIFFERENT heights `y0` and `y1` and offset along X so they are disjoint.
 * Region growing / connected-components must keep them as two groups even though
 * they share an orientation — the "CC split" fixture. Each square is a single-
 * sided quad (2 triangles).
 */
export const twoCoplanarSquares = (size = 1, y0 = 0, y1 = 1, gap = 1): THREE.BufferGeometry => {
    const h = size / 2
    const offset = h + gap / 2
    const out: number[] = []
    const square = (cx: number, y: number): void => {
        pushQuad(out, [cx - h, y, h], [cx + h, y, h], [cx + h, y, -h], [cx - h, y, -h])
    }
    square(-offset, y0)
    square(offset, y1)
    return geometryFromPositions(out)
}

/**
 * A closed circular cylinder along the Y axis: `segments`-faceted side wall plus
 * a top and bottom cap (triangle fans). `radius`, full `height`. The
 * "1 cylinder + 2 caps" fixture.
 */
export const cylinder = (radius = 1, height = 2, segments = 24): THREE.BufferGeometry => {
    const hh = height / 2
    const out: number[] = []
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2
        const a1 = ((i + 1) / segments) * Math.PI * 2
        const x0 = Math.cos(a0) * radius
        const z0 = Math.sin(a0) * radius
        const x1 = Math.cos(a1) * radius
        const z1 = Math.sin(a1) * radius
        // Outward-facing side wall.
        pushQuad(out, [x0, -hh, z0], [x1, -hh, z1], [x1, hh, z1], [x0, hh, z0])
        // Top cap (normal +Y) and bottom cap (normal -Y).
        pushTri(out, [0, hh, 0], [x0, hh, z0], [x1, hh, z1])
        pushTri(out, [0, -hh, 0], [x1, -hh, z1], [x0, -hh, z0])
    }
    return geometryFromPositions(out)
}

/**
 * A UV sphere of `radius` centred at the origin, `widthSegments × heightSegments`
 * facets, outward-wound. Poles use triangle fans, mid-bands use quads. The single
 * "1 sphere" fixture.
 */
export const sphere = (radius = 1, widthSegments = 16, heightSegments = 12): THREE.BufferGeometry => {
    const out: number[] = []
    const point = (iLat: number, iLon: number): Vec3 => {
        const phi = (iLat / heightSegments) * Math.PI // 0..π, 0 = +Y pole
        const theta = (iLon / widthSegments) * Math.PI * 2
        const sinPhi = Math.sin(phi)
        return [radius * sinPhi * Math.cos(theta), radius * Math.cos(phi), radius * sinPhi * Math.sin(theta)]
    }
    for (let lat = 0; lat < heightSegments; lat++) {
        for (let lon = 0; lon < widthSegments; lon++) {
            const a = point(lat, lon)
            const b = point(lat + 1, lon)
            const c = point(lat + 1, lon + 1)
            const d = point(lat, lon + 1)
            if (lat === 0) {
                pushTri(out, a, b, c) // north cap
            } else if (lat === heightSegments - 1) {
                pushTri(out, a, b, d) // south cap
            } else {
                pushQuad(out, a, b, c, d)
            }
        }
    }
    return geometryFromPositions(out)
}

/**
 * A plate (full extents `width × width`, thickness `height`) with a countersunk
 * hole down the Y axis: a conical entry (radius `coneRadius` at the top tapering
 * to `boreRadius`) leading into a straight cylindrical bore, both `segments`-
 * faceted. Exercises cone-vs-patch handling (the conical part) plus a cylinder.
 */
export const countersunkHole = (
    width = 4,
    height = 2,
    coneRadius = 1.2,
    boreRadius = 0.6,
    segments = 24
): THREE.BufferGeometry => {
    const hw = width / 2
    const hh = height / 2
    const coneBottomY = hh - (coneRadius - boreRadius) // 45° countersink
    const out: number[] = []

    // Outer side walls.
    pushQuad(out, [-hw, -hh, hw], [hw, -hh, hw], [hw, hh, hw], [-hw, hh, hw])
    pushQuad(out, [hw, -hh, -hw], [-hw, -hh, -hw], [-hw, hh, -hw], [hw, hh, -hw])
    pushQuad(out, [hw, -hh, hw], [hw, -hh, -hw], [hw, hh, -hw], [hw, hh, hw])
    pushQuad(out, [-hw, -hh, -hw], [-hw, -hh, hw], [-hw, hh, hw], [-hw, hh, -hw])

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2
        const a1 = ((i + 1) / segments) * Math.PI * 2
        const cone0: Vec3 = [Math.cos(a0) * coneRadius, hh, Math.sin(a0) * coneRadius]
        const cone1: Vec3 = [Math.cos(a1) * coneRadius, hh, Math.sin(a1) * coneRadius]
        const bore0Top: Vec3 = [Math.cos(a0) * boreRadius, coneBottomY, Math.sin(a0) * boreRadius]
        const bore1Top: Vec3 = [Math.cos(a1) * boreRadius, coneBottomY, Math.sin(a1) * boreRadius]
        const bore0Bot: Vec3 = [Math.cos(a0) * boreRadius, -hh, Math.sin(a0) * boreRadius]
        const bore1Bot: Vec3 = [Math.cos(a1) * boreRadius, -hh, Math.sin(a1) * boreRadius]

        // Top annulus from the outer rectangle corner to the cone mouth.
        const r0: Vec3 = [Math.sign(cone0[0]) * hw || hw, hh, Math.sign(cone0[2]) * hw || hw]
        const r1: Vec3 = [Math.sign(cone1[0]) * hw || hw, hh, Math.sign(cone1[2]) * hw || hw]
        pushTri(out, r0, r1, cone1)
        pushTri(out, r0, cone1, cone0)

        // Conical countersink wall (mouth → bore top).
        pushQuad(out, cone1, cone0, bore0Top, bore1Top)
        // Straight bore wall (bore top → bottom).
        pushQuad(out, bore1Top, bore0Top, bore0Bot, bore1Bot)
        // Bottom annulus around the bore exit.
        const b0: Vec3 = [Math.sign(bore0Bot[0]) * hw || hw, -hh, Math.sign(bore0Bot[2]) * hw || hw]
        const b1: Vec3 = [Math.sign(bore1Bot[0]) * hw || hw, -hh, Math.sign(bore1Bot[2]) * hw || hw]
        pushTri(out, b1, b0, bore0Bot)
        pushTri(out, b1, bore0Bot, bore1Bot)
    }
    return geometryFromPositions(out)
}

/**
 * A cube with one edge (the +X/+Y edge) cut back by a 45° chamfer, adding a
 * narrow angled face between the top and right faces. Exercises a chamfer landing
 * as its own plane/patch distinct from the faces it bevels. `size` = base edge,
 * `chamfer` = how far the cut bites into each adjacent face.
 */
export const chamferedCube = (size = 2, chamfer = 0.4): THREE.BufferGeometry => {
    const h = size / 2
    const c = chamfer
    const out: number[] = []

    // The chamfer replaces the +X/+Y edge: the top face stops at x = h - c and
    // the right face stops at y = h - c, joined by one bevel quad. Z spans ±h.
    // Bottom, back(-Z is via box faces below) etc. stay full.

    // -Z and +Z faces (pentagons → fan from a base corner).
    const faceZ = (z: number, front: boolean): void => {
        // Pentagon corners CCW (from outside): the chamfer clips the +X/+Y corner.
        const p: Vec3[] = [
            [-h, -h, z],
            [h, -h, z],
            [h, h - c, z],
            [h - c, h, z],
            [-h, h, z]
        ]
        if (front) {
            pushTri(out, p[0], p[1], p[2])
            pushTri(out, p[0], p[2], p[3])
            pushTri(out, p[0], p[3], p[4])
        } else {
            pushTri(out, p[0], p[2], p[1])
            pushTri(out, p[0], p[3], p[2])
            pushTri(out, p[0], p[4], p[3])
        }
    }
    faceZ(h, true) // +Z
    faceZ(-h, false) // -Z

    // -X (left, full) and -Y (bottom, full).
    pushQuad(out, [-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h])
    pushQuad(out, [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h])

    // +X (right) clipped to y ≤ h - c.
    pushQuad(out, [h, -h, h], [h, -h, -h], [h, h - c, -h], [h, h - c, h])
    // +Y (top) clipped to x ≤ h - c.
    pushQuad(out, [-h, h, h], [h - c, h, h], [h - c, h, -h], [-h, h, -h])
    // The 45° bevel joining them.
    pushQuad(out, [h, h - c, h], [h, h - c, -h], [h - c, h, -h], [h - c, h, h])

    return geometryFromPositions(out)
}

/**
 * A single zero-area (degenerate) triangle — three collinear points. Feeds the
 * "degenerate input routes to `unknown`, never crashes" path. Its face normal is
 * undefined (cross product is the zero vector); callers must tolerate that.
 */
export const degenerate = (): THREE.BufferGeometry => geometryFromPositions([0, 0, 0, 1, 0, 0, 2, 0, 0])

/**
 * A cube with ONE face (the +Z face) removed — an open shell. Welds fine by
 * position, but the boundary edges of the hole have a single incident face, so
 * `geometryToManifold` throws `"mesh is not manifold"`. This is the fixture that
 * forces the Tier-1 union-find fallback. `size` = full edge length.
 */
export const nonManifoldShell = (size = 1): THREE.BufferGeometry => {
    const h = size / 2
    const out: number[] = []
    // All cube faces EXCEPT +Z.
    pushQuad(out, [h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]) // -Z
    pushQuad(out, [h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]) // +X
    pushQuad(out, [-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]) // -X
    pushQuad(out, [-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]) // +Y
    pushQuad(out, [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]) // -Y
    return geometryFromPositions(out)
}
