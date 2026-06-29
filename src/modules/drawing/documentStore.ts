import { useSyncExternalStore } from "react"
import {
    addEntity as applyAddEntity,
    removeEntities as applyRemoveEntities,
    removeEntity as applyRemoveEntity,
    updateEntity as applyUpdateEntity,
    createDrawing
} from "./document"
import type { Drawing, Entity } from "./types"

/**
 * Reactive store for the serialized drawing document plus undo/redo. Mirrors the
 * `modelStore` idiom (a module-level singleton with a `Set` of listeners and a
 * `useSyncExternalStore`-backed hook) but needs NO version counter: the document
 * is immutable, so every mutation replaces `present` with a new reference. A
 * hook's snapshot can therefore return the value itself — React bails out of any
 * consumer whose snapshot is `Object.is`-equal, giving fine-grained re-renders
 * from one shared subscribe/notify.
 *
 * `commit` is the single funnel every mutation flows through and the ONLY
 * undoable step boundary. This store is decoupled from `editorStore` — it never
 * touches ephemeral editor state.
 */

let past: Drawing[] = []
let present: Drawing = createDrawing()
let future: Drawing[] = []
const HISTORY_CAP = 100
const listeners = new Set<() => void>()

/**
 * Subscribe to document/history changes; returns an unsubscribe. Powers both the
 * `useSyncExternalStore` hooks below and the module-level autosave in
 * `persistence`. Fires on every mutation, undo/redo, and load.
 */
export const subscribe = (onChange: () => void): (() => void) => {
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

/** The current document. */
export const getDrawing = (): Drawing => present

/**
 * Replace `present` with `next`, pushing the old `present` onto the undo stack
 * (capped at `HISTORY_CAP`), clearing the redo stack, and notifying. The single
 * funnel for every document mutation and the only undoable step boundary.
 */
export const commit = (next: Drawing): void => {
    past.push(present)
    if (past.length > HISTORY_CAP) past.shift()
    present = next
    future = []
    notify()
}

/** Append `entity` to the document (undoable). */
export const addEntity = (entity: Entity): void => {
    commit(applyAddEntity(present, entity))
}

/** Shallow-merge `patch` into the entity with id `id` (undoable). */
export const updateEntity = (id: string, patch: Partial<Entity>): void => {
    commit(applyUpdateEntity(present, id, patch))
}

/** Remove the entity with id `id` (undoable). */
export const removeEntity = (id: string): void => {
    commit(applyRemoveEntity(present, id))
}

/**
 * Remove every entity in `ids` as ONE undoable step, so a multi-entity delete
 * reverses in a single undo. A no-op (no commit, no history entry) when `ids` is
 * empty or matches nothing — the pure op returns the same reference, and only a
 * genuine change is worth an undo boundary.
 */
export const removeEntities = (ids: string[]): void => {
    const next = applyRemoveEntities(present, ids)
    if (next === present) return
    commit(next)
}

/**
 * Set the document's grid spacing (mm), undoable so it persists and round-trips.
 * A no-op (no commit, no history entry) when the value is unchanged or not a
 * positive finite number — callers settle on one value before committing rather
 * than flooding undo history on every keystroke.
 */
export const setGridSize = (mm: number): void => {
    if (!Number.isFinite(mm) || mm <= 0 || mm === present.gridSize) return
    commit({ ...present, gridSize: mm })
}

/**
 * Set the document's extrusion depth (mm), undoable so it persists and
 * round-trips. Mirrors `setGridSize`: a no-op (no commit, no history entry) when
 * the value is unchanged or not a positive finite number — callers settle on one
 * value before committing rather than flooding undo history on every keystroke.
 */
export const setExtrudeDepth = (mm: number): void => {
    if (!Number.isFinite(mm) || mm <= 0 || mm === present.extrudeDepth) return
    commit({ ...present, extrudeDepth: mm })
}

/** Step back one commit. No-op (no notify) when there is nothing to undo. */
export const undo = (): void => {
    const previous = past.pop()
    if (previous === undefined) return
    future.unshift(present)
    present = previous
    notify()
}

/** Re-apply the most recently undone commit. No-op when there is nothing to redo. */
export const redo = (): void => {
    const next = future.shift()
    if (next === undefined) return
    past.push(present)
    present = next
    notify()
}

export const canUndo = (): boolean => past.length > 0

export const canRedo = (): boolean => future.length > 0

/**
 * Replace the document with `doc`, clearing BOTH history stacks — loading is a
 * fresh start, not an undoable step.
 */
export const loadDrawing = (doc: Drawing): void => {
    past = []
    present = doc
    future = []
    notify()
}

/** Reset to an empty document, clearing history. */
export const newDrawing = (): void => {
    loadDrawing(createDrawing())
}

/** The current document, re-rendering only when it genuinely changes. */
export const useDrawing = (): Drawing => useSyncExternalStore(subscribe, getDrawing, getDrawing)

const getGridSize = (): number => present.gridSize

/** The document's grid spacing (mm), re-rendering only when it changes. */
export const useGridSize = (): number => useSyncExternalStore(subscribe, getGridSize, getGridSize)

const getExtrudeDepth = (): number => present.extrudeDepth

/** The document's extrusion depth (mm), re-rendering only when it changes. */
export const useExtrudeDepth = (): number => useSyncExternalStore(subscribe, getExtrudeDepth, getExtrudeDepth)

const getHistorySnapshot = (): number => (past.length > 0 ? 1 : 0) + (future.length > 0 ? 2 : 0)

/**
 * The undo/redo availability flags. The snapshot is a stable NUMBER encoding
 * both flags (never an object, which would be a fresh reference each call and
 * loop); the booleans are derived from it.
 */
export const useHistory = (): { canUndo: boolean; canRedo: boolean } => {
    const flags = useSyncExternalStore(subscribe, getHistorySnapshot, getHistorySnapshot)
    return { canUndo: (flags & 1) !== 0, canRedo: (flags & 2) !== 0 }
}
