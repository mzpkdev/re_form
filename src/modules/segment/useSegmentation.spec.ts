import { describe, expect, it } from "bun:test"
import { cube } from "./fixtures"
import { colorForIndex } from "./groupColors"
import type { SegmentationParams, ShapeGroup } from "./types"
import { applyColors, buildSegmentInput, defaultParams } from "./useSegmentation"

const context = describe

// A minimal valid ShapeGroup carrying a sentinel colour we expect applyColors to
// overwrite. Only fields the function reads/copies matter (§5).
const makeGroup = (id: string): ShapeGroup => ({
    id,
    kind: "unknown",
    label: id,
    color: [0.5, 0.5, 0.5],
    triangleIndices: Int32Array.from([0]),
    params: { kind: "unknown" },
    bbox: { min: [0, 0, 0], max: [1, 1, 1] }
})

const params: SegmentationParams = defaultParams

describe("useSegmentation pure pieces", () => {
    context("buildSegmentInput", () => {
        it("packs the geometry, params, and tiers into the SegmentInput", () => {
            const geometry = cube()
            const tiers = { bodies: true, regions: false, primitives: false }

            const input = buildSegmentInput(geometry, params, tiers)

            expect(input.geometry).toBe(geometry)
            expect(input.params).toBe(params)
            expect(input.tiers).toEqual(tiers)
        })

        it("carries whatever tier flags it is handed (M2/M3 widen these)", () => {
            const input = buildSegmentInput(cube(), params, { bodies: true, regions: true, primitives: true })

            expect(input.tiers).toEqual({ bodies: true, regions: true, primitives: true })
        })

        it("leaves wasm unset — the hook attaches the manifold singleton", () => {
            const input = buildSegmentInput(cube(), params, { bodies: true, regions: false, primitives: false })

            expect(input.wasm).toBeUndefined()
        })

        it("rejects a null geometry with a clear error", () => {
            expect(() => buildSegmentInput(null, params, { bodies: true, regions: false, primitives: false })).toThrow(
                /null geometry/
            )
        })
    })

    context("applyColors", () => {
        it("assigns colorForIndex(i) to each group by position", () => {
            const colored = applyColors([makeGroup("a"), makeGroup("b"), makeGroup("c")])

            expect(colored[0].color).toEqual(colorForIndex(0))
            expect(colored[1].color).toEqual(colorForIndex(1))
            expect(colored[2].color).toEqual(colorForIndex(2))
        })

        it("preserves count and order", () => {
            const colored = applyColors([makeGroup("a"), makeGroup("b"), makeGroup("c")])

            expect(colored.map((g) => g.id)).toEqual(["a", "b", "c"])
        })

        it("returns fresh group objects, leaving the inputs untouched", () => {
            const input = makeGroup("a")

            const [colored] = applyColors([input])

            expect(colored).not.toBe(input)
            expect(input.color).toEqual([0.5, 0.5, 0.5]) // original unmutated
        })

        it("is a no-op on an empty list", () => {
            expect(applyColors([])).toEqual([])
        })
    })

    context("defaultParams", () => {
        it("matches the §7 defaults", () => {
            expect(defaultParams.epsilon).toBe(0.004)
            expect(defaultParams.cosNormal).toBeCloseTo(0.94, 2)
            expect(defaultParams.minPoints).toBe(50)
            expect(defaultParams.probability).toBe(0.02)
            expect(defaultParams.seed).toBe(1)
            expect(defaultParams.enabled).toEqual({ plane: true, cylinder: true, sphere: true, cone: true })
        })
    })
})
