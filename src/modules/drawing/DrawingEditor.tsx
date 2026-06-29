import { DepthControl } from "./DepthControl"
import { DrawingCanvas } from "./DrawingCanvas"
import { FileControl } from "./FileControl"
import { GridControl } from "./GridControl"
import { PlaneSwitcher } from "./PlaneSwitcher"
import { Toolbar } from "./Toolbar"
import { useUndoRedoKeymap } from "./useUndoRedoKeymap"

/**
 * Mountable view for the 2D technical-drawing editor: the canvas fills the area
 * with the tool palette floating over its top-left corner, the plane switcher
 * floating top-center, the grid-size control floating top-right, the JSON
 * import/export card floating bottom-left, and the extrude-depth control floating
 * bottom-right. `useUndoRedoKeymap` arms the Cmd/Ctrl+Z (undo) / Cmd/Ctrl+Shift+Z
 * and Ctrl+Y (redo) shortcuts while this view is mounted.
 *
 * The 3D solid is a DERIVED view of the drawing: there is no manual extrude here.
 * Switching to the Editor view re-detects every closed region and extrudes it (see
 * `App`/`drawingToManifold`); this view only sets the depth those extrusions use.
 */
export const DrawingEditor = () => {
    useUndoRedoKeymap()

    return (
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
            <div className="absolute bottom-4 left-4">
                <FileControl />
            </div>
            <div className="absolute right-4 bottom-4">
                <DepthControl />
            </div>
        </section>
    )
}
