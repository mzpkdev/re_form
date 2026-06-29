import { describe, expect, it } from "bun:test"
import { addEntity, createDrawing } from "./document"
import { deserialize, serialize } from "./serialize"
import type { Arc, Circle, Drawing, Line, Polyline } from "./types"

const context = describe

const line: Line = { id: "l", type: "line", a: [0, 0, 0], b: [10, 20, 30] }
const circle: Circle = { id: "c", type: "circle", center: [1, 2, 3], radius: 5, normal: [0, 0, 1] }
const arc: Arc = { id: "ar", type: "arc", center: [0, 0, 0], radius: 4, normal: [0, 1, 0], startDeg: 0, endDeg: 90 }
const polyline: Polyline = {
    id: "p",
    type: "polyline",
    points: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0]
    ],
    closed: true
}

const fullDoc: Drawing = [line, circle, arc, polyline].reduce(addEntity, createDrawing())

describe("serialize", () => {
    context("round trip", () => {
        it("deserialize(serialize(doc)) deep-equals the original for every entity type", () => {
            expect(deserialize(serialize(fullDoc))).toEqual(fullDoc)
        })

        it("round-trips the empty document", () => {
            const empty = createDrawing()
            expect(deserialize(serialize(empty))).toEqual(empty)
        })

        it("round-trips a custom grid size", () => {
            const doc: Drawing = { ...createDrawing(), gridSize: 2.5 }
            const restored = deserialize(serialize(doc))
            expect(restored.gridSize).toBe(2.5)
            expect(restored).toEqual(doc)
        })
    })

    context("gridSize (lenient, forward-compatible)", () => {
        it("defaults gridSize to 10 when the field is absent", () => {
            // An older document predating the gridSize field still loads.
            const legacy = { version: 1, units: "mm", entities: [] }
            expect(deserialize(JSON.stringify(legacy)).gridSize).toBe(10)
        })

        it("keeps an explicit gridSize present in the JSON", () => {
            const doc = { version: 1, units: "mm", gridSize: 5, entities: [] }
            expect(deserialize(JSON.stringify(doc)).gridSize).toBe(5)
        })

        it("throws on a zero or negative gridSize", () => {
            expect(() => deserialize(JSON.stringify({ version: 1, units: "mm", gridSize: 0, entities: [] }))).toThrow(
                /gridSize/
            )
            expect(() => deserialize(JSON.stringify({ version: 1, units: "mm", gridSize: -5, entities: [] }))).toThrow(
                /gridSize/
            )
        })

        it("throws on a non-finite gridSize", () => {
            // NaN survives JSON as null; an explicit non-number is rejected too.
            expect(() =>
                deserialize(JSON.stringify({ version: 1, units: "mm", gridSize: "10", entities: [] }))
            ).toThrow(/gridSize/)
        })
    })

    context("deserialize validation", () => {
        it("throws on malformed JSON", () => {
            expect(() => deserialize("{not json")).toThrow()
        })

        it("throws on a wrong version", () => {
            expect(() => deserialize(JSON.stringify({ version: 2, units: "mm", entities: [] }))).toThrow(/version/)
        })

        it("throws on wrong units", () => {
            expect(() => deserialize(JSON.stringify({ version: 1, units: "cm", entities: [] }))).toThrow(/units/)
        })

        it("throws when entities is not an array", () => {
            expect(() => deserialize(JSON.stringify({ version: 1, units: "mm", entities: {} }))).toThrow(/entities/)
        })

        it("throws on an unknown entity type", () => {
            const bad = { version: 1, units: "mm", entities: [{ id: "x", type: "blob" }] }
            expect(() => deserialize(JSON.stringify(bad))).toThrow(/type/)
        })

        it("throws when a required field is missing", () => {
            const bad = { version: 1, units: "mm", entities: [{ id: "l", type: "line", a: [0, 0, 0] }] }
            expect(() => deserialize(JSON.stringify(bad))).toThrow(/"b"/)
        })

        it("throws on a wrong-length vector", () => {
            const bad = { version: 1, units: "mm", entities: [{ id: "l", type: "line", a: [0, 0], b: [1, 1, 1] }] }
            expect(() => deserialize(JSON.stringify(bad))).toThrow(/Vec3/)
        })

        it("throws on a non-finite vector component", () => {
            // NaN survives the structural shape but must be rejected as non-finite.
            const bad = {
                version: 1,
                units: "mm",
                entities: [{ id: "c", type: "circle", center: [0, 0, 0], radius: Number.NaN, normal: [0, 0, 1] }]
            }
            expect(() => deserialize(JSON.stringify(bad))).toThrow(/radius/)
        })

        it("throws on an empty polyline points array", () => {
            const bad = {
                version: 1,
                units: "mm",
                entities: [{ id: "p", type: "polyline", points: [], closed: false }]
            }
            expect(() => deserialize(JSON.stringify(bad))).toThrow(/points/)
        })
    })
})
