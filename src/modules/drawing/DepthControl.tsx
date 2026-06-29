import { useEffect, useState } from "react"
import { setExtrudeDepth, useExtrudeDepth } from "./documentStore"

/**
 * A compact labelled number input for the document's extrusion depth (mm). The
 * Editor view extrudes every detected closed region by this depth, so changing it
 * sets the height of the next derived solid. Mirrors `GridControl`: a LOCAL draft
 * while typing (so a half-entered value doesn't commit mid-keystroke) settles to
 * the store on blur or Enter — one commit per settled value keeps undo history
 * clean. An empty or non-positive draft reverts to the current depth. Styled with
 * VERTEX CORE tokens to match the floating `Toolbar` and `GridControl`.
 */
export const DepthControl = () => {
    const depth = useExtrudeDepth()
    const [draft, setDraft] = useState(String(depth))

    // Re-sync the draft when the stored depth changes from elsewhere
    // (undo/redo, document load, a clamped commit).
    useEffect(() => {
        setDraft(String(depth))
    }, [depth])

    const commit = () => {
        const parsed = Number.parseFloat(draft)
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setDraft(String(depth)) // revert an invalid draft
            return
        }
        setExtrudeDepth(parsed) // no-op in the store when unchanged
        setDraft(String(parsed))
    }

    return (
        <label className="flex items-center gap-2 border border-on-surface/10 bg-surface-container px-3 py-2 shadow-lg chamfer">
            <span className="font-mono text-label-caps uppercase tracking-widest text-tertiary">Depth (mm)</span>
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
                aria-label="Extrude depth in millimetres"
                className="w-16 rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
            />
        </label>
    )
}
