import { useSyncExternalStore } from "react"
import type { Entity, Plane } from "./types"

/**
 * Reactive store for ephemeral editor state — the active plane, the active tool,
 * the current selection, and the in-progress drawing preview. None of this is
 * ever serialized into the document or pushed onto undo/redo; it is decoupled
 * from `documentStore`.
 *
 * Same idiom as `modelStore`/`documentStore`: a module-level singleton with one
 * shared subscribe/notify and no version counter. Every setter REPLACES its
 * value (immutable), so each granular hook's snapshot returns the field itself
 * and React bails out of consumers whose slice is unchanged.
 */

export type Tool = "select" | "line" | "circle" | "polyline" | "arc"

let activePlane: Plane = "front"
let activeTool: Tool = "select"
let selection: string[] = []
let preview: Entity | null = null

const listeners = new Set<() => void>()

const subscribe = (onChange: () => void) => {
    listeners.add(onChange)
    return () => {
        listeners.delete(onChange)
    }
}

const notify = (): void => {
    for (const onChange of listeners) {
        onChange()
    }
}

export const getActivePlane = (): Plane => activePlane

export const getActiveTool = (): Tool => activeTool

export const getSelection = (): string[] => selection

/** The ghost candidate entity (3D world coords), or `null` when not drawing. */
export const getPreview = (): Entity | null => preview

export const setActivePlane = (p: Plane): void => {
    activePlane = p
    notify()
}

export const setActiveTool = (t: Tool): void => {
    activeTool = t
    notify()
}

/** Replace the selection, storing a fresh array so later caller mutation can't leak in. */
export const setSelection = (ids: string[]): void => {
    selection = [...ids]
    notify()
}

export const clearSelection = (): void => {
    selection = []
    notify()
}

export const setPreview = (entity: Entity | null): void => {
    preview = entity
    notify()
}

export const useActivePlane = (): Plane => useSyncExternalStore(subscribe, getActivePlane, getActivePlane)

export const useActiveTool = (): Tool => useSyncExternalStore(subscribe, getActiveTool, getActiveTool)

export const useSelection = (): string[] => useSyncExternalStore(subscribe, getSelection, getSelection)

export const usePreview = (): Entity | null => useSyncExternalStore(subscribe, getPreview, getPreview)
