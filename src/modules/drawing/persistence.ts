import { getDrawing, loadDrawing, subscribe } from "./documentStore"
import { deserialize, serialize } from "./serialize"
import type { Drawing } from "./types"

/**
 * localStorage persistence for the drawing document: autosave the doc on every
 * change and hydrate it once at startup. The document is the app's JSON source
 * of truth, so it survives a page reload through the same serialize/deserialize
 * round-trip used for file import/export. Only the DOC is persisted — undo/redo
 * history is ephemeral and never stored. React-free by design.
 *
 * Every localStorage touch is wrapped: storage can throw (quota, disabled in
 * private mode, blocked by policy) and a persistence failure must never crash
 * the editor. A read miss or corrupt payload yields `null`, never a throw.
 *
 * OUT (deferred): multi-document management, cloud sync, and debouncing the
 * autosave write beyond the trivial save-on-change here.
 */

export const STORAGE_KEY = "hublinator.drawing.v1"

/**
 * Serialize `doc` and write it to localStorage under `STORAGE_KEY`. Swallows any
 * storage error (quota exceeded, unavailable, blocked) — autosave is best-effort
 * and never propagates into the app.
 */
export const saveDrawing = (doc: Drawing): void => {
    try {
        localStorage.setItem(STORAGE_KEY, serialize(doc))
    } catch {
        // Best-effort: a failed autosave must not break the editor.
    }
}

/**
 * Read and validate the stored document, returning it or `null` when absent,
 * unreadable, or invalid. Never throws — a corrupt or unparsable payload (or an
 * unavailable storage backend) is treated as "nothing stored".
 */
export const loadStoredDrawing = (): Drawing | null => {
    let raw: string | null
    try {
        raw = localStorage.getItem(STORAGE_KEY)
    } catch {
        return null
    }
    if (raw === null) return null
    try {
        return deserialize(raw)
    } catch {
        return null
    }
}

// Module-guard so hydrate + the autosave subscription wire up exactly ONCE per
// session, no matter how many times `initPersistence` is called (StrictMode
// double-invokes effects, and the app may re-import the barrel). Re-running
// would either clobber in-memory state with the stored doc or stack duplicate
// listeners.
let initialized = false

/**
 * Hydrate the store from localStorage once, then keep it autosaved. Idempotent:
 * the first call loads any stored document (so a reload restores the drawing)
 * and subscribes a module-level listener that serializes the current doc on
 * every change; later calls are no-ops. Always active for the session once
 * called — independent of which view is mounted — so re-entering the Draw view
 * never reloads (and clobbers) the in-memory document.
 */
export const initPersistence = (): void => {
    if (initialized) return
    initialized = true

    const stored = loadStoredDrawing()
    if (stored) loadDrawing(stored)

    // Autosave the DOC on every change. History is ephemeral, so only the
    // current document is written.
    subscribe(() => saveDrawing(getDrawing()))
}
