import { DrawingCanvas } from "./DrawingCanvas"
import { ExtrudePanel } from "./ExtrudePanel"
import { FileControl } from "./FileControl"
import { GridControl } from "./GridControl"
import { PlaneSwitcher } from "./PlaneSwitcher"
import { Toolbar } from "./Toolbar"
import { useUndoRedoKeymap } from "./useUndoRedoKeymap"

/**
 * Mountable view for the 2D technical-drawing editor: the canvas fills the area
 * with the tool palette floating over its top-left corner, the plane switcher
 * floating top-center, the grid-size control floating top-right, the JSON
 * import/export card floating bottom-left, and the extrude card floating
 * bottom-right. `useUndoRedoKeymap` arms the Cmd/Ctrl+Z (undo) / Cmd/Ctrl+Shift+Z
 * and Ctrl+Y (redo) shortcuts while this view is mounted. `onShow3D` flips the
 * shell to the 3D viewport after a successful extrude (the new solid is already
 * in the model store by then).
 */
export const DrawingEditor = ({ onShow3D }: { onShow3D: () => void }) => {
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
                <ExtrudePanel onShow3D={onShow3D} />
            </div>
        </section>
    )
}
