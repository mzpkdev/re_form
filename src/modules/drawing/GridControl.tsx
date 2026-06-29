import { useEffect, useState } from "react"
import { setGridSize, useGridSize } from "./documentStore"

/**
 * A compact labelled number input for the document's grid spacing (mm). It drives
 * both the visible grid and the hard snapping, so changing it re-snaps the next
 * placed point and redraws the grid.
 *
 * The input holds a LOCAL draft while typing (so a half-entered "1" doesn't snap
 * the grid to 1 mm mid-keystroke) and settles the value to the store on blur or
 * Enter — one commit per settled value keeps undo history clean. An empty or
 * non-positive draft reverts to the current grid size. Styled with VERTEX CORE
 * tokens to match the floating `Toolbar`.
 */
export const GridControl = () => {
    const gridSize = useGridSize()
    const [draft, setDraft] = useState(String(gridSize))

    // Re-sync the draft when the stored grid size changes from elsewhere
    // (undo/redo, document load, a clamped commit).
    useEffect(() => {
        setDraft(String(gridSize))
    }, [gridSize])

    const commit = () => {
        const parsed = Number.parseFloat(draft)
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setDraft(String(gridSize)) // revert an invalid draft
            return
        }
        setGridSize(parsed) // no-op in the store when unchanged
        setDraft(String(parsed))
    }

    return (
        <label className="flex items-center gap-2 border border-on-surface/10 bg-surface-container px-3 py-2 shadow-lg chamfer">
            <span className="font-mono text-label-caps uppercase tracking-widest text-tertiary">Grid (mm)</span>
            <input
                type="number"
                min={1}
                step={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                }}
                aria-label="Grid size in millimetres"
                className="w-16 rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
            />
        </label>
    )
}
