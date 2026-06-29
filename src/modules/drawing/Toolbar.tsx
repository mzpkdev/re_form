import { Minus, MousePointer2, Spline } from "lucide-react"
import { cn } from "../../design/cn"
import { setActiveTool, type Tool, useActiveTool } from "./editorStore"

/**
 * The drawing tool palette: a compact vertical column of icon buttons that
 * reads the active tool and switches it. The active tool is highlighted with the
 * primary accent (same active-state idiom as the app `Sidebar`). Technical
 * drawing offers only Select, Line, and Polyline — there is no freeform circle.
 * Selection and delete are a later phase; for now `select` just pans the canvas.
 */
const TOOLS: { tool: Tool; label: string; icon: typeof Minus }[] = [
    { tool: "select", label: "Select", icon: MousePointer2 },
    { tool: "line", label: "Line", icon: Minus },
    { tool: "polyline", label: "Polyline", icon: Spline }
]

export const Toolbar = () => {
    const activeTool = useActiveTool()
    return (
        <div
            className="flex flex-col gap-1 border border-on-surface/10 bg-surface-container p-1 shadow-lg chamfer"
            role="toolbar"
            aria-label="Drawing tools"
            aria-orientation="vertical"
        >
            {TOOLS.map(({ tool, label, icon: Icon }) => {
                const active = activeTool === tool
                return (
                    <button
                        key={tool}
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-pressed={active}
                        onClick={() => setActiveTool(tool)}
                        className={cn(
                            "flex size-10 items-center justify-center rounded transition-colors",
                            active
                                ? "bg-primary text-on-primary"
                                : "text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                        )}
                    >
                        <Icon className="size-5" />
                    </button>
                )
            })}
        </div>
    )
}
