import { beforeEach, describe, expect, it } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { clearSelection, getSelection, setSelection, subscribe, useSelection } from "./selectionStore"

const context = describe

// The store is a process-wide singleton; reset it before each test so cases run
// independent of order.
beforeEach(() => {
    clearSelection()
})

// Render the real useSelection hook through React's public server renderer and
// read the selection it reports as JSON. Each render is a fresh tree, so it
// reflects the current snapshot — exercising useSyncExternalStore + getSnapshot
// end to end without poking at React internals.
const readSelection = (): string[] => {
    const Probe = () => createElement("span", null, useSelection().join("|"))
    const markup = renderToStaticMarkup(createElement(Probe))
    const text = markup.replace(/<[^>]*>/g, "")
    return text === "" ? [] : text.split("|")
}

describe("selectionStore", () => {
    context("setSelection / getSelection", () => {
        it("stores the ids and returns them", () => {
            setSelection(["a", "b"])

            expect(getSelection()).toEqual(["a", "b"])
        })

        it("stores a fresh copy so later input mutation does not leak in", () => {
            const ids = ["a", "b"]
            setSelection(ids)

            ids.push("c")

            expect(getSelection()).toEqual(["a", "b"])
        })

        it("replaces the prior selection wholesale", () => {
            setSelection(["a", "b"])
            setSelection(["c"])

            expect(getSelection()).toEqual(["c"])
        })
    })

    context("clearSelection", () => {
        it("empties the selection", () => {
            setSelection(["a", "b"])
            clearSelection()

            expect(getSelection()).toEqual([])
        })
    })

    context("subscribe", () => {
        it("fires the listener on every change", () => {
            let calls = 0
            const unsubscribe = subscribe(() => {
                calls += 1
            })

            setSelection(["a"])
            clearSelection()

            expect(calls).toBe(2)
            unsubscribe()
        })

        it("stops firing after unsubscribe", () => {
            let calls = 0
            const unsubscribe = subscribe(() => {
                calls += 1
            })

            setSelection(["a"])
            unsubscribe()
            setSelection(["b"])

            expect(calls).toBe(1)
        })
    })

    context("useSelection", () => {
        it("reflects the current snapshot through useSyncExternalStore", () => {
            setSelection(["x", "y"])

            expect(readSelection()).toEqual(["x", "y"])
        })
    })
})
