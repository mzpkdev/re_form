import { useSyncExternalStore } from "react"
import type { ShapeGroup } from "./types"

/**
 * Store for the current `ShapeGroup[]`. Copies the `modelStore` idiom: a
 * module-level singleton with one shared subscribe/notify and a version counter
 * (`useGroupsVersion`) that bumps on every replacement so consumers re-render.
 *
 * Follows the same delete-on-replace discipline as `modelStore`: before each
 * replacement, every group being dropped has its disposable artifacts freed via
 * `disposeGroup`. Per §5 a `ShapeGroup` currently holds only a plain
 * `Int32Array` (`triangleIndices`) — nothing to free today — so `disposeGroup`
 * is a clean hook with no live branches. It's centralized here so a future
 * cached `Manifold`/`BufferGeometry` riding along on a group is freed exactly
 * once, in one place, the moment its group leaves the store.
 *
 * `useGroups` returns the live array; `useGroupsVersion` exposes the counter.
 */

let groups: ShapeGroup[] = []
let version = 0

const listeners = new Set<() => void>()

export const subscribe = (onChange: () => void): (() => void) => {
    listeners.add(onChange)
    return () => {
        listeners.delete(onChange)
    }
}

const getSnapshot = (): number => version

const getGroupsSnapshot = (): ShapeGroup[] => groups

/**
 * Free any cached disposable artifact a group holds before it leaves the store.
 * Today a `ShapeGroup` carries only a plain `Int32Array`, so there is nothing to
 * free — this is the disposal seam. When a group later caches a `Manifold` or a
 * three.js `BufferGeometry`/`Material`, call its `.delete()`/`.dispose()` here.
 */
const disposeGroup = (_group: ShapeGroup): void => {
    // No disposable artifacts on ShapeGroup yet (plain Int32Array membership).
    // Future cached handles get freed here on replace.
}

export const getGroups = (): ShapeGroup[] => groups

/**
 * Replace the groups. Disposes every previous group's cached artifacts (when
 * not carried over into `next`), stores a fresh array, bumps the version counter
 * and notifies subscribers.
 */
export const setGroups = (next: ShapeGroup[]): void => {
    const retained = new Set(next)
    for (const group of groups) {
        if (!retained.has(group)) {
            disposeGroup(group)
        }
    }
    groups = [...next]
    version += 1
    for (const onChange of listeners) {
        onChange()
    }
}

export const useGroups = (): ShapeGroup[] => useSyncExternalStore(subscribe, getGroupsSnapshot, getGroupsSnapshot)

export const useGroupsVersion = (): number => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
