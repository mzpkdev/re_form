import { useState } from "react"
import * as THREE from "three"
import { AssistantPanel } from "./components/AssistantPanel"
import { SettingsView } from "./components/SettingsView"
import { ShufflePanel } from "./components/ShufflePanel"
import { Sidebar } from "./components/Sidebar"
import { ToolsPanel } from "./components/ToolsPanel"
import { TopBar } from "./components/TopBar"
import { Viewport } from "./components/Viewport"
import { cn } from "./design/cn"
import { IDENTITY_TRANSFORM, type Transform, transformedGeometry } from "./lib/model"
import { getManifold } from "./lib/modelStore"
import { exportStl, verifyStlDimensions } from "./lib/stl"

// No naming UI yet; the export plumbing is structured so a part name could be
// threaded in later (it would drive both the filename and, once 3MF lands, the
// per-object name).
const DEFAULT_PART_NAME = "model"

export const App = () => {
    const [view, setView] = useState<"editor" | "settings">("editor")
    const [activePanel, setActivePanel] = useState<"ai" | "tools" | "shuffle" | null>(null)
    const [stlFile, setStlFile] = useState<File | null>(null)
    const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM)

    const handleExport = () => {
        const m = getManifold()
        if (!m) {
            return
        }
        const name = DEFAULT_PART_NAME
        const geometry = transformedGeometry(m, transform)

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
            <main className={cn("min-h-0 flex-1", view === "editor" ? "flex" : "hidden")}>
                <Sidebar activePanel={activePanel} onSelect={setActivePanel} onExport={handleExport} />
                <Viewport file={stlFile} transform={transform} />
                <ToolsPanel
                    open={activePanel === "tools"}
                    onClose={() => setActivePanel(null)}
                    transform={transform}
                    onChange={setTransform}
                />
                <ShufflePanel open={activePanel === "shuffle"} onClose={() => setActivePanel(null)} />
                <AssistantPanel
                    open={activePanel === "ai"}
                    onClose={() => setActivePanel(null)}
                    transform={transform}
                    onTransformChange={setTransform}
                />
            </main>
            {view === "settings" ? <SettingsView onClose={() => setView("editor")} /> : null}
        </div>
    )
}
