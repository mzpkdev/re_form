import { useEffect, useState } from "react"
import * as THREE from "three"
import { Sidebar, TopBar } from "./components"
import { cn } from "./design/cn"
import { initManifold } from "./lib/manifold"
import { meshToBufferGeometry } from "./lib/model"
import { getManifold, setManifold, useModelVersion } from "./lib/modelStore"
import { exportStl, parseStl, verifyStlDimensions } from "./lib/stl"
import { AssistantPanel, SettingsView } from "./modules/assistant"
import { DrawingEditor, drawingToManifold, useDrawing } from "./modules/drawing"
import { MeshToolsPanel } from "./modules/mesh-tools"
import { ObfuscatePanel } from "./modules/obfuscate"
import { SegmentPanel, SegmentViewport } from "./modules/segment"
import { Viewport } from "./modules/viewer"

// No naming UI yet; the export plumbing is structured so a part name could be
// threaded in later (it would drive both the filename and, once 3MF lands, the
// per-object name).
const DEFAULT_PART_NAME = "model"

export const App = () => {
    const [view, setView] = useState<"editor" | "settings" | "draw">("editor")
    const [activePanel, setActivePanel] = useState<"ai" | "mesh" | "obfuscate" | "segment" | null>(null)
    const [stlFile, setStlFile] = useState<File | null>(null)
    // The imported STL parsed into a BufferGeometry, lifted here from inside the
    // Viewport so the Segment surface can borrow it. App OWNS this geometry's
    // lifecycle; segment code reads it without disposing it.
    const [importedGeometry, setImportedGeometry] = useState<THREE.BufferGeometry | null>(null)
    // When segmenting WITHOUT an imported STL, the source is the live
    // drawing-generated widget (modelStore) baked to a BufferGeometry. App owns
    // and disposes it; segment code borrows it read-only like `importedGeometry`.
    const [widgetGeometry, setWidgetGeometry] = useState<THREE.BufferGeometry | null>(null)
    const modelVersion = useModelVersion()
    const drawing = useDrawing()

    // The 3D solid is a DERIVED view of the drawing: re-detect the drawing's
    // closed regions and extrude them into the live solid the Viewport renders.
    // Re-runs both on entry into the Editor view AND whenever the document itself
    // changes (the `drawing` dep) — so an edit made while in the Editor (e.g. the
    // assistant rewriting the document) re-derives the solid immediately, not
    // only on the next view round-trip.
    //
    // Race/clobber safety:
    //   - `cancelled` is flipped by the cleanup, so a rapid change (or leaving the
    //     Editor before the WASM promise resolves) drops the stale result instead
    //     of writing it — only the latest build can win.
    //   - We `setManifold` only when the build is non-null, so a document with no
    //     closed shape leaves an imported STL untouched rather than clobbering it
    //     with an empty solid.
    useEffect(() => {
        if (view !== "editor") return
        let cancelled = false
        initManifold().then((wasm) => {
            if (cancelled) return
            const solid = drawingToManifold(wasm, drawing)
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
    }, [view, drawing])

    // Parse the picked STL once into a BufferGeometry the Segment surface borrows
    // (the Viewport parses its own copy internally; this is the lifted, segment-
    // facing one). App owns this geometry's lifetime end to end.
    //
    // Race/leak safety mirrors the build effect above:
    //   - `cancelled` drops a stale parse when `stlFile` changes mid-read, so only
    //     the latest file's geometry is ever committed.
    //   - The PREVIOUS geometry is disposed on every `stlFile` change and on
    //     unmount (the functional setState frees `prev` before swapping it in, and
    //     the cleanup disposes whatever the resolved parse stored).
    //   - `null` when there's no file, after freeing any geometry left behind.
    useEffect(() => {
        if (!stlFile) {
            setImportedGeometry((prev) => {
                prev?.dispose()
                return null
            })
            return
        }
        let cancelled = false
        stlFile.arrayBuffer().then((data) => {
            if (cancelled) return
            const geometry = parseStl(data)
            setImportedGeometry((prev) => {
                prev?.dispose()
                return geometry
            })
        })
        return () => {
            cancelled = true
            setImportedGeometry((prev) => {
                prev?.dispose()
                return null
            })
        }
    }, [stlFile])

    // Bake the live widget into a BufferGeometry to feed the Segment surface when
    // nothing was imported. Only while the Segment panel is open and there's no
    // imported STL; re-baked on model change. The effect cleanup disposes the
    // geometry it created (on change + unmount); the borrowed Manifold is left to
    // modelStore.
    // biome-ignore lint/correctness/useExhaustiveDependencies: modelVersion re-bakes the source when the live widget changes; the effect reads getManifold() imperatively, so Biome can't see the dependency.
    useEffect(() => {
        if (activePanel !== "segment" || importedGeometry) {
            setWidgetGeometry(null)
            return
        }
        const m = getManifold()
        if (!m) {
            setWidgetGeometry(null)
            return
        }
        const geometry = meshToBufferGeometry(m.getMesh())
        setWidgetGeometry(geometry)
        return () => {
            geometry.dispose()
        }
    }, [activePanel, importedGeometry, modelVersion])

    // The geometry the Segment panel + viewport read: the imported STL if present,
    // else the baked live widget.
    const segmentSource = importedGeometry ?? widgetGeometry

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
                {activePanel === "segment" ? <SegmentViewport geometry={segmentSource} /> : <Viewport file={stlFile} />}
                <MeshToolsPanel open={activePanel === "mesh"} onClose={() => setActivePanel(null)} />
                <ObfuscatePanel open={activePanel === "obfuscate"} onClose={() => setActivePanel(null)} />
                <SegmentPanel
                    open={activePanel === "segment"}
                    onClose={() => setActivePanel(null)}
                    geometry={segmentSource}
                />
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
