import type { Vec2 } from "./types"

/**
 * Pure snapping helpers for the technical-drawing canvas. A technical drawing has
 * NO freeform coordinates: every placed point lands on a grid intersection, and
 * every segment runs along one of eight 0/45/90°-multiple directions from its
 * anchor. These two functions are that contract, and they are React-free and
 * store-free so the snap math can be proven in isolation.
 */

/**
 * Round each coordinate to the nearest multiple of `grid`, returning the closest
 * grid intersection to `p`. e.g. `snapToGrid([12, 7], 10) === [10, 10]` and
 * `snapToGrid([16, 4], 10) === [20, 0]`. `grid` is assumed positive.
 *
 * `Math.round(-0)` is `-0`; we normalise it to `0` so snapped coordinates compare
 * and serialize cleanly (and `[−0, …]` never leaks into the document).
 */
export const snapToGrid = (p: Vec2, grid: number): Vec2 => [
    normalizeZero(Math.round(p[0] / grid) * grid),
    normalizeZero(Math.round(p[1] / grid) * grid)
]

/**
 * The eight 0/45/90° directions as integer axis multipliers, indexed by
 * `k = round(atan2(dy, dx) / (π/4)) mod 8`. Axis directions have a single nonzero
 * component (step length `grid`); diagonals have both (step length `grid·√2`, so
 * `|dx| === |dy|`). Using exact integers — rather than `cos`/`sin` of the angle —
 * keeps the projected output exactly grid-divisible with no float drift.
 */
const DIRECTIONS: readonly Vec2[] = [
    [1, 0], // 0   E
    [1, 1], // 45  NE
    [0, 1], // 90  N
    [-1, 1], // 135 NW
    [-1, 0], // 180 W
    [-1, -1], // 225 SW
    [0, -1], // 270 S
    [1, -1] // 315 SE
]

/**
 * Snap `p` to the grid intersection that lies on a 0/45/90°-multiple ray from
 * `anchor` and is nearest to `p`. `anchor` is assumed already on-grid.
 *
 * Algorithm (per the spec): snap `p` to grid; take `delta = snapped − anchor`;
 * pick the nearest of the eight directions; project the delta's length onto that
 * direction in whole grid steps. The step displacement for direction `(mx, my)`
 * is `(mx·grid, my·grid)`, whose length is `grid·hypot(mx, my)` (`grid` on an
 * axis, `grid·√2` on a diagonal). Projecting and rounding to whole steps yields a
 * point that is grid-divisible AND axis-aligned-or-equal-legged by construction.
 * A zero delta (cursor on the anchor) returns `anchor`.
 */
export const constrainToAngle = (anchor: Vec2, p: Vec2, grid: number): Vec2 => {
    const snapped = snapToGrid(p, grid)
    const dx = snapped[0] - anchor[0]
    const dy = snapped[1] - anchor[1]
    if (dx === 0 && dy === 0) return anchor

    const k = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8
    const [mx, my] = DIRECTIONS[k]

    // Number of whole grid steps along the chosen direction nearest to delta.
    // The per-step displacement is s = (mx·grid, my·grid); the least-squares step
    // count is (delta·s)/(s·s) = (dx·mx + dy·my)/(grid·legSq), where
    // legSq = |(mx,my)|² (1 on an axis, 2 on a diagonal).
    const legSq = mx * mx + my * my
    const steps = Math.round((dx * mx + dy * my) / (grid * legSq))

    return [normalizeZero(anchor[0] + steps * grid * mx), normalizeZero(anchor[1] + steps * grid * my)]
}

/** Collapse a negative zero to positive zero so coordinates compare/serialize cleanly. */
const normalizeZero = (n: number): number => (n === 0 ? 0 : n)
