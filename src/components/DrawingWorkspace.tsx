import {
    Circle as CircleIcon,
    Download,
    DraftingCompass,
    Grid2x2,
    Magnet,
    MousePointer2,
    Slash,
    Spline,
    Square as SquareIcon,
    Trash2,
    Undo2,
    Waypoints,
    X
} from "lucide-react"
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../design/cn"
import {
    arcPathD,
    type Drawing,
    distance,
    drawingToSvg,
    formatMm,
    type Point,
    rectBounds,
    resolvePoint,
    type Shape,
    shapeDimensions
} from "../lib/drawing"

/** On-screen zoom: 4 px per millimetre, so a 10 mm grid cell renders at 40 px (matches the app's 3D grid). */
const PX_PER_MM = 4

type Tool = "select" | "line" | "rect" | "circle" | "arc" | "polyline"

/** The orthographic views; each keeps its own shapes. */
type ViewId = "front" | "top" | "side"
const VIEWS: { id: ViewId; label: string }[] = [
    { id: "front", label: "Front" },
    { id: "top", label: "Top" },
    { id: "side", label: "Side" }
]

/** A committed shape plus a stable id, so React keys survive moves/deletes without index churn. */
type Placed = { id: number; shape: Shape }
type ByView<T> = Record<ViewId, T>
const emptyByView = <T,>(make: () => T): ByView<T> => ({ front: make(), top: make(), side: make() })

const TOOLS: { id: Tool; icon: typeof Slash; label: string }[] = [
    { id: "select", icon: MousePointer2, label: "Select" },
    { id: "line", icon: Slash, label: "Line" },
    { id: "rect", icon: SquareIcon, label: "Rectangle" },
    { id: "circle", icon: CircleIcon, label: "Circle" },
    { id: "arc", icon: Spline, label: "Arc" },
    { id: "polyline", icon: Waypoints, label: "Polyline" }
]

/** Number of committed points a tool needs before it produces a shape. */
const POINTS_NEEDED: Record<Exclude<Tool, "select" | "polyline">, number> = {
    line: 2,
    rect: 2,
    circle: 2,
    arc: 3
}

const degOf = (center: Point, p: Point): number => (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI

/** Assemble a finished shape from the clicked points, or null if degenerate (zero size). */
const buildShape = (tool: Exclude<Tool, "select" | "polyline">, pts: Point[]): Shape | null => {
    if (tool === "line") {
        return distance(pts[0], pts[1]) > 0 ? { kind: "line", a: pts[0], b: pts[1] } : null
    }
    if (tool === "rect") {
        const { w, h } = rectBounds({ kind: "rect", a: pts[0], b: pts[1] })
        return w > 0 && h > 0 ? { kind: "rect", a: pts[0], b: pts[1] } : null
    }
    if (tool === "circle") {
        const radius = distance(pts[0], pts[1])
        return radius > 0 ? { kind: "circle", center: pts[0], radius } : null
    }
    // arc: center, point fixing radius + start angle, point fixing end angle
    const radius = distance(pts[0], pts[1])
    if (!(radius > 0)) {
        return null
    }
    return { kind: "arc", center: pts[0], radius, startDeg: degOf(pts[0], pts[1]), endDeg: degOf(pts[0], pts[2]) }
}

const translateShape = (shape: Shape, dx: number, dy: number): Shape => {
    const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
    switch (shape.kind) {
        case "line":
        case "rect":
            return { ...shape, a: t(shape.a), b: t(shape.b) }
        case "circle":
        case "arc":
            return { ...shape, center: t(shape.center) }
        case "polyline":
            return { ...shape, points: shape.points.map(t) }
    }
}

const shapeBBox = (shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } => {
    const pts: Point[] =
        shape.kind === "polyline"
            ? shape.points
            : shape.kind === "line" || shape.kind === "rect"
              ? [shape.a, shape.b]
              : [
                    { x: shape.center.x - shape.radius, y: shape.center.y - shape.radius },
                    { x: shape.center.x + shape.radius, y: shape.center.y + shape.radius }
                ]
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** The topmost placed shape whose bounding box (inflated by `tol`) contains `p`, else null. */
const hitTest = (items: Placed[], p: Point, tol: number): Placed | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const b = shapeBBox(items[i].shape)
        if (p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol) {
            return items[i]
        }
    }
    return null
}

/** Where to anchor a shape's dimension label (mm), nudged clear of the geometry. */
const labelAnchor = (shape: Shape): Point => {
    switch (shape.kind) {
        case "line":
            return { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 - 2.5 }
        case "rect": {
            const { x, y, w } = rectBounds(shape)
            return { x: x + w / 2, y: y - 2.5 }
        }
        case "circle":
        case "arc":
            return shape.center
        case "polyline":
            return { x: shape.points[0].x, y: shape.points[0].y - 2.5 }
    }
}

/** Render one shape's geometry as SVG (stroke comes from the parent's text color). */
const ShapeGeometry = ({ shape, width }: { shape: Shape; width: number }) => {
    const common = {
        fill: "none",
        stroke: "currentColor",
        strokeWidth: width,
        vectorEffect: "non-scaling-stroke" as const
    }
    switch (shape.kind) {
        case "line":
            return <line x1={shape.a.x} y1={shape.a.y} x2={shape.b.x} y2={shape.b.y} {...common} />
        case "rect": {
            const { x, y, w, h } = rectBounds(shape)
            return <rect x={x} y={y} width={w} height={h} {...common} />
        }
        case "circle":
            return <circle cx={shape.center.x} cy={shape.center.y} r={shape.radius} {...common} />
        case "arc":
            return <path d={arcPathD(shape)} {...common} />
        case "polyline": {
            const pts = shape.points.map((p) => `${p.x},${p.y}`).join(" ")
            return shape.closed ? <polygon points={pts} {...common} /> : <polyline points={pts} {...common} />
        }
    }
}

const IconButton = ({
    icon: Icon,
    label,
    active,
    onClick,
    disabled
}: {
    icon: typeof Slash
    label: string
    active?: boolean
    onClick: () => void
    disabled?: boolean
}) => (
    <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
            "flex size-9 items-center justify-center border transition-colors disabled:opacity-40",
            active
                ? "border-primary bg-primary/10 text-primary"
                : "border-transparent text-on-surface-variant hover:bg-surface-container hover:text-primary"
        )}
    >
        <Icon className="size-4" />
    </button>
)

const SectionLabel = ({ children }: { children: string }) => (
    <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">{children}</div>
)

/**
 * The drawing mode: a full-bleed A4 sheet that replaces the 3D viewport, plus a
 * right-side panel of drawing options. Mounted at all times and shown/hidden via
 * `active` (driven by the sidebar's "Drawing" item), so the per-view shapes
 * survive leaving and re-entering the mode.
 */
export const DrawingWorkspace = ({ active, onClose }: { active: boolean; onClose: () => void }) => {
    const svgRef = useRef<SVGSVGElement>(null)
    const wrapRef = useRef<HTMLDivElement>(null)
    const idRef = useRef(0)
    const [view, setView] = useState<ViewId>("front")
    const [tool, setTool] = useState<Tool>("line")
    const [placedByView, setPlacedByView] = useState<ByView<Placed[]>>(() => emptyByView<Placed[]>(() => []))
    const [historyByView, setHistoryByView] = useState<ByView<Placed[][]>>(() => emptyByView<Placed[][]>(() => []))
    const [pending, setPending] = useState<Point[]>([])
    const [cursor, setCursor] = useState<Point | null>(null)
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [drag, setDrag] = useState<{ start: Point; id: number; origin: Shape } | null>(null)
    const [gridMm, setGridMm] = useState(10)
    const [snapGrid, setSnapGrid] = useState(true)
    const [snapAngleOn, setSnapAngleOn] = useState(true)
    // Pixel size of the canvas area; the sheet's mm dimensions are derived from it
    // so the drawing surface fills all available space with no letterboxed margins.
    const [size, setSize] = useState({ w: 1000, h: 700 })

    // The active view drives which shapes/history are live.
    const placed = placedByView[view]
    const history = historyByView[view]
    const sheetW = Math.max(1, size.w / PX_PER_MM)
    const sheetH = Math.max(1, size.h / PX_PER_MM)

    const mutatePlaced = (fn: (prev: Placed[]) => Placed[]) =>
        setPlacedByView((all) => ({ ...all, [view]: fn(all[view]) }))

    // Convert a pointer event to millimetres on the sheet. getScreenCTM folds in
    // the viewBox scaling AND the preserveAspectRatio letterboxing, so this stays
    // correct however the SVG is sized in its container.
    const toMm = (event: ReactPointerEvent): Point => {
        const svg = svgRef.current
        const ctm = svg?.getScreenCTM()
        if (!svg || !ctm) {
            return { x: 0, y: 0 }
        }
        const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
        return { x: p.x, y: p.y }
    }

    // The reference point angle snap measures from: the previous vertex for
    // multi-click tools, the center for arcs. null disables angle snap.
    const angleFrom = (): Point | null => {
        if (tool === "polyline") {
            return pending.at(-1) ?? null
        }
        if (tool === "line" || tool === "arc") {
            return pending[0] ?? null
        }
        return null
    }

    const resolve = (raw: Point, from: Point | null): Point =>
        resolvePoint(raw, { gridMm, snapGrid, snapAngle: snapAngleOn, angleStep: 45, from })

    const pushHistory = () => setHistoryByView((all) => ({ ...all, [view]: [...all[view].slice(-49), placed] }))

    const commitShape = (shape: Shape | null) => {
        if (!shape) {
            return
        }
        pushHistory()
        idRef.current += 1
        const id = idRef.current
        mutatePlaced((prev) => [...prev, { id, shape }])
    }

    const finishPolyline = (closed: boolean) => {
        if (pending.length >= 2) {
            commitShape({ kind: "polyline", points: pending, closed: closed && pending.length >= 3 })
        }
        setPending([])
    }

    const undo = () => {
        if (history.length === 0) {
            return
        }
        setPlacedByView((all) => ({ ...all, [view]: history[history.length - 1] }))
        setHistoryByView((all) => ({ ...all, [view]: all[view].slice(0, -1) }))
        setSelectedId(null)
    }

    const deleteSelected = () => {
        if (selectedId === null) {
            return
        }
        pushHistory()
        mutatePlaced((prev) => prev.filter((item) => item.id !== selectedId))
        setSelectedId(null)
    }

    const clearAll = () => {
        if (placed.length === 0) {
            return
        }
        pushHistory()
        mutatePlaced(() => [])
        setSelectedId(null)
        setPending([])
    }

    const chooseTool = (next: Tool) => {
        setTool(next)
        setPending([])
        setSelectedId(null)
    }

    const chooseView = (next: ViewId) => {
        setView(next)
        setPending([])
        setSelectedId(null)
        setDrag(null)
    }

    const handlePointerDown = (event: ReactPointerEvent) => {
        const raw = toMm(event)

        if (tool === "select") {
            const hit = hitTest(placed, raw, Math.max(gridMm * 0.4, 3))
            setSelectedId(hit?.id ?? null)
            if (hit) {
                pushHistory()
                setDrag({ start: raw, id: hit.id, origin: hit.shape })
            }
            return
        }

        const point = resolve(raw, angleFrom())

        if (tool === "polyline") {
            if (pending.length >= 3 && distance(point, pending[0]) <= Math.max(gridMm * 0.5, 2)) {
                finishPolyline(true)
                return
            }
            setPending((prev) => [...prev, point])
            return
        }

        const next = [...pending, point]
        if (next.length < POINTS_NEEDED[tool]) {
            setPending(next)
            return
        }
        commitShape(buildShape(tool, next))
        setPending([])
    }

    const handlePointerMove = (event: ReactPointerEvent) => {
        const raw = toMm(event)

        if (drag) {
            let dx = raw.x - drag.start.x
            let dy = raw.y - drag.start.y
            if (snapGrid) {
                dx = Math.round(dx / gridMm) * gridMm
                dy = Math.round(dy / gridMm) * gridMm
            }
            mutatePlaced((prev) =>
                prev.map((item) =>
                    item.id === drag.id ? { ...item, shape: translateShape(drag.origin, dx, dy) } : item
                )
            )
            return
        }

        setCursor(tool === "select" ? raw : resolve(raw, angleFrom()))
    }

    const endDrag = () => setDrag(null)

    // Keyboard shortcuts while drawing is the active mode. Read through a ref so
    // the single bound listener always sees the latest state without re-binding.
    const actionsRef = useRef({ undo, deleteSelected, finishPolyline, cancelPending: () => {} })
    actionsRef.current = {
        undo,
        deleteSelected,
        finishPolyline,
        cancelPending: () => (pending.length > 0 ? setPending([]) : setSelectedId(null))
    }
    useEffect(() => {
        if (!active) {
            return
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.target instanceof HTMLInputElement) {
                return
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                event.preventDefault()
                actionsRef.current.undo()
            } else if (event.key === "Enter") {
                actionsRef.current.finishPolyline(false)
            } else if (event.key === "Escape") {
                actionsRef.current.cancelPending()
            } else if (event.key === "Delete" || event.key === "Backspace") {
                actionsRef.current.deleteSelected()
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [active])

    // Track the canvas area's pixel size so the sheet fills it. Fires on window
    // resize, sidebar/panel changes, and when the mode un-hides (0 → real size).
    useEffect(() => {
        const el = wrapRef.current
        if (!el) {
            return
        }
        const observer = new ResizeObserver(() => {
            const { clientWidth, clientHeight } = el
            if (clientWidth > 0 && clientHeight > 0) {
                setSize({ w: clientWidth, h: clientHeight })
            }
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const buildDrawing = (): Drawing => ({
        width: sheetW,
        height: sheetH,
        gridMm,
        shapes: placed.map((item) => item.shape)
    })

    const download = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        anchor.click()
        URL.revokeObjectURL(url)
    }

    const exportSvg = () => {
        download(new Blob([drawingToSvg(buildDrawing())], { type: "image/svg+xml" }), `drawing-${view}.svg`)
    }

    const exportPng = () => {
        const svg = drawingToSvg(buildDrawing(), { background: true })
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }))
        const img = new Image()
        img.onload = () => {
            const pxPerMm = PX_PER_MM
            const canvas = document.createElement("canvas")
            canvas.width = sheetW * pxPerMm
            canvas.height = sheetH * pxPerMm
            const ctx = canvas.getContext("2d")
            if (ctx) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                canvas.toBlob((blob) => blob && download(blob, `drawing-${view}.png`), "image/png")
            }
            URL.revokeObjectURL(url)
        }
        img.src = url
    }

    // Live preview of the shape being drawn, derived from pending clicks + cursor.
    const previewShape = ((): Shape | null => {
        if (!cursor || tool === "select") {
            return null
        }
        if (tool === "polyline") {
            return pending.length >= 1 ? { kind: "polyline", points: [...pending, cursor], closed: false } : null
        }
        if (pending.length === 0) {
            return null
        }
        if (tool === "arc" && pending.length === 2) {
            return buildShape("arc", [pending[0], pending[1], cursor])
        }
        if (tool === "arc") {
            // Only the center is placed: preview the radius as a guide line.
            return { kind: "line", a: pending[0], b: cursor }
        }
        return buildShape(tool, [pending[0], cursor])
    })()

    // Grid lines are recomputed only when the pitch changes, not on every cursor move.
    const gridEls = useMemo(() => {
        const minorX: number[] = []
        const majorX: number[] = []
        for (let x = 0; x <= sheetW + 1e-6; x += gridMm) {
            ;(Math.round(x / gridMm) % 5 === 0 ? majorX : minorX).push(x)
        }
        const minorY: number[] = []
        const majorY: number[] = []
        for (let y = 0; y <= sheetH + 1e-6; y += gridMm) {
            ;(Math.round(y / gridMm) % 5 === 0 ? majorY : minorY).push(y)
        }
        return (
            <>
                <g className="text-on-surface/10" stroke="currentColor" vectorEffect="non-scaling-stroke">
                    {minorX.map((x) => (
                        <line key={`vx${x}`} x1={x} y1={0} x2={x} y2={sheetH} strokeWidth={0.5} />
                    ))}
                    {minorY.map((y) => (
                        <line key={`hy${y}`} x1={0} y1={y} x2={sheetW} y2={y} strokeWidth={0.5} />
                    ))}
                </g>
                <g className="text-on-surface/20" stroke="currentColor" vectorEffect="non-scaling-stroke">
                    {majorX.map((x) => (
                        <line key={`Vx${x}`} x1={x} y1={0} x2={x} y2={sheetH} strokeWidth={0.75} />
                    ))}
                    {majorY.map((y) => (
                        <line key={`Hy${y}`} x1={0} y1={y} x2={sheetW} y2={y} strokeWidth={0.75} />
                    ))}
                </g>
            </>
        )
    }, [gridMm, sheetW, sheetH])

    const viewLabel = VIEWS.find((v) => v.id === view)?.label ?? "Front"

    return (
        <>
            <section className={cn("min-h-0 flex-col bg-surface-container-low", active ? "flex flex-1" : "hidden")}>
                <div ref={wrapRef} className="relative min-h-0 flex-1 bg-surface-container-lowest">
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${sheetW} ${sheetH}`}
                        preserveAspectRatio="xMidYMid meet"
                        className="size-full touch-none select-none"
                        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={endDrag}
                        onPointerLeave={() => {
                            setCursor(null)
                            endDrag()
                        }}
                        onDoubleClick={() => tool === "polyline" && finishPolyline(false)}
                    >
                        <title>{`Technical drawing sheet — ${viewLabel} view`}</title>
                        {gridEls}

                        {/* Committed shapes + dimension labels */}
                        {placed.map(({ id, shape }) => {
                            const at = labelAnchor(shape)
                            const isSel = id === selectedId
                            return (
                                <g key={id} className={isSel ? "text-primary" : "text-on-surface"}>
                                    <ShapeGeometry shape={shape} width={isSel ? 2 : 1.5} />
                                    <text
                                        x={at.x}
                                        y={at.y}
                                        textAnchor="middle"
                                        fill="currentColor"
                                        fontFamily="monospace"
                                        fontSize={4}
                                        className="text-tertiary"
                                    >
                                        {shapeDimensions(shape)}
                                    </text>
                                </g>
                            )
                        })}

                        {/* In-progress preview */}
                        {previewShape ? (
                            <g className="text-primary" strokeDasharray="3 2">
                                <ShapeGeometry shape={previewShape} width={1.5} />
                            </g>
                        ) : null}
                        {pending.map((p) => (
                            <circle
                                key={`${p.x},${p.y}`}
                                cx={p.x}
                                cy={p.y}
                                r={1.2}
                                className="fill-primary"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        {/* Cursor crosshair */}
                        {cursor && tool !== "select" ? (
                            <g className="text-primary" stroke="currentColor" vectorEffect="non-scaling-stroke">
                                <line
                                    x1={cursor.x - 3}
                                    y1={cursor.y}
                                    x2={cursor.x + 3}
                                    y2={cursor.y}
                                    strokeWidth={0.75}
                                />
                                <line
                                    x1={cursor.x}
                                    y1={cursor.y - 3}
                                    x2={cursor.x}
                                    y2={cursor.y + 3}
                                    strokeWidth={0.75}
                                />
                            </g>
                        ) : null}
                    </svg>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-on-surface/10 bg-surface px-4 py-2 font-mono text-tiny text-tertiary">
                    <span>
                        {viewLabel.toUpperCase()} · {placed.length} shape{placed.length === 1 ? "" : "s"}
                        {previewShape ? `  ·  ${shapeDimensions(previewShape)} mm` : ""}
                    </span>
                    <span>{cursor ? `X ${formatMm(cursor.x)}  Y ${formatMm(cursor.y)} mm` : "—"}</span>
                </div>
            </section>

            <aside
                className={cn(
                    "h-full shrink-0 overflow-hidden border-on-surface/10 transition-all duration-300 ease-snappy",
                    active ? "w-panel border-l" : "w-0"
                )}
            >
                <div
                    className={cn(
                        "flex h-full w-panel flex-col bg-surface transition duration-300 ease-snappy",
                        active ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
                    )}
                >
                    <div className="flex items-center justify-between border-b border-on-surface/10 bg-surface-container-low p-4">
                        <div className="flex items-center gap-2">
                            <DraftingCompass className="size-5 text-primary" />
                            <h3 className="font-mono text-title-md text-on-surface">DRAWING</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-tertiary hover:text-on-surface">
                            <X className="size-5" />
                        </button>
                    </div>

                    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
                        <div className="flex flex-col gap-2">
                            <SectionLabel>Perspective</SectionLabel>
                            <div className="grid grid-cols-3 gap-2">
                                {VIEWS.map((v) => (
                                    <button
                                        key={v.id}
                                        type="button"
                                        aria-pressed={view === v.id}
                                        onClick={() => chooseView(v.id)}
                                        className={cn(
                                            "border py-2 font-mono text-label-caps uppercase tracking-widest transition-colors",
                                            view === v.id
                                                ? "border-primary bg-primary/10 text-primary"
                                                : "border-on-surface/20 text-on-surface-variant hover:border-primary hover:text-primary"
                                        )}
                                    >
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <SectionLabel>Tools</SectionLabel>
                            <div className="flex flex-wrap gap-1">
                                {TOOLS.map((t) => (
                                    <IconButton
                                        key={t.id}
                                        icon={t.icon}
                                        label={t.label}
                                        active={tool === t.id}
                                        onClick={() => chooseTool(t.id)}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <SectionLabel>Constraints</SectionLabel>
                            <div className="flex items-center gap-2">
                                <IconButton
                                    icon={Grid2x2}
                                    label="Snap to grid"
                                    active={snapGrid}
                                    onClick={() => setSnapGrid((on) => !on)}
                                />
                                <IconButton
                                    icon={Magnet}
                                    label="Snap angle (45°)"
                                    active={snapAngleOn}
                                    onClick={() => setSnapAngleOn((on) => !on)}
                                />
                                <label className="ml-auto flex items-center gap-1 font-mono text-tiny text-tertiary">
                                    GRID
                                    <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={gridMm}
                                        onChange={(e) => {
                                            const v = Number.parseFloat(e.target.value)
                                            if (!Number.isNaN(v) && v >= 1) {
                                                setGridMm(v)
                                            }
                                        }}
                                        className="w-12 border-0 border-b-2 border-on-surface bg-surface-container-low px-1 py-1 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
                                    />
                                    mm
                                </label>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <SectionLabel>Edit</SectionLabel>
                            <div className="flex items-center gap-2">
                                <IconButton icon={Undo2} label="Undo" disabled={history.length === 0} onClick={undo} />
                                <IconButton
                                    icon={Trash2}
                                    label="Clear view"
                                    disabled={placed.length === 0}
                                    onClick={clearAll}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 border-t border-on-surface/10 p-4">
                        <button
                            type="button"
                            onClick={exportSvg}
                            disabled={placed.length === 0}
                            className="flex flex-1 items-center justify-center gap-1 border border-on-surface/20 py-2 font-mono text-tiny text-on-surface transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                        >
                            <Download className="size-3.5" /> SVG
                        </button>
                        <button
                            type="button"
                            onClick={exportPng}
                            disabled={placed.length === 0}
                            className="flex flex-1 items-center justify-center gap-1 border border-on-surface/20 py-2 font-mono text-tiny text-on-surface transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                        >
                            <Download className="size-3.5" /> PNG
                        </button>
                    </div>
                </div>
            </aside>
        </>
    )
}
