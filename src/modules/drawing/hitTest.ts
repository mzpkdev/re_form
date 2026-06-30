import { flattenEntity } from "./project"
import type { Entity, Plane, Vec2 } from "./types"

/**
 * Pure pointer-vs-entity hit testing for the drawing editor. React-free and
 * store-free: the canvas converts a click to a world-2D point and a world-unit
 * tolerance, then asks which entity (if any) it landed on.
 *
 * Each entity is flattened to its on-plane polyline (`flattenEntity`) and the
 * click's distance to the nearest segment is measured. Cross-plane geometry
 * collapses to an edge-on line under projection, so it is hit-tested exactly as
 * it renders — what you see is what you can click.
 */

/**
 * Shortest distance from point `p` to the segment `a`–`b`. A degenerate segment
 * (a === b) reduces to the point-to-point distance, so coincident polyline
 * vertices never divide by zero.
 */
const distanceToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const apx = p[0] - a[0]
    const apy = p[1] - a[1]
    const lenSq = abx * abx + aby * aby
    // Project ap onto ab, clamped to the segment; t=0 at a, t=1 at b.
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq))
    const cx = a[0] + t * abx
    const cy = a[1] + t * aby
    return Math.hypot(p[0] - cx, p[1] - cy)
}

/**
 * Min distance from `point` to a flattened entity: the smallest point-to-segment
 * distance over its consecutive vertex pairs, plus the closing segment
 * (last→first) when the shape is closed. A lone point (< 2 vertices) has no
 * segment, so it returns Infinity (never a candidate).
 */
const distanceToEntity = (point: Vec2, entity: Entity, plane: Plane): number => {
    const { points, closed } = flattenEntity(entity, plane)
    if (points.length < 2) return Number.POSITIVE_INFINITY
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length - 1; i++) {
        min = Math.min(min, distanceToSegment(point, points[i], points[i + 1]))
    }
    if (closed) {
        min = Math.min(min, distanceToSegment(point, points[points.length - 1], points[0]))
    }
    return min
}

/**
 * The id of the entity nearest `point` on `plane` within `tolerance` (world
 * units), or `null` when none is within reach. Distance is measured to the
 * entity's flattened outline (closing edge included for closed shapes).
 *
 * Ties break toward the LAST entity in `entities` — document order is paint
 * order, so the most recently drawn (topmost) entity wins an overlap, matching
 * what the eye picks. The strict `<` keeps an earlier entity only when it is
 * genuinely closer.
 */
export const hitTest = (entities: Entity[], point: Vec2, plane: Plane, tolerance: number): string | null => {
    let best: string | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const entity of entities) {
        const d = distanceToEntity(point, entity, plane)
        if (d <= tolerance && d <= bestDist) {
            best = entity.id
            bestDist = d
        }
    }
    return best
}

/** An axis-aligned marquee rectangle in plane view-space (world-2D). */
export interface Box {
    minX: number
    minY: number
    maxX: number
    maxY: number
}

/** Whether point `p` lies within (or on the border of) `box`. */
const pointInBox = (p: Vec2, box: Box): boolean =>
    p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY

/** Orientation of the ordered triple (a,b,c): >0 ccw, <0 cw, 0 collinear. */
const orient = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** Whether `p` (known collinear with a–b) lies within the a–b bounding box. */
const onSpan = (a: Vec2, b: Vec2, p: Vec2): boolean =>
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])

/** Whether segments p1–p2 and p3–p4 intersect (crossing or merely touching). */
const segmentsIntersect = (p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean => {
    const d1 = orient(p3, p4, p1)
    const d2 = orient(p3, p4, p2)
    const d3 = orient(p1, p2, p3)
    const d4 = orient(p1, p2, p4)
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
    // Collinear / touching: an endpoint of one segment sits on the other.
    if (d1 === 0 && onSpan(p3, p4, p1)) return true
    if (d2 === 0 && onSpan(p3, p4, p2)) return true
    if (d3 === 0 && onSpan(p1, p2, p3)) return true
    if (d4 === 0 && onSpan(p1, p2, p4)) return true
    return false
}

/** Whether segment a–b touches or enters `box` (an endpoint inside, or a crossing). */
const segmentIntersectsBox = (a: Vec2, b: Vec2, box: Box): boolean => {
    if (pointInBox(a, box) || pointInBox(b, box)) return true
    const tl: Vec2 = [box.minX, box.maxY]
    const tr: Vec2 = [box.maxX, box.maxY]
    const br: Vec2 = [box.maxX, box.minY]
    const bl: Vec2 = [box.minX, box.minY]
    return (
        segmentsIntersect(a, b, tl, tr) ||
        segmentsIntersect(a, b, tr, br) ||
        segmentsIntersect(a, b, br, bl) ||
        segmentsIntersect(a, b, bl, tl)
    )
}

/** Whether the entity's flattened outline on `plane` touches or enters `box`. */
const entityIntersectsBox = (entity: Entity, plane: Plane, box: Box): boolean => {
    const { points, closed } = flattenEntity(entity, plane)
    if (points.length === 0) return false
    if (points.length === 1) return pointInBox(points[0], box)
    for (let i = 0; i < points.length - 1; i++) {
        if (segmentIntersectsBox(points[i], points[i + 1], box)) return true
    }
    if (closed && points.length > 2 && segmentIntersectsBox(points[points.length - 1], points[0], box)) {
        return true
    }
    return false
}

/**
 * Every entity whose flattened outline on `plane` touches or enters `box` — the
 * marquee (box-select) query. CROSSING semantics: an entity is in when any of its
 * segments has an endpoint inside the box or crosses a box edge, so dragging a box
 * over PART of a line still picks it. Ids come back in document (paint) order.
 */
export const entitiesInBox = (entities: Entity[], plane: Plane, box: Box): string[] => {
    const ids: string[] = []
    for (const entity of entities) {
        if (entityIntersectsBox(entity, plane, box)) ids.push(entity.id)
    }
    return ids
}
