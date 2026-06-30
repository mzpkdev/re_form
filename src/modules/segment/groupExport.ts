import type * as THREE from "three"
import { exportStl } from "../../lib/stl"
import { triangleIndicesToGeometry } from "./subGeometry"
import type { ShapeGroup } from "./types"

/**
 * The sub-geometry of a single group: the source triangles named by
 * `group.triangleIndices`, copied into a fresh non-indexed `BufferGeometry`.
 *
 * A thin alias over {@link triangleIndicesToGeometry} — the group's indices ARE
 * triangle indices in the original imported geometry's order (1:1 with welded
 * faces), so extracting them over the untouched `source` is exact. `source` is
 * never mutated; the result is the caller's to dispose.
 */
export const groupToGeometry = (source: THREE.BufferGeometry, group: ShapeGroup): THREE.BufferGeometry =>
    triangleIndicesToGeometry(source, group.triangleIndices)

/**
 * Export one or more groups as a SINGLE binary STL: the union of their triangles
 * baked into one mesh.
 *
 * The groups' `triangleIndices` are concatenated into one combined list (their
 * order is preserved; the lists are disjoint by the `ShapeGroup` invariant, so no
 * triangle is emitted twice), that list is materialised over the original
 * `source` via {@link triangleIndicesToGeometry}, and the result is serialised
 * with the shared {@link exportStl}. The merged geometry is a local temporary, so
 * it is disposed before returning; `source` is left untouched.
 *
 * Empty input (no groups, or groups with no triangles) yields an empty geometry,
 * which `exportStl` rejects — an empty STL is never a printable part.
 */
export const exportGroups = (source: THREE.BufferGeometry, groups: readonly ShapeGroup[]): ArrayBuffer => {
    const combined: number[] = []
    for (const group of groups) {
        for (const index of group.triangleIndices) {
            combined.push(index)
        }
    }

    const merged = triangleIndicesToGeometry(source, combined)
    try {
        return exportStl(merged)
    } finally {
        merged.dispose()
    }
}

/**
 * Trigger a browser download of an STL buffer under `filename`. Wraps the bytes
 * in a Blob, clicks a transient object-URL anchor, then revokes the URL. DOM-only
 * (mirrors the export path in `App.tsx`); not exercised by unit tests.
 */
export const downloadStl = (buffer: ArrayBuffer, filename: string): void => {
    const blob = new Blob([buffer], { type: "model/stl" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
}
