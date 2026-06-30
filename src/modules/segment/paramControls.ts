import type { SegmentationParams } from "./types"

/**
 * Pure UI-boundary mappings for the segment tuning controls (M3.7). The stored
 * `SegmentationParams` (types.ts §5) speak the pipeline's units — angles in
 * RADIANS, the normal-deviation threshold as `cos(α)`, lengths as fractions of
 * the bbox diagonal `D` — but the sliders present human units (DEGREES, a raw
 * fraction). These helpers convert at that boundary and are unit-tested without
 * React so the deg↔rad / angle↔cos arithmetic is verified directly.
 */

const DEG_PER_RAD = 180 / Math.PI

/** Radians → degrees. */
export const radToDeg = (rad: number): number => rad * DEG_PER_RAD

/** Degrees → radians. */
export const degToRad = (deg: number): number => deg / DEG_PER_RAD

/**
 * The "Angle tolerance" slider shows an ANGLE in degrees but the model stores
 * `cosNormal = cos(α)`. The mapping is monotonic-DECREASING: a wider angle is a
 * LOOSER normal test, hence a SMALLER cosine. We clamp the angle to `[0, 90]`
 * before taking the cosine so a stray value can't flip the sign of the threshold.
 */
export const angleDegToCos = (deg: number): number => Math.cos(degToRad(Math.min(90, Math.max(0, deg))))

/** Inverse of {@link angleDegToCos}: recover the slider's angle (degrees) from a stored `cosNormal`. */
export const cosToAngleDeg = (cos: number): number => radToDeg(Math.acos(Math.min(1, Math.max(-1, cos))))

/**
 * The slider/number-input values driving the tuning section, all in HUMAN units
 * (degrees, raw fractions, integer counts). This is the shape the panel renders
 * controls against; {@link paramsToControls} / {@link controlsToParams} convert
 * to and from the stored {@link SegmentationParams}.
 */
export interface ControlValues {
    /** Detail / tolerance — fraction of `D` (the orchestrator scales by `D`). */
    epsilon: number
    /** Angle tolerance — DEGREES (stored as `cos`). */
    angleDeg: number
    /** Min feature size — smallest acceptable primitive (inlier floor). */
    minPoints: number
    /** RANSAC miss-probability (Advanced). */
    probability: number
    /** Sharp-edge / hard-boundary dihedral — DEGREES (stored as radians). */
    thetaCreaseDeg: number
    /** Region-grow smoothness — DEGREES (stored as radians); kept `< thetaCreaseDeg`. */
    thetaGrowDeg: number
}

/** Project stored params onto the human-unit control values the sliders bind to. */
export const paramsToControls = (params: SegmentationParams): ControlValues => ({
    epsilon: params.epsilon,
    angleDeg: cosToAngleDeg(params.cosNormal),
    minPoints: params.minPoints,
    probability: params.probability,
    thetaCreaseDeg: radToDeg(params.thetaCrease),
    thetaGrowDeg: radToDeg(params.thetaGrow)
})

/**
 * Fold one edited control value back into `params`, returning FRESH params (so a
 * debounced effect keyed on `params` sees a new reference). Converts the human
 * unit to the stored unit, and enforces the spec invariant `thetaGrow <
 * thetaCrease` from BOTH directions: lowering the crease angle drags grow down
 * with it; raising grow past crease is clamped to crease.
 */
export const setControl = <K extends keyof ControlValues>(
    params: SegmentationParams,
    key: K,
    value: number
): SegmentationParams => {
    switch (key) {
        case "epsilon":
            return { ...params, epsilon: value }
        case "angleDeg":
            return { ...params, cosNormal: angleDegToCos(value) }
        case "minPoints":
            return { ...params, minPoints: Math.round(value) }
        case "probability":
            return { ...params, probability: value }
        case "thetaCreaseDeg": {
            const thetaCrease = degToRad(value)
            // Grow can never exceed crease — drag it down if the new crease is below it.
            return { ...params, thetaCrease, thetaGrow: Math.min(params.thetaGrow, thetaCrease) }
        }
        case "thetaGrowDeg":
            // Clamp grow strictly under crease so the hysteresis window never inverts.
            return { ...params, thetaGrow: Math.min(degToRad(value), params.thetaCrease) }
        default:
            return params
    }
}

/** Toggle which primitive TYPE RANSAC tries, returning FRESH params. */
export const setEnabled = (
    params: SegmentationParams,
    kind: keyof SegmentationParams["enabled"],
    on: boolean
): SegmentationParams => ({
    ...params,
    enabled: { ...params.enabled, [kind]: on }
})
