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
