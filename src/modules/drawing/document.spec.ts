import { describe, expect, it } from "bun:test"
import { addEntity, createDrawing, getEntity, removeEntity, updateEntity } from "./document"
import type { Circle, Line } from "./types"

const context = describe

const line = (id: string): Line => ({ id, type: "line", a: [0, 0, 0], b: [1, 1, 1] })
const circle = (id: string): Circle => ({ id, type: "circle", center: [0, 0, 0], radius: 5, normal: [0, 0, 1] })

describe("document", () => {
    context("createDrawing", () => {
        it("makes an empty mm document at version 1 on the default 10 mm grid", () => {
            expect(createDrawing()).toEqual({ version: 1, units: "mm", gridSize: 10, entities: [] })
        })
    })

    context("addEntity", () => {
        it("appends the entity and leaves the input untouched", () => {
            const doc = createDrawing()
            const next = addEntity(doc, line("a"))

            expect(next.entities).toEqual([line("a")])
            // input never mutated
            expect(doc.entities).toEqual([])
            expect(next).not.toBe(doc)
        })

        it("preserves existing entities and order", () => {
            const doc = addEntity(addEntity(createDrawing(), line("a")), circle("b"))
            expect(doc.entities.map((e) => e.id)).toEqual(["a", "b"])
        })
    })

    context("getEntity", () => {
        it("returns the matching entity or undefined", () => {
            const doc = addEntity(createDrawing(), line("a"))
            expect(getEntity(doc, "a")).toEqual(line("a"))
            expect(getEntity(doc, "missing")).toBeUndefined()
        })
    })

    context("updateEntity", () => {
        it("shallow-merges the patch into the matching entity", () => {
            const doc = addEntity(createDrawing(), line("a"))
            const next = updateEntity(doc, "a", { b: [9, 9, 9] })

            expect(getEntity(next, "a")).toEqual({ id: "a", type: "line", a: [0, 0, 0], b: [9, 9, 9] })
            // input never mutated
            expect(getEntity(doc, "a")).toEqual(line("a"))
            expect(next).not.toBe(doc)
        })

        it("keeps the original id and type even if the patch carries them", () => {
            const doc = addEntity(createDrawing(), line("a"))
            const next = updateEntity(doc, "a", { id: "hacked", type: "circle" })
            const updated = getEntity(next, "a")

            expect(updated?.id).toBe("a")
            expect(updated?.type).toBe("line")
        })

        it("is a no-op (returns the same doc reference) when no id matches", () => {
            const doc = addEntity(createDrawing(), line("a"))
            const next = updateEntity(doc, "missing", { b: [9, 9, 9] })
            expect(next).toBe(doc)
        })
    })

    context("removeEntity", () => {
        it("drops the matching entity and leaves the input untouched", () => {
            const doc = addEntity(addEntity(createDrawing(), line("a")), circle("b"))
            const next = removeEntity(doc, "a")

            expect(next.entities.map((e) => e.id)).toEqual(["b"])
            // input never mutated
            expect(doc.entities.map((e) => e.id)).toEqual(["a", "b"])
        })

        it("returns an equivalent document when no id matches", () => {
            const doc = addEntity(createDrawing(), line("a"))
            const next = removeEntity(doc, "missing")
            expect(next.entities).toEqual(doc.entities)
        })
    })
})
