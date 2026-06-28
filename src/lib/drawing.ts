/**
 * Technical-drawing domain logic — React-free, all measurements in MILLIMETRES.
 *
 * The sheet uses screen coordinates: origin top-left, +x right, +y DOWN (so it
 * lines up 1:1 with the SVG the panel renders). Shapes are stored as the rigid
 * primitives a draughting tool produces — straight segments, axis-aligned
 * rectangles, circles, arcs and polylines — never freehand paths.
 *
 * This module is the seam for the deferred "sketch → extrude" step
 * (FUTURE_PLAN.md): {@link profileToPolygons} already converts the closed shapes
 * into the exact polygon-loop form manifold's `CrossSection` constructor wants,
 * so wiring extrusion later is a few lines (see that function's doc) with no
 * rewrite of the editor.
 */

/** A point on the drawing sheet, in millimetres. */
export type Point = { x: number; y: number }

/** A straight segment between two points. */
export type Line = { kind: "line"; a: Point; b: Point }
/** An axis-aligned rectangle given by two opposite corners. */
export type Rect = { kind: "rect"; a: Point; b: Point }
/** A full circle. */
export type Circle = { kind: "circle"; center: Point; radius: number }
/** A circular arc swept from `startDeg` to `endDeg` in increasing-angle order. */
export type Arc = { kind: "arc"; center: Point; radius: number; startDeg: number; endDeg: number }
/** A run of connected segments; `closed` joins the last point back to the first. */
export type Polyline = { kind: "polyline"; points: Point[]; closed: boolean }

export type Shape = Line | Rect | Circle | Arc | Polyline

/** A full drawing: the sheet size + grid pitch (mm) and the ordered shapes on it. */
export type Drawing = {
    /** Sheet width in millimetres (e.g. A4 portrait = 210). */
    width: number
    /** Sheet height in millimetres (e.g. A4 portrait = 297). */
    height: number
    /** Grid spacing in millimetres. */
    gridMm: number
    shapes: Shape[]
}

/** Round shapes are tessellated at this many segments — matches `SEGMENTS` in primitives.ts. */
export const CIRCLE_SEGMENTS = 48

/** Euclidean distance between two points, in millimetres. */
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

/** A point on a circle: `center` + `radius` at `deg` (degrees, sheet/y-down convention). */
export const polar = (center: Point, radius: number, deg: number): Point => {
    const r = (deg * Math.PI) / 180
    return { x: center.x + radius * Math.cos(r), y: center.y + radius * Math.sin(r) }
}

/**
 * Snap a point to the nearest grid intersection. A non-positive pitch is a
 * no-op, so callers can pass the live grid size without guarding.
 */
export const snapToGrid = (p: Point, gridMm: number): Point => {
    if (!(gridMm > 0)) {
        return p
    }
    return { x: Math.round(p.x / gridMm) * gridMm, y: Math.round(p.y / gridMm) * gridMm }
}

/**
 * Constrain the segment `from → to` to the nearest multiple of `stepDeg`,
 * preserving its length. With the default 45° step this gives ortho (0/90°) plus
 * the diagonals — the "no wobbly lines" behaviour of a draughting tool. A
 * zero-length input is returned unchanged.
 */
export const snapAngle = (from: Point, to: Point, stepDeg = 45): Point => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy)
    if (len === 0) {
        return to
    }
    const step = (stepDeg * Math.PI) / 180
    const snapped = Math.round(Math.atan2(dy, dx) / step) * step
    return { x: from.x + Math.cos(snapped) * len, y: from.y + Math.sin(snapped) * len }
}

export type SnapOptions = {
    gridMm: number
    snapGrid: boolean
    snapAngle: boolean
    /** Angle increment in degrees; defaults to 45. */
    angleStep?: number
    /** Reference point the angle snap measures from (the previous vertex). */
    from?: Point | null
}

/**
 * Resolve a raw pointer position to the constrained point the tools actually
 * commit. Angle snap is applied first (it needs the true direction from the
 * reference point), then grid snap lands the result on a clean coordinate — on a
 * square grid the two agree for 0/45/90°, so the order is stable.
 */
export const resolvePoint = (raw: Point, opts: SnapOptions): Point => {
    let p = raw
    if (opts.snapAngle && opts.from) {
        p = snapAngle(opts.from, p, opts.angleStep ?? 45)
    }
    if (opts.snapGrid) {
        p = snapToGrid(p, opts.gridMm)
    }
    return p
}

/** Format a millimetre value for a dimension label: ≤1 decimal, trailing `.0` trimmed. */
export const formatMm = (mm: number): string => {
    const r = Math.round(mm * 10) / 10
    return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** Normalise a rectangle's two corners to a top-left origin plus positive size (mm). */
export const rectBounds = (rect: Rect): { x: number; y: number; w: number; h: number } => {
    const x = Math.min(rect.a.x, rect.b.x)
    const y = Math.min(rect.a.y, rect.b.y)
    return { x, y, w: Math.abs(rect.b.x - rect.a.x), h: Math.abs(rect.b.y - rect.a.y) }
}

/** Angular span of an arc in degrees, normalised to (0, 360]. */
export const arcSpanDeg = (arc: Arc): number => {
    const span = (arc.endDeg - arc.startDeg) % 360
    return span <= 0 ? span + 360 : span
}

/** The SVG path `d` for an arc, shared by the live render and the SVG export so they can't drift. */
export const arcPathD = (arc: Arc): string => {
    const start = polar(arc.center, arc.radius, arc.startDeg)
    const end = polar(arc.center, arc.radius, arc.endDeg)
    const largeArc = arcSpanDeg(arc) > 180 ? 1 : 0
    return `M ${start.x} ${start.y} A ${arc.radius} ${arc.radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

/**
 * The measured-size label for a shape (millimetres), e.g. `"40 × 25"` for a
 * rectangle or `"⌀ 30"` for a circle. Used for the on-sheet dimension text and
 * the live readout while drawing.
 */
export const shapeDimensions = (shape: Shape): string => {
    switch (shape.kind) {
        case "line":
            return formatMm(distance(shape.a, shape.b))
        case "rect": {
            const { w, h } = rectBounds(shape)
            return `${formatMm(w)} × ${formatMm(h)}`
        }
        case "circle":
            return `⌀ ${formatMm(shape.radius * 2)}`
        case "arc":
            return `R ${formatMm(shape.radius)}`
        case "polyline": {
            let total = 0
            for (let i = 1; i < shape.points.length; i++) {
                total += distance(shape.points[i - 1], shape.points[i])
            }
            if (shape.closed && shape.points.length > 1) {
                total += distance(shape.points[shape.points.length - 1], shape.points[0])
            }
            return formatMm(total)
        }
    }
}

/** Signed area of a polygon loop (mm²); positive when wound counter-clockwise in y-up space. */
const signedArea = (loop: Point[]): number => {
    let sum = 0
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]
        const b = loop[(i + 1) % loop.length]
        sum += a.x * b.y - b.x * a.y
    }
    return sum / 2
}

/**
 * Convert the drawing's CLOSED shapes into polygon loops ready for manifold's
 * `CrossSection`. Output points are in millimetres, flipped to a y-UP coordinate
 * system (manifold's XY plane convention) and wound counter-clockwise so each
 * loop reads as solid. Round shapes are tessellated at {@link CIRCLE_SEGMENTS}.
 *
 * Only rectangles, circles and closed polylines describe a fillable area; open
 * lines, arcs and open polylines are skipped (they are not profiles).
 *
 * Phase 2 (deferred sketch→extrude) then reduces to roughly:
 * ```ts
 *   const polys = profileToPolygons(drawing).map((loop) => loop.map((p) => [p.x, p.y]))
 *   const solid = new wasm.CrossSection(polys, "Positive").extrude(heightMm)
 *   setManifold(solid)
 * ```
 */
export const profileToPolygons = (drawing: Drawing, segments = CIRCLE_SEGMENTS): Point[][] => {
    const flipY = (p: Point): Point => ({ x: p.x, y: drawing.height - p.y })
    const loops: Point[][] = []

    for (const shape of drawing.shapes) {
        if (shape.kind === "rect") {
            const { x, y, w, h } = rectBounds(shape)
            if (w > 0 && h > 0) {
                loops.push(
                    [
                        { x, y },
                        { x: x + w, y },
                        { x: x + w, y: y + h },
                        { x, y: y + h }
                    ].map(flipY)
                )
            }
        } else if (shape.kind === "circle") {
            if (shape.radius > 0) {
                const loop: Point[] = []
                for (let i = 0; i < segments; i++) {
                    loop.push(flipY(polar(shape.center, shape.radius, (i / segments) * 360)))
                }
                loops.push(loop)
            }
        } else if (shape.kind === "polyline" && shape.closed && shape.points.length >= 3) {
            loops.push(shape.points.map(flipY))
        }
    }

    // Normalise winding so every loop is CCW (solid) for the extrude step.
    return loops.map((loop) => (signedArea(loop) < 0 ? [...loop].reverse() : loop))
}

/** Trim float noise from a coordinate so the exported SVG stays readable. */
const n = (v: number): string => String(Math.round(v * 1000) / 1000)

export type SvgOptions = {
    /** Draw the millimetre grid behind the shapes (default false). */
    grid?: boolean
    /** Render dimension labels next to each shape (default true). */
    dimensions?: boolean
    /** Paint a white sheet background (default true). */
    background?: boolean
}

const DIM = { ink: "#1a1b1f", grid: "#e3e2e7", label: "#5d5e60" }

/** One shape as an SVG element string (no styling — the caller sets stroke/fill). */
const shapeToSvg = (shape: Shape): string => {
    switch (shape.kind) {
        case "line":
            return `<line x1="${n(shape.a.x)}" y1="${n(shape.a.y)}" x2="${n(shape.b.x)}" y2="${n(shape.b.y)}" />`
        case "rect": {
            const { x, y, w, h } = rectBounds(shape)
            return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" />`
        }
        case "circle":
            return `<circle cx="${n(shape.center.x)}" cy="${n(shape.center.y)}" r="${n(shape.radius)}" fill="none" />`
        case "arc":
            return `<path d="${arcPathD(shape)}" fill="none" />`
        case "polyline": {
            const pts = shape.points.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")
            return shape.closed ? `<polygon points="${pts}" fill="none" />` : `<polyline points="${pts}" fill="none" />`
        }
    }
}

/** A point to anchor a shape's dimension label, in millimetres. */
const labelAnchor = (shape: Shape): Point => {
    switch (shape.kind) {
        case "line":
            return { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 }
        case "rect": {
            const { x, y, w } = rectBounds(shape)
            return { x: x + w / 2, y: y - 2 }
        }
        case "circle":
        case "arc":
            return shape.center
        case "polyline":
            return shape.points[0] ?? { x: 0, y: 0 }
    }
}

/**
 * Serialise a drawing to a standalone SVG string (millimetre units), suitable
 * for download. Pure — no DOM — so it is unit-testable and drives the export
 * button directly.
 */
export const drawingToSvg = (drawing: Drawing, opts: SvgOptions = {}): string => {
    const { width, height, gridMm } = drawing
    const showGrid = opts.grid ?? false
    const showDims = opts.dimensions ?? true
    const showBg = opts.background ?? true

    const parts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`
    ]
    if (showBg) {
        parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`)
    }
    if (showGrid && gridMm > 0) {
        const lines: string[] = []
        for (let x = 0; x <= width + 1e-6; x += gridMm) {
            lines.push(`<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(height)}" />`)
        }
        for (let y = 0; y <= height + 1e-6; y += gridMm) {
            lines.push(`<line x1="0" y1="${n(y)}" x2="${n(width)}" y2="${n(y)}" />`)
        }
        parts.push(`<g stroke="${DIM.grid}" stroke-width="0.1">${lines.join("")}</g>`)
    }

    const body = drawing.shapes.map(shapeToSvg).join("")
    parts.push(`<g stroke="${DIM.ink}" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round">${body}</g>`)

    if (showDims && drawing.shapes.length > 0) {
        const labels = drawing.shapes
            .map((shape) => {
                const at = labelAnchor(shape)
                return `<text x="${n(at.x)}" y="${n(at.y)}" font-family="monospace" font-size="4" fill="${DIM.label}" text-anchor="middle">${shapeDimensions(shape)}</text>`
            })
            .join("")
        parts.push(`<g>${labels}</g>`)
    }

    parts.push("</svg>")
    return parts.join("")
}
