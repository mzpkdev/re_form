import { useEffect, useState } from "react"
import * as THREE from "three"
import { Sidebar, TopBar } from "./components"
import { cn } from "./design/cn"
import { initManifold } from "./lib/manifold"
import { meshToBufferGeometry } from "./lib/model"
import { getManifold, setManifold } from "./lib/modelStore"
import { exportStl, verifyStlDimensions } from "./lib/stl"
import { AssistantPanel, SettingsView } from "./modules/assistant"
import { DrawingEditor, drawingToManifold, getDrawing } from "./modules/drawing"
import { MeshToolsPanel } from "./modules/mesh-tools"
import { ObfuscatePanel } from "./modules/obfuscate"
import { Viewport } from "./modules/viewer"

// No naming UI yet; the export plumbing is structured so a part name could be
// threaded in later (it would drive both the filename and, once 3MF lands, the
// per-object name).
const DEFAULT_PART_NAME = "model"

export const App = () => {
    const [view, setView] = useState<"editor" | "settings" | "draw">("editor")
    const [activePanel, setActivePanel] = useState<"ai" | "mesh" | "obfuscate" | null>(null)
    const [stlFile, setStlFile] = useState<File | null>(null)

    // The 3D solid is a DERIVED view of the drawing: on every entry into the
    // Editor view, re-detect the drawing's closed regions and extrude them into
    // the live solid the Viewport renders. Recomputed each entry because the
    // drawing may have changed in the Draw view since last time.
    //
    // Race/clobber safety:
    //   - `cancelled` is flipped by the cleanup, so a rapid Draw↔Editor toggle (or
    //     leaving the Editor before the WASM promise resolves) drops the stale
    //     result instead of writing it — only the latest entry's build can win.
    //   - We `setManifold` only when the build is non-null, so entering the Editor
    //     with no closed shape leaves an imported STL untouched rather than
    //     clobbering it with an empty solid.
    useEffect(() => {
        if (view !== "editor") return
        let cancelled = false
        initManifold().then((wasm) => {
            if (cancelled) return
            const solid = drawingToManifold(wasm, getDrawing())
            if (cancelled) {
                // Lost the race after the build; the handle is ours to free.
                solid?.delete()
                return
            }
            if (solid) setManifold(solid)
        })
        return () => {
            cancelled = true
        }
    }, [view])

    const handleExport = () => {
        const m = getManifold()
        if (!m) {
            return
        }
        const name = DEFAULT_PART_NAME
        const geometry = meshToBufferGeometry(m.getMesh())

        // Capture the intended size (mm) from the geometry before export so we
        // can confirm the written bytes encode the same dimensions.
        geometry.computeBoundingBox()
        const intended = geometry.boundingBox?.getSize(new THREE.Vector3())
        const intendedSize = intended ? { x: intended.x, y: intended.y, z: intended.z } : null

        const buffer = exportStl(geometry, { name, units: "mm" })
        geometry.dispose()

        if (intendedSize && !verifyStlDimensions(buffer, intendedSize)) {
            console.warn(`Exported STL dimensions do not match intended size (mm): ${JSON.stringify(intendedSize)}`)
        }

        const blob = new Blob([buffer], { type: "model/stl" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `${name}.stl`
        anchor.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-on-background">
            <TopBar view={view} onNavigate={setView} onImport={setStlFile} onExport={handleExport} />
            {/* The 3D editor main stays MOUNTED for the app's lifetime — only its
                visibility toggles. Unmounting it on the Draw view tore down the
                Viewport's WebGL context and mesh, and the rebuild on return raced
                the remount (getMesh on a freed Manifold throws), leaving the model
                blank after a Draw round-trip. Hidden-not-removed keeps the live
                mesh; the build effect just swaps its geometry on re-entry. */}
            <main className={cn("min-h-0 flex-1", view === "editor" ? "flex" : "hidden")}>
                <Sidebar activePanel={activePanel} onSelect={setActivePanel} onExport={handleExport} />
                <Viewport file={stlFile} />
                <MeshToolsPanel open={activePanel === "mesh"} onClose={() => setActivePanel(null)} />
                <ObfuscatePanel open={activePanel === "obfuscate"} onClose={() => setActivePanel(null)} />
                <AssistantPanel open={activePanel === "ai"} onClose={() => setActivePanel(null)} />
            </main>
            {view === "draw" ? (
                <main className="flex min-h-0 flex-1">
                    <DrawingEditor />
                </main>
            ) : null}
            {view === "settings" ? <SettingsView onClose={() => setView("editor")} /> : null}
        </div>
    )
}
