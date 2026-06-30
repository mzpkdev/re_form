import { useSyncExternalStore } from "react"

/**
 * Ephemeral selection store for the segment panel/viewport — a module-level
 * singleton holding the selected group ids (`string[]`). Copies the
 * `editorStore` selection idiom exactly: one shared subscribe/notify,
 * `setSelection` stores a fresh array so later caller mutation can't leak in,
 * `clearSelection` empties it, `useSelection` is a `useSyncExternalStore` hook.
 * Selection is never serialized; each setter REPLACES its value (immutable), so
 * the snapshot returns the field itself and React bails out of unchanged
 * consumers.
 */

let selection: string[] = []

const listeners = new Set<() => void>()

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

const getSnapshot = (): string[] => selection

export const getSelection = (): string[] => selection

/** Replace the selection, storing a fresh array so later caller mutation can't leak in. */
export const setSelection = (ids: string[]): void => {
    selection = [...ids]
    notify()
}

export const clearSelection = (): void => {
    selection = []
    notify()
}

export const useSelection = (): string[] => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
