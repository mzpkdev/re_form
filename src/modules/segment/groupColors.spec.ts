import { describe, expect, it } from "bun:test"
import { colorForIndex, SELECTED_COLOR } from "./groupColors"

const context = describe

describe("groupColors", () => {
    context("colorForIndex", () => {
        it("is stable — the same index always yields the same triple", () => {
            for (const i of [0, 1, 5, 19, 100]) {
                expect(colorForIndex(i)).toEqual(colorForIndex(i))
            }
        })

        it("keeps every channel in [0, 1]", () => {
            for (let i = 0; i < 20; i++) {
                const [r, g, b] = colorForIndex(i)
                for (const channel of [r, g, b]) {
                    expect(channel).toBeGreaterThanOrEqual(0)
                    expect(channel).toBeLessThanOrEqual(1)
                }
            }
        })

        it("is distinct across the first 20 indices", () => {
            const seen = new Set<string>()
            for (let i = 0; i < 20; i++) {
                // Quantise to avoid float-equality false negatives; distinct hues
                // still land in different buckets.
                const key = colorForIndex(i)
                    .map((c) => Math.round(c * 255))
                    .join(",")
                expect(seen.has(key)).toBe(false)
                seen.add(key)
            }
            expect(seen.size).toBe(20)
        })
    })

    context("SELECTED_COLOR", () => {
        it("is #2f7fff as a 0–1 triple (the --color-drawing-selected token)", () => {
            const [r, g, b] = SELECTED_COLOR
            expect(r).toBeCloseTo(0.184, 3)
            expect(g).toBeCloseTo(0.498, 3)
            expect(b).toBe(1)
        })
    })
})
