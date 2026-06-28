import { describe, expect, it } from "bun:test"
import { initManifold } from "./manifold"
import { makeChamferedBox, makeCone, makeShell, makeTube } from "./primitives"

const context = describe

const wasm = await initManifold()

/** Bounding-box extent (max − min) along each axis. */
const extent = (box: { min: [number, number, number]; max: [number, number, number] }): [number, number, number] => [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2]
]

describe("makeCone", () => {
    context("a frustum with two distinct radii", () => {
        it("is a valid centred solid whose volume matches the analytic frustum", () => {
            const r1 = 10
            const r2 = 5
            const h = 20
            const cone = makeCone(wasm, { radiusBottom: r1, radiusTop: r2, height: h })
            try {
                expect(cone.status()).toBe("NoError")
                expect(cone.isEmpty()).toBe(false)

                const box = cone.boundingBox()
                const [dx, dy, dz] = extent(box)
                // Widest at the bottom radius; height along Z; centred at origin.
                expect(dx).toBeCloseTo(2 * r1, 0)
                expect(dy).toBeCloseTo(2 * r1, 0)
                expect(dz).toBeCloseTo(h, 5)
                expect(box.min[2]).toBeCloseTo(-h / 2, 5)
                expect(box.max[2]).toBeCloseTo(h / 2, 5)

                const expected = (Math.PI / 3) * h * (r1 * r1 + r1 * r2 + r2 * r2)
                expect(cone.volume()).toBeCloseTo(expected, -2)
                expect(Math.abs(cone.volume() - expected) / expected).toBeLessThan(0.05)
            } finally {
                cone.delete()
            }
        })
    })

    context("a pointed cone (radiusTop 0)", () => {
        it("is valid and matches the analytic cone volume", () => {
            const r1 = 8
            const h = 12
            const cone = makeCone(wasm, { radiusBottom: r1, radiusTop: 0, height: h })
            try {
                expect(cone.status()).toBe("NoError")
                const expected = (Math.PI / 3) * h * (r1 * r1)
                expect(cone.volume()).toBeCloseTo(expected, -2)
                expect(Math.abs(cone.volume() - expected) / expected).toBeLessThan(0.05)
            } finally {
                cone.delete()
            }
        })
    })

    context("invalid dimensions", () => {
        it("throws on a non-positive radiusBottom", () => {
            expect(() => makeCone(wasm, { radiusBottom: 0, radiusTop: 5, height: 10 })).toThrow()
        })

        it("throws on a negative radiusTop", () => {
            expect(() => makeCone(wasm, { radiusBottom: 10, radiusTop: -1, height: 10 })).toThrow()
        })

        it("throws on a non-positive height", () => {
            expect(() => makeCone(wasm, { radiusBottom: 10, radiusTop: 5, height: 0 })).toThrow()
        })
    })
})

describe("makeTube", () => {
    context("a pipe with a through-bore", () => {
        it("is a valid open-ended tube whose volume and height match expectation", () => {
            const R = 10
            const w = 2
            const h = 20
            const tube = makeTube(wasm, { outerRadius: R, wall: w, height: h })
            try {
                expect(tube.status()).toBe("NoError")
                expect(tube.isEmpty()).toBe(false)

                const box = tube.boundingBox()
                const [dx, dy, dz] = extent(box)
                expect(dx).toBeCloseTo(2 * R, 0)
                expect(dy).toBeCloseTo(2 * R, 0)
                // The bore is taller than the wall, but the tube's own height bounds Z.
                expect(dz).toBeCloseTo(h, 5)

                const expected = Math.PI * h * (R * R - (R - w) * (R - w))
                expect(tube.volume()).toBeCloseTo(expected, -2)
                expect(Math.abs(tube.volume() - expected) / expected).toBeLessThan(0.05)
            } finally {
                tube.delete()
            }
        })
    })

    context("invalid dimensions", () => {
        it("throws when wall is not less than outerRadius", () => {
            expect(() => makeTube(wasm, { outerRadius: 5, wall: 5, height: 10 })).toThrow()
            expect(() => makeTube(wasm, { outerRadius: 5, wall: 8, height: 10 })).toThrow()
        })

        it("throws on a non-positive wall", () => {
            expect(() => makeTube(wasm, { outerRadius: 10, wall: 0, height: 10 })).toThrow()
        })

        it("throws on a non-positive outerRadius", () => {
            expect(() => makeTube(wasm, { outerRadius: -1, wall: 1, height: 10 })).toThrow()
        })

        it("throws on a non-positive height", () => {
            expect(() => makeTube(wasm, { outerRadius: 10, wall: 2, height: 0 })).toThrow()
        })
    })
})

describe("makeShell", () => {
    context("hollowing a solid cube", () => {
        it("returns a valid shell whose volume is between 0 and the solid cube", () => {
            const edge = 20
            const wall = 2
            const cube = wasm.Manifold.cube([edge, edge, edge], true)
            const cubeVolume = cube.volume()
            try {
                const shell = makeShell(wasm, { solid: cube, wall })
                try {
                    expect(shell.status()).toBe("NoError")
                    expect(shell.isEmpty()).toBe(false)
                    const v = shell.volume()
                    expect(v).toBeGreaterThan(0)
                    expect(v).toBeLessThan(cubeVolume)

                    // Outer envelope is unchanged: the shell still spans the full cube bbox.
                    const [dx, dy, dz] = extent(shell.boundingBox())
                    expect(dx).toBeCloseTo(edge, 0)
                    expect(dy).toBeCloseTo(edge, 0)
                    expect(dz).toBeCloseTo(edge, 0)
                } finally {
                    shell.delete()
                }
                // The caller's solid is left intact (not deleted by makeShell).
                expect(cube.status()).toBe("NoError")
                expect(cube.volume()).toBeCloseTo(cubeVolume, 5)
            } finally {
                cube.delete()
            }
        })
    })

    context("invalid dimensions", () => {
        it("throws on a non-positive wall", () => {
            const cube = wasm.Manifold.cube([20, 20, 20], true)
            try {
                expect(() => makeShell(wasm, { solid: cube, wall: 0 })).toThrow()
                expect(() => makeShell(wasm, { solid: cube, wall: -1 })).toThrow()
            } finally {
                cube.delete()
            }
        })
    })
})

describe("makeChamferedBox", () => {
    context("a box with a tapered top", () => {
        it("keeps the full base bounding box but encloses less than the full block", () => {
            const sizeX = 30
            const sizeY = 20
            const sizeZ = 10
            const chamfer = 3
            const boxSolid = makeChamferedBox(wasm, { sizeX, sizeY, sizeZ, chamfer })
            try {
                expect(boxSolid.status()).toBe("NoError")
                expect(boxSolid.isEmpty()).toBe(false)

                const [dx, dy, dz] = extent(boxSolid.boundingBox())
                expect(dx).toBeCloseTo(sizeX, 5)
                expect(dy).toBeCloseTo(sizeY, 5)
                expect(dz).toBeCloseTo(sizeZ, 5)

                // The tapered top removes material => strictly less than the full block.
                expect(boxSolid.volume()).toBeGreaterThan(0)
                expect(boxSolid.volume()).toBeLessThan(sizeX * sizeY * sizeZ)
            } finally {
                boxSolid.delete()
            }
        })
    })

    context("invalid dimensions", () => {
        it("throws when the chamfer is too big for the footprint", () => {
            // 2 * chamfer >= min(sizeX, sizeY) collapses the top face.
            expect(() => makeChamferedBox(wasm, { sizeX: 10, sizeY: 10, sizeZ: 10, chamfer: 5 })).toThrow()
            expect(() => makeChamferedBox(wasm, { sizeX: 10, sizeY: 10, sizeZ: 10, chamfer: 8 })).toThrow()
        })

        it("throws when the chamfer is not less than sizeZ", () => {
            expect(() => makeChamferedBox(wasm, { sizeX: 30, sizeY: 30, sizeZ: 2, chamfer: 3 })).toThrow()
        })

        it("throws on a non-positive chamfer", () => {
            expect(() => makeChamferedBox(wasm, { sizeX: 30, sizeY: 20, sizeZ: 10, chamfer: 0 })).toThrow()
        })

        it("throws on a non-positive dimension", () => {
            expect(() => makeChamferedBox(wasm, { sizeX: -1, sizeY: 20, sizeZ: 10, chamfer: 3 })).toThrow()
            expect(() => makeChamferedBox(wasm, { sizeX: 30, sizeY: 0, sizeZ: 10, chamfer: 3 })).toThrow()
            expect(() => makeChamferedBox(wasm, { sizeX: 30, sizeY: 20, sizeZ: -5, chamfer: 3 })).toThrow()
        })
    })
})
