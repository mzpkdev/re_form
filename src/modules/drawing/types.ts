/**
 * Schema for the technical-drawing document.
 *
 * The source of truth is a JSON document describing entities in 3D world space
 * (millimetres, right-handed, Y-up to match three.js). A "view" is an
 * orthographic projection of those 3D entities onto a principal plane (see
 * `project.ts`). These are plain, React-free type definitions.
 */

export type Plane = "front" | "top" | "side"

/** A 2D point in editor/view space. */
export type Vec2 = [number, number]

/** A 3D point in world space, millimetres. */
export type Vec3 = [number, number, number]

export interface Line {
    id: string
    type: "line"
    a: Vec3
    b: Vec3
}

export interface Circle {
    id: string
    type: "circle"
    center: Vec3
    radius: number
    normal: Vec3
}

export interface Arc {
    id: string
    type: "arc"
    center: Vec3
    radius: number
    normal: Vec3
    startDeg: number
    endDeg: number
}

export interface Polyline {
    id: string
    type: "polyline"
    points: Vec3[]
    closed: boolean
}

export type Entity = Line | Circle | Arc | Polyline

export interface Drawing {
    version: 1
    units: "mm"
    /**
     * Grid spacing in millimetres. Drives both the visible grid and the hard
     * snapping every placed point obeys — there are no freeform coordinates in a
     * technical drawing. Persisted in the document so it round-trips. Defaults to
     * 10 mm on a fresh document.
     */
    gridSize: number
    entities: Entity[]
}

/**
 * Mint a fresh entity id. Kept out of the pure document ops so those stay
 * deterministic — callers build a fully-formed entity (id included) and hand it
 * to `addEntity`.
 */
export const newId = (): string => crypto.randomUUID()
