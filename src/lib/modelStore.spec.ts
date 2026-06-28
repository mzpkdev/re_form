import { beforeEach, describe, expect, it } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { initManifold } from "./manifold"
import { getManifold, setManifold, useModelVersion } from "./modelStore"

const context = describe

// The store is a process-wide singleton; reset it before each test so cases run
// independent of order. Clearing to null also deletes whatever a prior test left
// live, so no handle leaks between tests.
beforeEach(() => {
    setManifold(null)
})

// Render the real useModelVersion hook through React's public server renderer
// and read the version it reports. Each render is a fresh tree, so it reflects
// the current snapshot — exercising useSyncExternalStore + getSnapshot end to
// end without poking at React internals.
const readVersion = (): number => {
    const Probe = () => createElement("span", null, String(useModelVersion()))
    const markup = renderToStaticMarkup(createElement(Probe))
    return Number(markup.replace(/<[^>]*>/g, ""))
}

describe("modelStore", () => {
    context("setManifold / getManifold", () => {
        it("stores the handle and returns the same object", async () => {
            const wasm = await initManifold()
            const cube = wasm.Manifold.cube([1, 1, 1])

            setManifold(cube)

            expect(getManifold()).toBe(cube)

            setManifold(null)
        })
    })

    context("replacing a handle", () => {
        it("returns the new handle and deletes the previous one", async () => {
            const wasm = await initManifold()
            const a = wasm.Manifold.cube([1, 1, 1])
            const b = wasm.Manifold.sphere(1)

            setManifold(a)
            setManifold(b)

            expect(getManifold()).toBe(b)
            // `a` was deleted by the store. manifold-3d (emscripten embind) throws
            // a BindingError — "Cannot pass deleted object as a pointer of type
            // Manifold const*" — when a freed handle is used. Empirically verified
            // against the real WASM, this is the most robust confirmation that the
            // delete happened. `b` is still live and answers normally.
            expect(() => a.volume()).toThrow()
            expect(b.volume()).toBeGreaterThan(0)

            setManifold(null)
        })

        it("does not delete the handle when set to itself", async () => {
            const wasm = await initManifold()
            const a = wasm.Manifold.cube([1, 1, 1])

            setManifold(a)
            setManifold(a)

            // Setting the current handle to itself must not free it; `a` stays live.
            expect(getManifold()).toBe(a)
            expect(a.volume()).toBeGreaterThan(0)

            setManifold(null)
        })
    })

    context("version counter", () => {
        it("increments on every set", async () => {
            const wasm = await initManifold()
            const a = wasm.Manifold.cube([1, 1, 1])
            const b = wasm.Manifold.cube([2, 2, 2])

            const initial = readVersion()

            setManifold(a)
            expect(readVersion()).toBe(initial + 1)

            setManifold(b)
            expect(readVersion()).toBe(initial + 2)

            setManifold(null)
            expect(readVersion()).toBe(initial + 3)
        })
    })

    context("clearing", () => {
        it("setManifold(null) clears to null and deletes the prior handle", async () => {
            const wasm = await initManifold()
            const a = wasm.Manifold.cube([1, 1, 1])

            setManifold(a)
            setManifold(null)

            expect(getManifold()).toBeNull()
            expect(() => a.volume()).toThrow()
        })
    })
})
