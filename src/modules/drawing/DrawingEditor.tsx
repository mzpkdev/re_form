import { DrawingCanvas } from "./DrawingCanvas"
import { GridControl } from "./GridControl"
import { PlaneSwitcher } from "./PlaneSwitcher"
import { Toolbar } from "./Toolbar"

/**
 * Mountable view for the 2D technical-drawing editor: the canvas fills the area
 * with the tool palette floating over its top-left corner, the plane switcher
 * floating top-center, and the grid-size control floating top-right.
 */
export const DrawingEditor = () => (
    <section className="relative flex-1 overflow-hidden bg-3d-grid">
        <DrawingCanvas />
        <div className="absolute top-4 left-4">
            <Toolbar />
        </div>
        <div className="-translate-x-1/2 absolute top-4 left-1/2">
            <PlaneSwitcher />
        </div>
        <div className="absolute top-4 right-4">
            <GridControl />
        </div>
    </section>
)
