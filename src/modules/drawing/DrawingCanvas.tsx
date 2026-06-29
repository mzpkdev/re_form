import { useCallback, useEffect, useRef, useState } from "react"
import { removeEntities, useDrawing, useGridSize } from "./documentStore"
import { clearSelection, setSelection, useActivePlane, useActiveTool, usePreview, useSelection } from "./editorStore"
import { hitTest } from "./hitTest"
import { flattenEntity } from "./project"
import { snapToGrid } from "./snap"
import type { Entity, Plane, Vec2 } from "./types"
import { useDrawTool } from "./useDrawTool"

/**
 * A rectangle in SVG user space (millimetres). It IS the `<svg viewBox>`, so pan
 * is a translation of `{ x, y }` and zoom a scale of `{ w, h }` about a fixed
 * point. World-up renders as screen-up via a `scale(1,-1)` group (see below), so
 * this box lives in that already-flipped space: a world point `(wx, wy)` sits at
 * box coordinates `(wx, -wy)`.
 */
interface ViewBox {
    x: number
    y: number
    w: number
    h: number
}

/**
 * The visible window as an axis-aligned rectangle in WORLD space (y-up) — the
 * coordinate space INSIDE the `scale(1,-1)` flip group. This is what the grid and
 * axes must cover: deriving their extent from the raw `viewBox` (flipped space)
 * only lines up while the view is vertically centred on the origin, so any
 * vertical pan/zoom would mirror their coverage away (see `worldRect`).
 */
interface WorldRect {
    x0: number
    x1: number
    y0: number
    y1: number
}

/**
 * Derive the visible world-space rectangle from the viewBox. X is untouched by the
 * flip; Y is mirrored, so the box's top/bottom map to world bottom/top.
 */
const worldRect = (vb: ViewBox): WorldRect => ({
    x0: vb.x,
    x1: vb.x + vb.w,
    y0: -(vb.y + vb.h),
    y1: -vb.y
})

/** Half-extent (mm) of the initial window around the origin — covers ~±100 mm. */
const INITIAL_HALF_EXTENT = 100

/** Wheel zoom factor per notch; <1 zooms in, the reciprocal zooms out. */
const ZOOM_STEP = 0.9

/** Hide the grid once a cell would shrink below ~this many on-screen px-equivalents. */
const MAX_GRID_LINES_ACROSS = 400

/** Clamp on the visible window so wheel spam can't blow the viewBox up or to nil. */
const MIN_SPAN = 1
const MAX_SPAN = 100_000

/**
 * Pointer travel (screen px) under which a select-tool press counts as a CLICK
 * (hit-test) rather than a PAN. Above it, the drag panned and selection is left
 * alone.
 */
const CLICK_SLOP_PX = 4

/** Pick radius (screen px) for click selection, converted to world units per click. */
const PICK_RADIUS_PX = 8

const flippedY = "scale(1,-1)"

/**
 * Interactive SVG renderer for the drawing document on the active plane.
 *
 * Everything visible — grid, origin axes, entities — lives inside ONE
 * `scale(1,-1)` group so the whole scene shares a single y-up coordinate space
 * (SVG's y points down). The `viewBox` held in state is the pan/zoom window; a
 * `ResizeObserver` keeps it square-aspect-correct to the container so circles
 * stay round. Pointer handling branches on the active tool: with `select`, a
 * left-drag on the background pans, while a left press that barely moves
 * (< `CLICK_SLOP_PX`) is a click that hit-tests entities and (re)sets the
 * selection — a miss clears it. With a draw tool, left-button events feed
 * `useDrawTool` (entity creation) and panning moves to the middle mouse button.
 * Wheel zooms toward the cursor for every tool. Selected entities render in the
 * highlight color and Delete/Backspace removes them (skipped while a form field
 * is focused). The in-progress ghost from the editor store renders dashed in the
 * accent color over the committed entities.
 */
export const DrawingCanvas = () => {
    const drawing = useDrawing()
    const gridSize = useGridSize()
    const activePlane = useActivePlane()
    const activeTool = useActiveTool()
    const preview = usePreview()
    const selection = useSelection()
    const selectedIds = new Set(selection)

    const svgRef = useRef<SVGSVGElement>(null)

    // The grid intersection under the cursor while a draw tool is active — the
    // "this is where a click lands" marker. Null with `select` or off-canvas.
    const [snapPoint, setSnapPoint] = useState<Vec2 | null>(null)
    const [viewBox, setViewBox] = useState<ViewBox>({
        x: -INITIAL_HALF_EXTENT,
        y: -INITIAL_HALF_EXTENT,
        w: 2 * INITIAL_HALF_EXTENT,
        h: 2 * INITIAL_HALF_EXTENT
    })

    // Keep the viewBox aspect ratio locked to the container's so 1 mm reads the
    // same horizontally and vertically (round circles, square grid). We adjust
    // height to match width, preserving the horizontal span and the center.
    useEffect(() => {
        const svg = svgRef.current
        if (!svg) {
            return
        }
        const resize = () => {
            const { clientWidth, clientHeight } = svg
            if (clientWidth === 0 || clientHeight === 0) {
                return
            }
            const aspect = clientHeight / clientWidth
            setViewBox((prev) => {
                const nextH = prev.w * aspect
                if (nextH === prev.h) {
                    return prev
                }
                // Re-center vertically so the resize grows/shrinks symmetrically.
                return { ...prev, y: prev.y + (prev.h - nextH) / 2, h: nextH }
            })
        }
        resize()
        const observer = new ResizeObserver(resize)
        observer.observe(svg)
        return () => observer.disconnect()
    }, [])

    // The draw machine and pan handlers read the *current* viewBox to map screen
    // pixels to world units. Keep it in a ref so the coordinate helpers can have a
    // stable identity (and not go stale) across the re-renders setPreview triggers.
    const viewBoxRef = useRef(viewBox)
    viewBoxRef.current = viewBox

    // The Delete handler binds once but must act on the *current* selection, so
    // mirror it into a ref rather than re-subscribing the listener every change.
    const selectionRef = useRef(selection)
    selectionRef.current = selection

    // Map a pointer event to a point in viewBox (flipped-SVG) space.
    const eventToBox = useCallback((event: { clientX: number; clientY: number }): Vec2 => {
        const svg = svgRef.current
        if (!svg) {
            return [0, 0]
        }
        const vb = viewBoxRef.current
        const rect = svg.getBoundingClientRect()
        const fx = (event.clientX - rect.left) / rect.width
        const fy = (event.clientY - rect.top) / rect.height
        return [vb.x + fx * vb.w, vb.y + fy * vb.h]
    }, [])

    // Map a pointer event straight to a world-2D (y-up) point: take the viewBox
    // (flipped) coords and undo the SVG `scale(1,-1)` flip. THIS is the input the
    // draw tools consume — `unprojectPoint([bx, -by], plane)` then lands it in 3D.
    const eventToWorld2D = useCallback(
        (event: { clientX: number; clientY: number }): Vec2 => {
            const [bx, by] = eventToBox(event)
            return [bx, -by]
        },
        [eventToBox]
    )

    const draw = useDrawTool(eventToWorld2D, activeTool, activePlane, gridSize)

    // Update the snap marker from the cursor whenever a draw tool is active.
    const updateSnapPoint = useCallback(
        (event: { clientX: number; clientY: number }) => {
            if (activeTool === "select") return
            setSnapPoint(snapToGrid(eventToWorld2D(event), gridSize))
        },
        [activeTool, eventToWorld2D, gridSize]
    )

    // Zoom toward the cursor: scale the span, then shift the origin so the world
    // point under the pointer stays put.
    const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
        const [px, py] = eventToBox(event)
        const factor = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
        setViewBox((prev) => {
            const w = Math.min(MAX_SPAN, Math.max(MIN_SPAN, prev.w * factor))
            const h = Math.min(MAX_SPAN, Math.max(MIN_SPAN, prev.h * factor))
            return {
                x: px - ((px - prev.x) * w) / prev.w,
                y: py - ((py - prev.y) * h) / prev.h,
                w,
                h
            }
        })
    }

    // A drag pans the viewBox. We track the last pointer position in box space and
    // translate by the delta. Which button starts a pan depends on the tool: with
    // `select` it's the left button; with a draw tool the left button draws, so
    // panning moves to the middle button (button 1). `downScreen` is the press
    // point in raw screen px, kept so pointerup can tell a click from a pan by how
    // far the pointer travelled.
    const panRef = useRef<{ pointerId: number; last: Vec2; downScreen: Vec2 } | null>(null)
    const panButton = activeTool === "select" ? 0 : 1

    const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
        if (event.button === panButton) {
            event.currentTarget.setPointerCapture(event.pointerId)
            panRef.current = {
                pointerId: event.pointerId,
                last: eventToBox(event),
                downScreen: [event.clientX, event.clientY]
            }
            return
        }
        // Left button with a draw tool active: hand off to the draw machine.
        if (activeTool !== "select" && event.button === 0) {
            draw.onPointerDown(event)
        }
    }

    const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        const pan = panRef.current
        if (pan && pan.pointerId === event.pointerId) {
            const [cx, cy] = eventToBox(event)
            // eventToBox reads the *current* viewBox, so translate by the delta from
            // where the drag last sat, then re-anchor `last` to the new pointer spot.
            const dx = cx - pan.last[0]
            const dy = cy - pan.last[1]
            setViewBox((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }))
            pan.last = [cx - dx, cy - dy]
            return
        }
        if (activeTool !== "select") {
            updateSnapPoint(event)
            draw.onPointerMove(event)
        }
    }

    const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
        const pan = panRef.current
        if (pan && pan.pointerId === event.pointerId) {
            event.currentTarget.releasePointerCapture(event.pointerId)
            panRef.current = null
            // With the select tool, a press that barely moved is a CLICK, not a
            // pan: hit-test under the pointer and (re)set the selection — a miss
            // clears it. A real drag (moved more) panned, so leave selection be.
            if (activeTool === "select") {
                const dx = event.clientX - pan.downScreen[0]
                const dy = event.clientY - pan.downScreen[1]
                if (Math.hypot(dx, dy) < CLICK_SLOP_PX) {
                    const svg = svgRef.current
                    const vb = viewBoxRef.current
                    // ~PICK_RADIUS_PX in world units: viewBox spans the full pixel
                    // width, so one screen px is vb.w / clientWidth world units.
                    const tol = svg ? (PICK_RADIUS_PX * vb.w) / svg.clientWidth : 0
                    const id = hitTest(drawing.entities, eventToWorld2D(event), activePlane, tol)
                    if (id) {
                        setSelection([id])
                    } else {
                        clearSelection()
                    }
                }
            }
            return
        }
        if (activeTool !== "select") {
            draw.onPointerUp(event)
        }
    }

    const handlePointerCancel = (event: React.PointerEvent<SVGSVGElement>) => {
        const pan = panRef.current
        if (pan && pan.pointerId === event.pointerId) {
            event.currentTarget.releasePointerCapture(event.pointerId)
            panRef.current = null
        }
        setSnapPoint(null)
    }

    // Drop the snap marker when the cursor leaves the canvas or the active tool
    // changes (e.g. back to `select`), so a stale crosshair never lingers.
    const handlePointerLeave = () => setSnapPoint(null)

    // biome-ignore lint/correctness/useExhaustiveDependencies: clear the marker on any tool switch.
    useEffect(() => {
        setSnapPoint(null)
    }, [activeTool])

    // Delete/Backspace removes the current selection in one undoable step. Bound
    // once on the document (canvas SVGs don't focus to receive keydown). GUARD:
    // bail when a form field is focused so deleting in the grid mm input — or any
    // future text entry — edits text instead of nuking entities.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Delete" && event.key !== "Backspace") return
            const tag = document.activeElement?.tagName
            if (tag === "INPUT" || tag === "TEXTAREA") return
            const ids = selectionRef.current
            if (ids.length === 0) return
            event.preventDefault()
            removeEntities(ids)
            clearSelection()
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [])

    // The visible world-space rect (inside the flip group); the grid and axes cover
    // THIS so they fill the window for any pan/zoom, not just the centred view.
    const world = worldRect(viewBox)

    return (
        <svg
            ref={svgRef}
            className="size-full touch-none select-none bg-surface-container-low text-on-surface"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            preserveAspectRatio="xMidYMid meet"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
            onDoubleClick={draw.onDoubleClick}
            role="img"
            aria-label="Technical drawing canvas"
        >
            <g transform={flippedY}>
                <Grid rect={world} gridSize={gridSize} dense={viewBox.w / gridSize > MAX_GRID_LINES_ACROSS} />
                <Axes rect={world} />
                {drawing.entities.map((entity) => (
                    <EntityShape
                        key={entity.id}
                        entity={entity}
                        plane={activePlane}
                        selected={selectedIds.has(entity.id)}
                    />
                ))}
                {preview && <EntityShape entity={preview} plane={activePlane} preview />}
                {snapPoint && <SnapMarker point={snapPoint} span={viewBox.w} />}
                {draw.closeArmed && draw.firstVertex && <CloseMarker point={draw.firstVertex} span={viewBox.w} />}
            </g>
        </svg>
    )
}

/**
 * One flattened entity as a constant-weight polyline (open) or polygon (closed).
 * The in-progress ghost (`preview`) reuses the same flattening but renders dashed
 * in the accent color so it reads as live and not-yet-committed. A `selected`
 * entity renders heavier in the highlight color — a third hue distinct from the
 * entity ink and the preview accent.
 */
const EntityShape = ({
    entity,
    plane,
    preview = false,
    selected = false
}: {
    entity: Entity
    plane: Plane
    preview?: boolean
    selected?: boolean
}) => {
    const { points, closed } = flattenEntity(entity, plane)
    if (points.length < 2) {
        return null
    }
    const pointsAttr = points.map(([x, y]) => `${x},${y}`).join(" ")
    const className = preview
        ? "stroke-drawing-preview stroke-2"
        : selected
          ? "stroke-drawing-selected stroke-emphasis"
          : "stroke-drawing-entity stroke-2"
    const shared = {
        points: pointsAttr,
        fill: "none",
        vectorEffect: "non-scaling-stroke" as const,
        strokeDasharray: preview ? "6 4" : undefined,
        className
    }
    return closed ? <polygon {...shared} /> : <polyline {...shared} />
}

/**
 * A faint background grid covering the visible window, spaced at the DOCUMENT grid
 * size (mm) so the visible grid and the snapping share one source of truth. It is
 * laid out in WORLD space (the `rect`, already y-flipped by the caller) so it fills
 * the window for any pan/zoom. Lines are constant-weight so they don't fatten under
 * zoom. Skipped entirely (`dense`) once the spacing would be too small to read.
 */
const Grid = ({ rect, gridSize, dense }: { rect: WorldRect; gridSize: number; dense: boolean }) => {
    // Hide the grid once cells get too small to read (avoids thousands of lines).
    if (dense) {
        return null
    }
    const startX = Math.floor(rect.x0 / gridSize) * gridSize
    const startY = Math.floor(rect.y0 / gridSize) * gridSize

    const lines: React.ReactNode[] = []
    for (let x = startX; x <= rect.x1; x += gridSize) {
        lines.push(
            <line
                key={`v${x}`}
                x1={x}
                y1={rect.y0}
                x2={x}
                y2={rect.y1}
                vectorEffect="non-scaling-stroke"
                className="stroke-drawing-grid"
            />
        )
    }
    for (let y = startY; y <= rect.y1; y += gridSize) {
        lines.push(
            <line
                key={`h${y}`}
                x1={rect.x0}
                y1={y}
                x2={rect.x1}
                y2={y}
                vectorEffect="non-scaling-stroke"
                className="stroke-drawing-grid"
            />
        )
    }
    return <g>{lines}</g>
}

/**
 * The "your click lands here" indicator: a small crosshair in the accent color at
 * the grid intersection under the cursor while a draw tool is active. Its arm
 * length tracks the visible span (`span` = viewBox width) so it stays a roughly
 * constant on-screen size across zoom; the stroke is constant-weight. Rendered
 * inside the flipped group, so it shares the entities' coordinate space.
 */
const SnapMarker = ({ point, span }: { point: Vec2; span: number }) => {
    const [x, y] = point
    const arm = span / 80
    return (
        <g className="stroke-drawing-preview" vectorEffect="non-scaling-stroke">
            <line x1={x - arm} y1={y} x2={x + arm} y2={y} vectorEffect="non-scaling-stroke" />
            <line x1={x} y1={y - arm} x2={x} y2={y + arm} vectorEffect="non-scaling-stroke" />
        </g>
    )
}

/**
 * Slightly stronger X/Y axis lines through the origin, spanning the visible window.
 * Laid out in WORLD space (the y-flipped `rect`) so they stay full-width/height for
 * any pan/zoom, matching the grid.
 */
const Axes = ({ rect }: { rect: WorldRect }) => (
    <g>
        <line
            x1={rect.x0}
            y1={0}
            x2={rect.x1}
            y2={0}
            vectorEffect="non-scaling-stroke"
            className="stroke-drawing-axis"
        />
        <line
            x1={0}
            y1={rect.y0}
            x2={0}
            y2={rect.y1}
            vectorEffect="non-scaling-stroke"
            className="stroke-drawing-axis"
        />
    </g>
)

/**
 * The "this click will CLOSE the polyline" cue: a small ring at the first vertex,
 * shown only when a polyline has ≥3 vertices and the snapped cursor is on vertex 0.
 * Sized off the visible span (`span` = viewBox width) so it stays a roughly constant
 * on-screen size across zoom; constant-weight stroke. Rendered inside the flipped
 * group, so it shares the entities' coordinate space.
 */
const CloseMarker = ({ point, span }: { point: Vec2; span: number }) => {
    const [x, y] = point
    const r = span / 60
    return (
        <circle
            cx={x}
            cy={y}
            r={r}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className="stroke-drawing-preview stroke-2"
        />
    )
}
