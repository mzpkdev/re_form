import { useState } from "react"
import { AssistantPanel } from "./components/AssistantPanel"
import { SettingsView } from "./components/SettingsView"
import { Sidebar } from "./components/Sidebar"
import { ToolsPanel } from "./components/ToolsPanel"
import { TopBar } from "./components/TopBar"
import { Viewport } from "./components/Viewport"
import { cn } from "./design/cn"
import { IDENTITY_TRANSFORM, type Transform, transformedGeometry } from "./lib/model"
import { getManifold } from "./lib/modelStore"
import { exportStl } from "./lib/stl"

export const App = () => {
    const [view, setView] = useState<"editor" | "settings">("editor")
    const [activePanel, setActivePanel] = useState<"ai" | "tools" | null>(null)
    const [stlFile, setStlFile] = useState<File | null>(null)
    const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM)

    const handleExport = () => {
        const m = getManifold()
        if (!m) {
            return
        }
        const geometry = transformedGeometry(m, transform)
        const buffer = exportStl(geometry)
        geometry.dispose()
        const blob = new Blob([buffer], { type: "model/stl" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = "model.stl"
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
