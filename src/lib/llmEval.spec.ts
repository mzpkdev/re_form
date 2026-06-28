import { describe, expect, it } from "bun:test"
import { evaluatePrompt } from "./llmEval"
import { initManifold } from "./manifold"

const context = describe

/**
 * Live LLM evaluation — exercises the full stack (model → tool-loop → WASM →
 * printability) against a real provider. GATED on OPENROUTER_API_KEY: with no
 * key every case is SKIPPED, so `bun test` stays offline-green. Set the env var
 * to run it for real.
 */
const KEY = process.env.OPENROUTER_API_KEY

// Live network + model latency; give the loop room to finish.
const LIVE_TIMEOUT_MS = 60_000

describe("evaluatePrompt (live)", () => {
    context("a cylinder with a through-hole", () => {
        it.skipIf(!KEY)(
            "builds a watertight, printable part roughly 20×20×20 mm with a bore",
            async () => {
                const result = await evaluatePrompt({
                    apiKey: KEY as string,
                    prompt:
                        "Create a cylinder 20 mm tall and 10 mm radius, then drill a 6 mm diameter hole " +
                        "all the way through along Z."
                })

                expect(result.manifold).not.toBeNull()
                const part = result.manifold
                if (!part) {
                    return
                }

                // Watertight, sound solid.
                expect(part.status()).toBe("NoError")
                expect(part.isEmpty()).toBe(false)
                expect(part.volume()).toBeGreaterThan(0)

                // A 10 mm-radius, 20 mm-tall cylinder ⇒ a 20×20×20 mm bounding box.
                const box = part.boundingBox()
                expect(box.max[0] - box.min[0]).toBeCloseTo(20, 0)
                expect(box.max[1] - box.min[1]).toBeCloseTo(20, 0)
                expect(box.max[2] - box.min[2]).toBeCloseTo(20, 0)

                // The gate passed.
                expect(result.report?.ok).toBe(true)

                // A hole exists: volume is below a SOLID 10 mm-radius, 20 mm-tall cylinder.
                const solidVolume = Math.PI * 10 * 10 * 20
                expect(part.volume()).toBeLessThan(solidVolume)

                part.delete()
            },
            LIVE_TIMEOUT_MS
        )
    })

    context("a simple drilled bracket", () => {
        it.skipIf(!KEY)(
            "builds a watertight, printable plate with a bore through it",
            async () => {
                // Touch the kernel so a key-less run still resolves WASM cleanly.
                await initManifold()
                const result = await evaluatePrompt({
                    apiKey: KEY as string,
                    prompt:
                        "Make a 40 mm by 40 mm by 8 mm plate and drill a 10 mm diameter hole straight " +
                        "down through the middle of it."
                })

                expect(result.ok).toBe(true)
                const part = result.manifold
                expect(part).not.toBeNull()
                if (!part) {
                    return
                }
                expect(part.status()).toBe("NoError")
                // A through-hole removes material from the 40×40×8 = 12800 mm³ slab.
                expect(part.volume()).toBeLessThan(40 * 40 * 8)
                expect(part.volume()).toBeGreaterThan(0)

                part.delete()
            },
            LIVE_TIMEOUT_MS
        )
    })
})
