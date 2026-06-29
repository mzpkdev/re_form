import { cn } from "../../design/cn"
import { setActivePlane, useActivePlane } from "./editorStore"
import type { Plane } from "./types"

/**
 * The view-plane switch: a compact horizontal segmented control over the three
 * principal planes. It reads the active plane and switches it; the canvas
 * re-projects every entity from `useActivePlane` on its own, so flipping the
 * plane is all this does. The active segment takes the primary accent — the same
 * active-state idiom as the `Toolbar`. Styled to match the floating
 * toolbar/grid controls (bordered surface card, chamfer, drop shadow).
 */
const PLANES: { plane: Plane; label: string }[] = [
    { plane: "front", label: "Front" },
    { plane: "top", label: "Top" },
    { plane: "side", label: "Side" }
]

export const PlaneSwitcher = () => {
    const activePlane = useActivePlane()
    return (
        <div
            className="flex gap-1 border border-on-surface/10 bg-surface-container p-1 shadow-lg chamfer"
            role="toolbar"
            aria-label="View plane"
        >
            {PLANES.map(({ plane, label }) => {
                const active = activePlane === plane
                return (
                    <button
                        key={plane}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setActivePlane(plane)}
                        className={cn(
                            "rounded px-3 py-1.5 font-mono text-label-caps uppercase tracking-widest transition-colors",
                            active
                                ? "bg-primary text-on-primary"
                                : "text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                        )}
                    >
                        {label}
                    </button>
                )
            })}
        </div>
    )
}
