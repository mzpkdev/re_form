import { describe, expect, it } from "bun:test"
import * as THREE from "three"
import { Widget } from "./geometry"
import { initManifold } from "./manifold"

const context = describe

describe("geometry", () => {
    context("Widget.build", () => {
        it("builds a non-empty, internally consistent solid", async () => {
            const wasm = await initManifold()
            const widget = Widget.build(wasm)
            expect(widget.mesh.numVert).toBeGreaterThan(0)
            expect(widget.mesh.numTri).toBeGreaterThan(0)
            expect(widget.mesh.numProp).toBeGreaterThanOrEqual(3)
            expect(widget.mesh.vertProperties.length).toBe(widget.mesh.numVert * widget.mesh.numProp)
            expect(widget.mesh.triVerts.length).toBe(widget.mesh.numTri * 3)
            expect(widget.volume).toBeGreaterThan(0)
            expect(widget.surfaceArea).toBeGreaterThan(0)
        })
    })
    context("Widget#toBufferGeometry", () => {
        it("maps the widget mesh onto a three.js BufferGeometry", async () => {
            const wasm = await initManifold()
            const widget = Widget.build(wasm)
            const geometry = widget.toBufferGeometry()
            expect(geometry).toBeInstanceOf(THREE.BufferGeometry)
            const position = geometry.getAttribute("position")
            expect(position.itemSize).toBe(3)
            expect(position.count).toBe(widget.mesh.numVert)
            expect(geometry.getAttribute("normal").count).toBe(widget.mesh.numVert)
            expect(geometry.getIndex()?.count).toBe(widget.mesh.numTri * 3)
        })
    })
})
