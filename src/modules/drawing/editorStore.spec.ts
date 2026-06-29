import { beforeEach, describe, expect, it } from "bun:test"
import {
    clearSelection,
    getActivePlane,
    getActiveTool,
    getPreview,
    getSelection,
    setActivePlane,
    setActiveTool,
    setPreview,
    setSelection
} from "./editorStore"
import type { Line } from "./types"

const context = describe

const line = (id: string): Line => ({ id, type: "line", a: [0, 0, 0], b: [1, 1, 1] })

describe("editorStore", () => {
    beforeEach(() => {
        setActivePlane("front")
        setActiveTool("select")
        clearSelection()
        setPreview(null)
    })

    context("setters", () => {
        it("setActivePlane updates the getter", () => {
            setActivePlane("top")
            expect(getActivePlane()).toBe("top")
        })

        it("setActiveTool updates the getter", () => {
            setActiveTool("circle")
            expect(getActiveTool()).toBe("circle")
        })

        it("setPreview updates the getter", () => {
            const entity = line("p")
            setPreview(entity)
            expect(getPreview()).toBe(entity)
        })
    })

    context("selection", () => {
        it("setSelection updates the getter", () => {
            setSelection(["a", "b"])
            expect(getSelection()).toEqual(["a", "b"])
        })

        it("stores a fresh array so mutating the passed array does not leak in", () => {
            const ids = ["a", "b"]
            setSelection(ids)
            ids.push("c")
            expect(getSelection()).toEqual(["a", "b"])
        })

        it("clearSelection empties the selection", () => {
            setSelection(["a", "b"])
            clearSelection()
            expect(getSelection()).toEqual([])
        })
    })
})
