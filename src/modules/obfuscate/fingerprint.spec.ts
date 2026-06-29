import { describe, expect, it } from "bun:test"
import { identicon, meshDigest } from "./fingerprint"

const context = describe

const mesh = (verts: number[], tris: number[]) => ({
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris)
})

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]

describe("fingerprint", () => {
    context("meshDigest", () => {
        it("is deterministic for the same mesh", () => {
            expect(meshDigest(mesh(TRI, [0, 1, 2]))).toBe(meshDigest(mesh(TRI, [0, 1, 2])))
        })

        it("is 24 lowercase hex chars", () => {
            expect(meshDigest(mesh(TRI, [0, 1, 2]))).toMatch(/^[0-9a-f]{24}$/)
        })

        it("changes when triangle order changes (the reorder knob)", () => {
            const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]
            const a = meshDigest(mesh(verts, [0, 1, 2, 0, 2, 3]))
            const b = meshDigest(mesh(verts, [0, 2, 3, 0, 1, 2])) // same triangles, swapped order
            expect(a).not.toBe(b)
        })

        it("changes when a vertex moves (the jitter knob)", () => {
            const a = meshDigest(mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]))
            const b = meshDigest(mesh([0, 0, 0, 1, 0, 0, 0, 1, 0.01], [0, 1, 2]))
            expect(a).not.toBe(b)
        })
    })

    context("identicon", () => {
        it("is left-right symmetric with 25 cells and a hue in range", () => {
            const { cells, hue } = identicon(meshDigest(mesh(TRI, [0, 1, 2])))
            expect(cells).toHaveLength(25)
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    expect(cells[r * 5 + c]).toBe(cells[r * 5 + (4 - c)])
                }
            }
            expect(hue).toBeGreaterThanOrEqual(0)
            expect(hue).toBeLessThanOrEqual(360)
        })
    })
})
