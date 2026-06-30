/**
 * Deterministic, visually-distinct colours for shape groups. Pure and React-free
 * (an interop boundary value: an `[r, g, b]` triple of 0–1 floats, the form
 * three.js `Color.setRGB` and the `ShapeGroup.color` field both expect).
 *
 * Hues are spread by golden-ratio rotation: stepping the hue by the golden-angle
 * fraction (≈0.618 of the circle) each index gives a low-discrepancy sequence, so
 * successive groups land far apart on the wheel and the first ~20 read as clearly
 * distinct without a hand-picked palette. Same `i` always yields the same triple.
 */

/** Conjugate of the golden ratio — the fractional hue step that maximises spacing. */
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895

/** Fixed saturation/lightness so only the hue varies; tuned for a dark UI. */
const SATURATION = 0.65
const LIGHTNESS = 0.55

/**
 * Convert an HSL colour (all channels in `[0, 1]`) to an `[r, g, b]` triple of
 * 0–1 floats. Standard piecewise formula; no allocation beyond the result.
 */
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    if (s === 0) {
        return [l, l, l] // achromatic
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return [hueToChannel(p, q, h + 1 / 3), hueToChannel(p, q, h), hueToChannel(p, q, h - 1 / 3)]
}

/** One RGB channel from the HSL `p`/`q` intermediates and a (possibly wrapped) hue. */
const hueToChannel = (p: number, q: number, t: number): number => {
    let hue = t
    if (hue < 0) hue += 1
    if (hue > 1) hue -= 1
    if (hue < 1 / 6) return p + (q - p) * 6 * hue
    if (hue < 1 / 2) return q
    if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6
    return p
}

/**
 * The colour for the group at index `i`: deterministic (same `i` ⇒ same triple),
 * visually distinct across the first ~20 indices, every channel in `[0, 1]`.
 */
export const colorForIndex = (i: number): [number, number, number] => {
    const hue = (i * GOLDEN_RATIO_CONJUGATE) % 1
    return hslToRgb(hue, SATURATION, LIGHTNESS)
}

/**
 * Highlight colour for a selected group — the `--color-drawing-selected` token
 * (`#2f7fff`) as a 0–1 triple, so selection reads as the same saturated blue the
 * drawing surface uses. `0x2f/255, 0x7f/255, 0xff/255`.
 */
export const SELECTED_COLOR: [number, number, number] = [0x2f / 255, 0x7f / 255, 0xff / 255]
