import { describe, expect, it } from "bun:test"
import {
    angleDegToCos,
    cosToAngleDeg,
    degToRad,
    paramsToControls,
    radToDeg,
    setControl,
    setEnabled
} from "./paramControls"
import type { SegmentationParams } from "./types"
import { defaultParams } from "./useSegmentation"

const context = describe

describe("paramControls", () => {
    context("degToRad / radToDeg", () => {
        it("round-trips an angle", () => {
            expect(radToDeg(degToRad(37))).toBeCloseTo(37, 10)
        })

        it("maps the known anchors", () => {
            expect(degToRad(180)).toBeCloseTo(Math.PI, 10)
            expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 10)
        })
    })

    context("angleDegToCos / cosToAngleDeg", () => {
        it("stores the §7 default (20°) as cos 20° ≈ 0.94", () => {
            expect(angleDegToCos(20)).toBeCloseTo(0.9397, 4)
        })

        it("is monotonic-DECREASING: a wider angle is a looser (smaller) cosine", () => {
            expect(angleDegToCos(45)).toBeLessThan(angleDegToCos(5))
        })

        it("round-trips angle → cos → angle", () => {
            expect(cosToAngleDeg(angleDegToCos(30))).toBeCloseTo(30, 6)
        })

        it("clamps the angle to [0, 90] before taking the cosine (never flips sign)", () => {
            expect(angleDegToCos(120)).toBe(Math.cos(degToRad(90)))
            expect(angleDegToCos(-10)).toBe(1)
        })

        it("clamps cos to [-1, 1] so acos never NaNs", () => {
            expect(cosToAngleDeg(1.5)).toBeCloseTo(0, 10)
            expect(Number.isNaN(cosToAngleDeg(2))).toBe(false)
        })
    })

    context("paramsToControls", () => {
        it("projects stored params onto human units (degrees / fractions)", () => {
            const c = paramsToControls(defaultParams)
            expect(c.epsilon).toBe(defaultParams.epsilon)
            expect(c.minPoints).toBe(defaultParams.minPoints)
            expect(c.probability).toBe(defaultParams.probability)
            expect(c.angleDeg).toBeCloseTo(20, 6)
            expect(c.thetaCreaseDeg).toBeCloseTo(37, 6)
            expect(c.thetaGrowDeg).toBeCloseTo(18, 6)
        })
    })

    context("setControl", () => {
        it("sets epsilon as a raw fraction, returning fresh params", () => {
            const next = setControl(defaultParams, "epsilon", 0.01)
            expect(next.epsilon).toBe(0.01)
            expect(next).not.toBe(defaultParams)
            expect(defaultParams.epsilon).toBe(0.004) // input unmutated
        })

        it("converts the angle slider to a stored cosNormal", () => {
            const next = setControl(defaultParams, "angleDeg", 30)
            expect(next.cosNormal).toBeCloseTo(Math.cos(degToRad(30)), 10)
        })

        it("rounds minPoints to an integer", () => {
            expect(setControl(defaultParams, "minPoints", 73.6).minPoints).toBe(74)
        })

        it("converts crease/grow degrees to radians", () => {
            expect(setControl(defaultParams, "thetaCreaseDeg", 40).thetaCrease).toBeCloseTo(degToRad(40), 10)
            expect(setControl(defaultParams, "thetaGrowDeg", 12).thetaGrow).toBeCloseTo(degToRad(12), 10)
        })

        it("keeps thetaGrow < thetaCrease when grow is raised past crease (clamps grow to crease)", () => {
            // default crease 37°, push grow to 50° → grow clamps to 37°
            const next = setControl(defaultParams, "thetaGrowDeg", 50)
            expect(next.thetaGrow).toBeCloseTo(defaultParams.thetaCrease, 10)
        })

        it("drags thetaGrow down when crease is lowered below it", () => {
            // default grow 18°, crease lowered to 10° → grow follows down to 10°
            const next = setControl(defaultParams, "thetaCreaseDeg", 10)
            expect(next.thetaCrease).toBeCloseTo(degToRad(10), 10)
            expect(next.thetaGrow).toBeCloseTo(degToRad(10), 10)
        })

        it("leaves grow alone when crease is lowered but stays above grow", () => {
            const next = setControl(defaultParams, "thetaCreaseDeg", 30)
            expect(next.thetaGrow).toBe(defaultParams.thetaGrow) // 18° < 30°, untouched
        })
    })

    context("setEnabled", () => {
        it("toggles one primitive type without disturbing the others", () => {
            const next = setEnabled(defaultParams, "cylinder", false)
            expect(next.enabled).toEqual({ plane: true, cylinder: false, sphere: true, cone: true })
            expect(next).not.toBe(defaultParams)
            expect(defaultParams.enabled.cylinder).toBe(true) // input unmutated
        })
    })

    context("debounce serialization contract (documented for M3 acceptance)", () => {
        const params: SegmentationParams = defaultParams
        it("every setControl/setEnabled returns a NEW reference so a params-keyed effect re-fires", () => {
            expect(setControl(params, "epsilon", 0.005)).not.toBe(params)
            expect(setEnabled(params, "sphere", false)).not.toBe(params)
        })
    })
})
