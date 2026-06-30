import { beforeEach, describe, expect, it } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { getGroups, setGroups, subscribe, useGroups, useGroupsVersion } from "./groupsStore"
import type { ShapeGroup } from "./types"

const context = describe

// Minimal valid ShapeGroup for store tests — membership is the only field the
// store reasons about; the rest satisfy the type (§5).
const makeGroup = (id: string, indices: number[]): ShapeGroup => ({
    id,
    kind: "unknown",
    label: id,
    color: [1, 1, 1],
    triangleIndices: Int32Array.from(indices),
    params: { kind: "unknown" },
    bbox: { min: [0, 0, 0], max: [1, 1, 1] }
})

// The store is a process-wide singleton; reset it before each test so cases run
// independent of order.
beforeEach(() => {
    setGroups([])
})

// Render the real useGroupsVersion hook through React's public server renderer
// and read the version it reports. Each render is a fresh tree, so it reflects
// the current snapshot — exercising useSyncExternalStore + getSnapshot end to
// end without poking at React internals.
const readVersion = (): number => {
    const Probe = () => createElement("span", null, String(useGroupsVersion()))
    const markup = renderToStaticMarkup(createElement(Probe))
    return Number(markup.replace(/<[^>]*>/g, ""))
}

// Read the ids the useGroups hook reports as JSON.
const readGroupIds = (): string[] => {
    const Probe = () =>
        createElement(
            "span",
            null,
            useGroups()
                .map((g) => g.id)
                .join("|")
        )
    const markup = renderToStaticMarkup(createElement(Probe))
    const text = markup.replace(/<[^>]*>/g, "")
    return text === "" ? [] : text.split("|")
}

describe("groupsStore", () => {
    context("setGroups / getGroups", () => {
        it("stores the groups and returns them", () => {
            const groups = [makeGroup("a", [0, 1]), makeGroup("b", [2])]

            setGroups(groups)

            expect(getGroups().map((g) => g.id)).toEqual(["a", "b"])
        })

        it("replaces immutably — holds its own array, not the caller's", () => {
            const input = [makeGroup("a", [0])]
            setGroups(input)

            input.push(makeGroup("b", [1]))

            expect(getGroups().map((g) => g.id)).toEqual(["a"])
        })

        it("replaces the prior groups wholesale", () => {
            setGroups([makeGroup("a", [0])])
            setGroups([makeGroup("c", [1])])

            expect(getGroups().map((g) => g.id)).toEqual(["c"])
        })
    })

    context("version counter", () => {
        it("bumps on every set", () => {
            const initial = readVersion()

            setGroups([makeGroup("a", [0])])
            expect(readVersion()).toBe(initial + 1)

            setGroups([makeGroup("b", [1])])
            expect(readVersion()).toBe(initial + 2)

            setGroups([])
            expect(readVersion()).toBe(initial + 3)
        })
    })

    context("subscribe", () => {
        it("fires the listener on every change", () => {
            let calls = 0
            const unsubscribe = subscribe(() => {
                calls += 1
            })

            setGroups([makeGroup("a", [0])])
            setGroups([])

            expect(calls).toBe(2)
            unsubscribe()
        })

        it("stops firing after unsubscribe", () => {
            let calls = 0
            const unsubscribe = subscribe(() => {
                calls += 1
            })

            setGroups([makeGroup("a", [0])])
            unsubscribe()
            setGroups([makeGroup("b", [1])])

            expect(calls).toBe(1)
        })
    })

    context("useGroups", () => {
        it("reflects the current snapshot through useSyncExternalStore", () => {
            setGroups([makeGroup("x", [0]), makeGroup("y", [1])])

            expect(readGroupIds()).toEqual(["x", "y"])
        })
    })
})
