import { useState } from "react"
import { AssistantPanel } from "./components/AssistantPanel"
import { SettingsView } from "./components/SettingsView"
import { Sidebar } from "./components/Sidebar"
import { ToolsPanel } from "./components/ToolsPanel"
import { TopBar } from "./components/TopBar"
import { Viewport } from "./components/Viewport"
import { cn } from "./design/cn"

export const App = () => {
    const [view, setView] = useState<"editor" | "settings">("editor")
    const [activePanel, setActivePanel] = useState<"ai" | "tools" | null>(null)
    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-on-background">
            <TopBar view={view} onNavigate={setView} />
            <main className={cn("min-h-0 flex-1", view === "editor" ? "flex" : "hidden")}>
                <Sidebar activePanel={activePanel} onSelect={setActivePanel} />
                <Viewport />
                <ToolsPanel open={activePanel === "tools"} onClose={() => setActivePanel(null)} />
                <AssistantPanel open={activePanel === "ai"} onClose={() => setActivePanel(null)} />
            </main>
            {view === "settings" ? <SettingsView onClose={() => setView("editor")} /> : null}
        </div>
    )
}
