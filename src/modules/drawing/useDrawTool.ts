import { useCallback, useEffect, useRef, useState } from "react"
import { buildEntity } from "./buildEntity"
import { addEntity } from "./documentStore"
import { setPreview, type Tool } from "./editorStore"
import { constrainToAngle, snapToGrid } from "./snap"
import type { Plane, Vec2 } from "./types"

/** Two world-2D points are the same grid intersection when both coords match. */
const samePoint = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1]

/**
 * The pointer-driven entity-creation state machine, as a React hook.
 *
 * This is a TECHNICAL-drawing canvas: there are no freeform coordinates. Every
 * captured point is hard-snapped before it reaches `buildEntity`:
 *  - the FIRST point of a segment snaps to the nearest grid intersection
 *    (`snapToGrid`);
 *  - every SUBSEQUENT point (line drag end, next polyline vertex, and the live
 *    preview) is constrained to a 0/45/90° ray from its anchor and landed on a
 *    grid intersection (`constrainToAngle`).
 *
 * Three interaction shapes live here:
 *  - **line** is click-drag: pointerdown anchors a (snapped) start point and
 *    seeds a degenerate preview, pointermove rubber-bands the constrained end,
 *    pointerup commits the entity (when non-degenerate) and clears the ghost.
 *  - **rectangle** is click-drag too, but the two corners define an axis-aligned
 *    box: the far corner grid-snaps WITHOUT the line's angle lock, and the
 *    release commits a CLOSED 4-corner polyline (the same shape a hand-drawn box
 *    would produce — `buildEntity` owns the corner expansion).
 *  - **polyline** is multi-click: each pointerdown appends a (constrained)
 *    vertex, pointermove previews "vertices so far + constrained cursor", and a
 *    double-click (or Enter) commits it OPEN. Once there are ≥3 vertices, clicking
 *    the FIRST vertex again instead commits a CLOSED polyline (a polygon); the
 *    hook exposes `closeArmed` + `firstVertex` so the canvas can flag that the
 *    next click would close.
 *
 * `select`/`circle`/`arc` draw nothing here. The in-progress
 * vertex list and drag anchor are LOCAL refs — only the ghost `Entity` ever
 * reaches the store (`setPreview`). Esc cancels; changing the tool or plane
 * mid-draw also cancels (the hook resets when they change). The current grid size
 * is read live, so editing it mid-session re-snaps the next captured point. The
 * returned handlers are wired to the SVG by `DrawingCanvas`, which converts
 * pointer events to world-2D via `eventToWorld2D`.
 */
export const useDrawTool = (
    eventToWorld2D: (event: { clientX: number; clientY: number }) => Vec2,
    activeTool: Tool,
    activePlane: Plane,
    gridSize: number
) => {
    // The anchor of an in-flight line drag (already grid-snapped), or null.
    const dragRef = useRef<{ pointerId: number; start: Vec2 } | null>(null)
    // Committed polyline vertices so far (snapped world-2D); empty when idle.
    const verticesRef = useRef<Vec2[]>([])

    // Reactive close-affordance state for the canvas: the first polyline vertex
    // (or null when no polyline is in progress) and whether the snapped cursor is
    // currently on it with ≥3 vertices placed (so the next click would close).
    const [firstVertex, setFirstVertex] = useState<Vec2 | null>(null)
    const [closeArmed, setCloseArmed] = useState(false)

    // Latest tool/plane for the keyboard handler (which isn't re-bound per render).
    const toolRef = useRef(activeTool)
    const planeRef = useRef(activePlane)

    const cancel = useCallback(() => {
        dragRef.current = null
        verticesRef.current = []
        setFirstVertex(null)
        setCloseArmed(false)
        setPreview(null)
    }, [])

    // Switching tool or plane abandons any in-progress draw (and its ghost). A
    // grid-size change does NOT cancel — it only affects the next captured point.
    // biome-ignore lint/correctness/useExhaustiveDependencies: cancel is stable; we intentionally reset only on tool/plane change.
    useEffect(() => {
        toolRef.current = activeTool
        planeRef.current = activePlane
        cancel()
    }, [activeTool, activePlane])

    // Esc cancels from anywhere; Enter commits an in-progress polyline.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                cancel()
                return
            }
            if (event.key === "Enter" && toolRef.current === "polyline") {
                commitPolyline(planeRef.current, verticesRef, false)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [cancel])

    const onPointerDown = useCallback(
        (event: { clientX: number; clientY: number; button: number; pointerId: number; currentTarget: Element }) => {
            // Only the primary (left) button draws; pan and other buttons are
            // handled by the canvas before delegating here.
            if (event.button !== 0) return

            if (activeTool === "polyline") {
                const vertices = verticesRef.current
                const last = vertices[vertices.length - 1]
                // First vertex snaps to grid; later ones lock to a 0/45/90° ray.
                const point = last
                    ? constrainToAngle(last, eventToWorld2D(event), gridSize)
                    : snapToGrid(eventToWorld2D(event), gridSize)
                // Landing the new point back on the first vertex (with ≥3 placed)
                // closes the run into a polygon — commit closed, don't append it.
                const first = vertices[0]
                if (first && vertices.length >= 3 && samePoint(point, first)) {
                    commitPolyline(activePlane, verticesRef, true)
                    setFirstVertex(null)
                    setCloseArmed(false)
                    return
                }
                verticesRef.current = [...vertices, point]
                setFirstVertex(verticesRef.current[0])
                // Just-placed vertex can't itself be the close target yet.
                setCloseArmed(false)
                // Preview the run so far plus the just-placed vertex as the cursor.
                setPreview(buildEntity("polyline", [...verticesRef.current, point], activePlane))
                return
            }

            // rectangle: click-drag like a line — anchor the snapped first corner,
            // capture the pointer, seed the ghost. The release commits the polygon.
            if (activeTool === "rectangle") {
                event.currentTarget.setPointerCapture?.(event.pointerId)
                const start = snapToGrid(eventToWorld2D(event), gridSize)
                dragRef.current = { pointerId: event.pointerId, start }
                setPreview(buildEntity("rectangle", [start, start], activePlane))
                return
            }

            if (activeTool !== "line") return

            // line: anchor the drag at the snapped start and capture the pointer so
            // moves keep flowing even if the cursor leaves the element.
            event.currentTarget.setPointerCapture?.(event.pointerId)
            const start = snapToGrid(eventToWorld2D(event), gridSize)
            dragRef.current = { pointerId: event.pointerId, start }
            setPreview(buildEntity("line", [start, start], activePlane))
        },
        [eventToWorld2D, activeTool, activePlane, gridSize]
    )

    const onPointerMove = useCallback(
        (event: { clientX: number; clientY: number; pointerId: number }) => {
            if (activeTool === "polyline") {
                const vertices = verticesRef.current
                const last = vertices[vertices.length - 1]
                if (!last) return
                const point = constrainToAngle(last, eventToWorld2D(event), gridSize)
                // Arm the close cue when the cursor sits on the first vertex and
                // there are enough vertices for the next click to form a polygon.
                const first = vertices[0]
                setCloseArmed(!!first && vertices.length >= 3 && samePoint(point, first))
                setPreview(buildEntity("polyline", [...vertices, point], activePlane))
                return
            }

            // rectangle: rubber-band the far corner (grid-snapped, no angle lock —
            // a rectangle is not a ray) and preview the live polygon.
            if (activeTool === "rectangle") {
                const drag = dragRef.current
                if (!drag || drag.pointerId !== event.pointerId) return
                const end = snapToGrid(eventToWorld2D(event), gridSize)
                setPreview(buildEntity("rectangle", [drag.start, end], activePlane))
                return
            }

            if (activeTool !== "line") return
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return
            const end = constrainToAngle(drag.start, eventToWorld2D(event), gridSize)
            setPreview(buildEntity("line", [drag.start, end], activePlane))
        },
        [eventToWorld2D, activeTool, activePlane, gridSize]
    )

    const onPointerUp = useCallback(
        (event: { clientX: number; clientY: number; pointerId: number; currentTarget: Element }) => {
            // line and rectangle commit on release; polyline waits for dbl-click/Enter.
            if (activeTool !== "line" && activeTool !== "rectangle") return

            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return
            event.currentTarget.releasePointerCapture?.(event.pointerId)
            dragRef.current = null

            // A line locks its end to a 0/45/90° ray; a rectangle's far corner
            // grid-snaps freely. Either way `buildEntity` rejects a degenerate drag.
            const end =
                activeTool === "rectangle"
                    ? snapToGrid(eventToWorld2D(event), gridSize)
                    : constrainToAngle(drag.start, eventToWorld2D(event), gridSize)
            const entity = buildEntity(activeTool, [drag.start, end], activePlane)
            if (entity) addEntity(entity)
            setPreview(null)
        },
        [eventToWorld2D, activeTool, activePlane, gridSize]
    )

    const onDoubleClick = useCallback(() => {
        if (activeTool !== "polyline") return
        commitPolyline(activePlane, verticesRef, false)
        setFirstVertex(null)
        setCloseArmed(false)
    }, [activeTool, activePlane])

    return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, cancel, firstVertex, closeArmed }
}

/**
 * Finish the in-progress polyline: build it from the committed vertices (`closed`
 * makes it a polygon), append it when valid, and clear both the ghost and the
 * local list either way. `dblclick` lands a final duplicate vertex on top of the
 * last one; `buildEntity` dedupes consecutive points, so that extra click can't
 * poison the result.
 */
const commitPolyline = (plane: Plane, verticesRef: { current: Vec2[] }, closed: boolean) => {
    const entity = buildEntity("polyline", verticesRef.current, plane, closed)
    if (entity) addEntity(entity)
    verticesRef.current = []
    setPreview(null)
}
