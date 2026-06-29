import { beforeEach, describe, expect, it } from "bun:test"
import { createDrawing } from "./document"
import {
    addEntity,
    canRedo,
    canUndo,
    commit,
    getDrawing,
    loadDrawing,
    newDrawing,
    redo,
    removeEntity,
    setGridSize,
    undo,
    updateEntity
} from "./documentStore"
import type { Circle, Line } from "./types"

const context = describe

const line = (id: string): Line => ({ id, type: "line", a: [0, 0, 0], b: [1, 1, 1] })
const circle = (id: string): Circle => ({ id, type: "circle", center: [0, 0, 0], radius: 5, normal: [0, 0, 1] })

describe("documentStore", () => {
    beforeEach(() => {
        newDrawing()
    })

    context("actions", () => {
        it("addEntity adds the entity to the document", () => {
            addEntity(line("a"))
            expect(getDrawing().entities).toContainEqual(line("a"))
        })

        it("each action produces a new present reference", () => {
            const before = getDrawing()
            addEntity(line("a"))
            const afterAdd = getDrawing()
            expect(afterAdd).not.toBe(before)

            updateEntity("a", { a: [9, 9, 9] })
            const afterUpdate = getDrawing()
            expect(afterUpdate).not.toBe(afterAdd)

            removeEntity("a")
            const afterRemove = getDrawing()
            expect(afterRemove).not.toBe(afterUpdate)
        })
    })

    context("undo / redo", () => {
        it("undo restores the prior doc and redo reapplies it", () => {
            addEntity(line("a"))
            const withEntity = getDrawing()
            expect(getDrawing().entities).toHaveLength(1)

            undo()
            expect(getDrawing().entities).toHaveLength(0)

            redo()
            expect(getDrawing().entities).toHaveLength(1)
            expect(getDrawing()).toBe(withEntity)
        })

        it("undo with empty history is a no-op", () => {
            const before = getDrawing()
            undo()
            expect(getDrawing()).toBe(before)
            expect(canUndo()).toBe(false)
        })

        it("redo with empty history is a no-op", () => {
            const before = getDrawing()
            redo()
            expect(getDrawing()).toBe(before)
            expect(canRedo()).toBe(false)
        })

        it("a fresh action after history clears the redo stack", () => {
            addEntity(line("a"))
            undo()
            expect(canRedo()).toBe(true)

            addEntity(circle("b"))
            expect(canRedo()).toBe(false)
            redo()
            // redo was a no-op: the only entity is the freshly added one.
            expect(getDrawing().entities).toEqual([circle("b")])
        })

        it("caps history at 100 entries", () => {
            for (let i = 0; i < 150; i++) {
                addEntity(line(`e${i}`))
            }
            let undone = 0
            while (canUndo()) {
                undo()
                undone += 1
            }
            expect(undone).toBe(100)
        })
    })

    context("canUndo / canRedo", () => {
        it("track the history state", () => {
            expect(canUndo()).toBe(false)
            expect(canRedo()).toBe(false)

            addEntity(line("a"))
            expect(canUndo()).toBe(true)
            expect(canRedo()).toBe(false)

            undo()
            expect(canUndo()).toBe(false)
            expect(canRedo()).toBe(true)

            redo()
            expect(canUndo()).toBe(true)
            expect(canRedo()).toBe(false)
        })
    })

    context("setGridSize", () => {
        it("updates the grid size via commit (undoable, round-trippable)", () => {
            expect(getDrawing().gridSize).toBe(10)
            setGridSize(25)
            expect(getDrawing().gridSize).toBe(25)
            expect(canUndo()).toBe(true)
            undo()
            expect(getDrawing().gridSize).toBe(10)
        })

        it("is a no-op (no commit) when the value is unchanged", () => {
            const before = getDrawing()
            setGridSize(10)
            expect(getDrawing()).toBe(before)
            expect(canUndo()).toBe(false)
        })

        it("ignores a zero, negative, or non-finite value", () => {
            const before = getDrawing()
            setGridSize(0)
            setGridSize(-5)
            setGridSize(Number.NaN)
            expect(getDrawing()).toBe(before)
            expect(canUndo()).toBe(false)
        })
    })

    context("commit", () => {
        it("funnels an arbitrary next document and is undoable", () => {
            const next = createDrawing()
            next.entities.push(line("z"))
            commit(next)
            expect(getDrawing()).toBe(next)
            expect(canUndo()).toBe(true)
        })
    })

    context("loadDrawing", () => {
        it("replaces the doc and clears history", () => {
            addEntity(line("a"))
            undo()
            expect(canRedo()).toBe(true)

            const loaded = createDrawing()
            loaded.entities.push(circle("b"))
            loadDrawing(loaded)

            expect(getDrawing()).toBe(loaded)
            expect(canUndo()).toBe(false)
            expect(canRedo()).toBe(false)
        })
    })
})
