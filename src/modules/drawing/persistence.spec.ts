import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { addEntity, createDrawing } from "./document"
import { loadStoredDrawing, STORAGE_KEY, saveDrawing } from "./persistence"
import { serialize } from "./serialize"
import type { Drawing, Line } from "./types"

const context = describe

const line: Line = { id: "l", type: "line", a: [0, 0, 0], b: [10, 20, 30] }
const doc: Drawing = addEntity(createDrawing(), line)

// A minimal in-memory localStorage stub. `loadStoredDrawing`/`saveDrawing` only
// touch get/set/removeItem, so this is enough to exercise the round-trip and the
// miss/corrupt paths without a real browser.
class MemoryStorage {
    private store = new Map<string, string>()
    getItem(key: string): string | null {
        return this.store.has(key) ? (this.store.get(key) as string) : null
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value)
    }
    removeItem(key: string): void {
        this.store.delete(key)
    }
}

// Storage backend whose every method throws — stands in for quota-exceeded or a
// disabled/blocked localStorage, so we can assert the helpers swallow it.
const throwingStorage = {
    getItem() {
        throw new Error("storage unavailable")
    },
    setItem() {
        throw new Error("quota exceeded")
    },
    removeItem() {
        throw new Error("storage unavailable")
    }
}

describe("persistence", () => {
    const original = globalThis.localStorage

    beforeEach(() => {
        Object.defineProperty(globalThis, "localStorage", {
            value: new MemoryStorage(),
            configurable: true,
            writable: true
        })
    })

    afterEach(() => {
        Object.defineProperty(globalThis, "localStorage", {
            value: original,
            configurable: true,
            writable: true
        })
    })

    context("save → load round-trip", () => {
        it("loads back a document deep-equal to the saved one", () => {
            saveDrawing(doc)
            expect(loadStoredDrawing()).toEqual(doc)
        })

        it("writes exactly serialize(doc) under STORAGE_KEY", () => {
            saveDrawing(doc)
            expect(localStorage.getItem(STORAGE_KEY)).toBe(serialize(doc))
        })

        it("round-trips the empty document", () => {
            const empty = createDrawing()
            saveDrawing(empty)
            expect(loadStoredDrawing()).toEqual(empty)
        })
    })

    context("loadStoredDrawing returns null instead of throwing", () => {
        it("returns null when nothing is stored", () => {
            expect(loadStoredDrawing()).toBeNull()
        })

        it("returns null on a corrupt (unparsable) payload", () => {
            localStorage.setItem(STORAGE_KEY, "{not json")
            expect(loadStoredDrawing()).toBeNull()
        })

        it("returns null on a structurally invalid payload", () => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, units: "mm", entities: [] }))
            expect(loadStoredDrawing()).toBeNull()
        })

        it("returns null (never throws) when the storage backend throws", () => {
            Object.defineProperty(globalThis, "localStorage", {
                value: throwingStorage,
                configurable: true,
                writable: true
            })
            expect(loadStoredDrawing()).toBeNull()
        })
    })

    context("saveDrawing never throws", () => {
        it("swallows a storage error (e.g. quota exceeded)", () => {
            Object.defineProperty(globalThis, "localStorage", {
                value: throwingStorage,
                configurable: true,
                writable: true
            })
            expect(() => saveDrawing(doc)).not.toThrow()
        })
    })
})
