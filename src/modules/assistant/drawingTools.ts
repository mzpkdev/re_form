import { formatToolError } from "../../lib/validate"
import {
    type Drawing,
    detectRegions,
    type Entity,
    getDrawing,
    loadDrawing,
    newId,
    type Plane,
    unprojectPoint,
    type Vec2
} from "../drawing"
import type { ToolDef } from "./openrouter"

/**
 * React-free "drawing tool" layer: the function an LLM calls to define the solid
 * by its orthographic VIEWS, plus the dispatcher that converts those views into
 * the document and commits it.
 *
 * Why views, not raw entities: this engine reconstructs a solid by intersecting
 * the silhouettes of the front/top/side views (see `extrude.ts`). Handing the
 * model raw 3D-coordinate entities invited it to build a literal 3D wireframe,
 * which the reconstruction can't use. So the model speaks the engine's own
 * language — closed 2D outline polygons per view — and the host lifts each
 * polygon onto its origin-plane via `unprojectPoint`, exactly as the interactive
 * canvas does. The model cannot produce a wireframe or an off-plane face.
 *
 * Module-internal: consumed only by AssistantPanel, not re-exported from the
 * module barrel.
 */

/** The three principal views, in the order they are read from a tool call. */
const VIEWS = ["front", "top", "side"] as const

/** Schema fragment: one view is a list of closed outline polygons of 2D points. */
const VIEW_SCHEMA = {
    type: "array",
    description:
        "Closed silhouette polygons for this view. Each polygon is a list of [x, y] points (mm) in this view's own 2D space; at least 3 points, auto-closed.",
    items: {
        type: "array",
        minItems: 3,
        items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }
    }
} as const

/**
 * The single tool handed to the model. The description teaches the multi-view
 * reconstruction model — the one thing the format does not make obvious.
 */
export const DRAWING_TOOLS: ToolDef[] = [
    {
        type: "function",
        function: {
            name: "set_views",
            description: [
                "Define the 3D solid by its orthographic views. The solid is the INTERSECTION of the view silhouettes (a machinist's three-view reconstruction), so provide at least TWO of front/top/side or no solid forms.",
                "Each view is a list of closed outline polygons, given as 2D [x, y] points in millimetres in that view's own plane.",
                "Views: front = looking along -Z (X right, Y up); top = looking down -Y (X right, depth); side = looking along -X (depth, Y up).",
                "Example — a 50mm cube is three 50x50 squares: front, top, and side each [[[0,0],[50,0],[50,50],[0,50]]].",
                "set_views REPLACES the whole drawing; send every view you want each call."
            ].join(" "),
            parameters: {
                type: "object",
                properties: { front: VIEW_SCHEMA, top: VIEW_SCHEMA, side: VIEW_SCHEMA }
            }
        }
    }
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** A Vec2 is an array of exactly two finite numbers. */
const isVec2 = (value: unknown): value is Vec2 =>
    Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)

/**
 * Lift one view's polygons onto its origin-plane, appending a closed polyline
 * entity per polygon. Throws a descriptive error on any malformed polygon, which
 * the caller funnels to `formatToolError`.
 */
const liftView = (raw: unknown, plane: Plane, entities: Entity[]): void => {
    if (!Array.isArray(raw)) throw new Error(`"${plane}" must be an array of polygons`)
    raw.forEach((polygon, pi) => {
        if (!Array.isArray(polygon) || polygon.length < 3) {
            throw new Error(`"${plane}" polygon ${pi} needs at least 3 points`)
        }
        const points = polygon.map((point, idx) => {
            if (!isVec2(point)) throw new Error(`"${plane}" polygon ${pi} point ${idx} must be [x, y] finite numbers`)
            return unprojectPoint(point, plane)
        })
        entities.push({ id: newId(), type: "polyline", points, closed: true })
    })
}

/**
 * Execute the drawing tool call against the live document store. Converts the
 * per-view 2D polygons into closed polyline entities on their origin-planes,
 * replaces the document, and returns a short result for the model: the view and
 * silhouette counts (with a note when fewer than two views were given, since the
 * reconstruction then yields no solid), or — for ANY bad input, unknown tool, or
 * malformed JSON — an `Error: <message>` string. Never throws.
 */
export const executeDrawingTool = (name: string, rawArgs: string): string => {
    try {
        if (name !== "set_views") throw new Error(`unknown tool "${name}"`)

        let parsed: unknown
        try {
            parsed = JSON.parse(rawArgs)
        } catch (error) {
            throw new Error(`invalid JSON arguments (${(error as Error).message})`)
        }
        if (!isRecord(parsed)) throw new Error("arguments must be a JSON object")

        const entities: Entity[] = []
        let viewCount = 0
        for (const plane of VIEWS) {
            const raw = parsed[plane]
            if (raw === undefined || raw === null) continue
            if (Array.isArray(raw) && raw.length === 0) continue
            liftView(raw, plane, entities)
            viewCount++
        }
        if (entities.length === 0) {
            throw new Error("provide at least one view (front/top/side), each a list of polygons")
        }

        const doc: Drawing = { version: 1, units: "mm", gridSize: getDrawing().gridSize, entities }
        loadDrawing(doc)

        const note = viewCount < 2 ? " — a solid needs at least 2 views, so nothing renders yet" : ""
        return `views set: ${viewCount} view(s), ${entities.length} silhouette(s)${note}`
    } catch (error) {
        return formatToolError(error)
    }
}

/**
 * The current drawing as per-view 2D polygons — the same shape `set_views`
 * accepts — so the assistant sees the geometry in the language it writes.
 * Built from `detectRegions`, which already returns each closed region as a 2D
 * contour tagged with its plane.
 */
export const describeViews = (): string => {
    const byPlane: Record<Plane, Vec2[][]> = { front: [], top: [], side: [] }
    for (const { plane, contour } of detectRegions(getDrawing())) {
        byPlane[plane].push(contour)
    }
    return JSON.stringify(byPlane)
}
