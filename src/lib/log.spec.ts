import { beforeEach, describe, expect, it } from "bun:test"
import { clearToolLog, getToolLog, logToolEvent } from "./log"

const context = describe

const event = (overrides: Partial<Parameters<typeof logToolEvent>[0]> = {}) => ({
    step: 0,
    name: "create_primitive",
    args: '{"shape":"cube"}',
    result: "Applied create_primitive.",
    ok: true,
    ...overrides
})

describe("tool log", () => {
    // The store is module-level, so each test starts from a clean slate.
    beforeEach(() => {
        clearToolLog()
    })

    context("clearToolLog", () => {
        it("empties the store", () => {
            logToolEvent(event())
            expect(getToolLog()).toHaveLength(1)

            clearToolLog()
            expect(getToolLog()).toHaveLength(0)
        })
    })

    context("logToolEvent", () => {
        it("appends the event to the store", () => {
            logToolEvent(event())
            const log = getToolLog()
            expect(log).toHaveLength(1)
            expect(log[0]).toEqual(event())
        })

        it("records ok = true for a success result", () => {
            logToolEvent(event({ result: "Applied create_primitive.", ok: true }))
            expect(getToolLog()[0].ok).toBe(true)
        })

        it("records ok = false for an 'Error: …' result", () => {
            logToolEvent(event({ result: "Error: no editable solid", ok: false }))
            expect(getToolLog()[0].ok).toBe(false)
        })
    })

    context("getToolLog", () => {
        it("returns events in insertion order", () => {
            logToolEvent(event({ step: 0, name: "create_primitive" }))
            logToolEvent(event({ step: 1, name: "drill_hole" }))
            logToolEvent(event({ step: 2, name: "hollow" }))

            expect(getToolLog().map((e) => e.name)).toEqual(["create_primitive", "drill_hole", "hollow"])
            expect(getToolLog().map((e) => e.step)).toEqual([0, 1, 2])
        })
    })
})
