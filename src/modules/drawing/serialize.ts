import { DEFAULT_GRID_SIZE } from "./document"
import type { Arc, Circle, Drawing, Entity, Line, Polyline, Vec3 } from "./types"

/**
 * Round-trip a Drawing through JSON with validation on the way in.
 *
 * `serialize` is a plain `JSON.stringify`; `deserialize` parses then validates
 * every field, throwing a descriptive `Error` on any problem (matching the
 * repo's plain-Error style). Guarantee: deserialize(serialize(doc)) deep-equals
 * doc. React-free by design.
 */

export const serialize = (doc: Drawing): string => JSON.stringify(doc)

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const isVec3 = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const ENTITY_TYPES = new Set(["line", "circle", "arc", "polyline"])

const validateEntity = (raw: unknown, index: number): Entity => {
    const where = `entities[${index}]`
    if (!isRecord(raw)) throw new Error(`${where}: expected an object`)
    if (typeof raw.id !== "string") throw new Error(`${where}: "id" must be a string`)
    if (typeof raw.type !== "string" || !ENTITY_TYPES.has(raw.type)) {
        throw new Error(`${where}: invalid "type" ${JSON.stringify(raw.type)}`)
    }

    switch (raw.type) {
        case "line": {
            if (!isVec3(raw.a)) throw new Error(`${where}: "a" must be a Vec3 of 3 finite numbers`)
            if (!isVec3(raw.b)) throw new Error(`${where}: "b" must be a Vec3 of 3 finite numbers`)
            return { id: raw.id, type: "line", a: raw.a, b: raw.b } satisfies Line
        }
        case "circle": {
            if (!isVec3(raw.center)) throw new Error(`${where}: "center" must be a Vec3 of 3 finite numbers`)
            if (!isFiniteNumber(raw.radius)) throw new Error(`${where}: "radius" must be a finite number`)
            if (!isVec3(raw.normal)) throw new Error(`${where}: "normal" must be a Vec3 of 3 finite numbers`)
            return {
                id: raw.id,
                type: "circle",
                center: raw.center,
                radius: raw.radius,
                normal: raw.normal
            } satisfies Circle
        }
        case "arc": {
            if (!isVec3(raw.center)) throw new Error(`${where}: "center" must be a Vec3 of 3 finite numbers`)
            if (!isFiniteNumber(raw.radius)) throw new Error(`${where}: "radius" must be a finite number`)
            if (!isVec3(raw.normal)) throw new Error(`${where}: "normal" must be a Vec3 of 3 finite numbers`)
            if (!isFiniteNumber(raw.startDeg)) throw new Error(`${where}: "startDeg" must be a finite number`)
            if (!isFiniteNumber(raw.endDeg)) throw new Error(`${where}: "endDeg" must be a finite number`)
            return {
                id: raw.id,
                type: "arc",
                center: raw.center,
                radius: raw.radius,
                normal: raw.normal,
                startDeg: raw.startDeg,
                endDeg: raw.endDeg
            } satisfies Arc
        }
        case "polyline": {
            if (!Array.isArray(raw.points) || raw.points.length === 0) {
                throw new Error(`${where}: "points" must be a non-empty array of Vec3`)
            }
            raw.points.forEach((point, pointIndex) => {
                if (!isVec3(point)) {
                    throw new Error(`${where}.points[${pointIndex}]: must be a Vec3 of 3 finite numbers`)
                }
            })
            if (typeof raw.closed !== "boolean") throw new Error(`${where}: "closed" must be a boolean`)
            return { id: raw.id, type: "polyline", points: raw.points as Vec3[], closed: raw.closed } satisfies Polyline
        }
        default:
            // Unreachable: ENTITY_TYPES gates the switch above.
            throw new Error(`${where}: invalid "type" ${JSON.stringify(raw.type)}`)
    }
}

/** Parse and validate JSON into a typed Drawing, throwing on any malformation. */
export const deserialize = (json: string): Drawing => {
    let parsed: unknown
    try {
        parsed = JSON.parse(json)
    } catch (error) {
        throw new Error(`drawing: invalid JSON (${(error as Error).message})`)
    }

    if (!isRecord(parsed)) throw new Error("drawing: expected a top-level object")
    if (parsed.version !== 1) throw new Error(`drawing: "version" must be 1, got ${JSON.stringify(parsed.version)}`)
    if (parsed.units !== "mm") throw new Error(`drawing: "units" must be "mm", got ${JSON.stringify(parsed.units)}`)
    if (!Array.isArray(parsed.entities)) throw new Error('drawing: "entities" must be an array')

    // gridSize is lenient/forward-compatible: validated as a positive finite
    // number when present, defaulted when an older document omits it entirely.
    const gridSize = parseGridSize(parsed.gridSize)

    const entities = parsed.entities.map((entity, index) => validateEntity(entity, index))
    return { version: 1, units: "mm", gridSize, entities }
}

/** A grid size must be a positive, finite number; an absent one defaults to 10. */
const parseGridSize = (value: unknown): number => {
    if (value === undefined) return DEFAULT_GRID_SIZE
    if (!isFiniteNumber(value) || value <= 0) {
        throw new Error(`drawing: "gridSize" must be a positive finite number, got ${JSON.stringify(value)}`)
    }
    return value
}
