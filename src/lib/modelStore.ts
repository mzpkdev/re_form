import type { Manifold } from "manifold-3d"
import { useSyncExternalStore } from "react"

/**
 * Module-level store for the single live editable Manifold. The STL importer
 * and Mesh Tools both feed this one setter, so the Viewport no longer owns the
 * handle. This store is the ONLY place `.delete()` is called on
 * the current handle — `setManifold` deletes the previous one before replacing
 * it. A version counter bumps on every set so `useSyncExternalStore` consumers
 * re-bake their geometry.
 */
let current: Manifold | null = null
let version = 0
const listeners = new Set<() => void>()

const subscribe = (onChange: () => void) => {
    listeners.add(onChange)
    return () => {
        listeners.delete(onChange)
    }
}

const getSnapshot = () => version

export const getManifold = (): Manifold | null => current

/**
 * Replace the live Manifold. Deletes the previous handle (when present and not
 * the same object as `next`) before storing `next`, bumps the version counter
 * and notifies subscribers. Passing the same handle back is a no-op delete but
 * still bumps the version.
 */
export const setManifold = (next: Manifold | null): void => {
    if (current && current !== next) {
        current.delete()
    }
    current = next
    version += 1
    for (const onChange of listeners) {
        onChange()
    }
}

export const useModelVersion = (): number => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
