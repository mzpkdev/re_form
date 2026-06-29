import { useEffect } from "react"
import { redo, undo } from "./documentStore"

/**
 * Bind the document-level undo/redo keyboard shortcuts while mounted:
 *   - Cmd/Ctrl+Z          → undo
 *   - Cmd/Ctrl+Shift+Z    → redo
 *   - Ctrl+Y              → redo (the Windows idiom)
 *
 * `preventDefault` keeps the browser's own undo from firing alongside ours.
 *
 * GUARD: do nothing when a form field is focused (INPUT/TEXTAREA), so Cmd+Z in
 * the grid mm input does native text editing — mirrors the Delete-key guard in
 * `DrawingCanvas`. Bound once on `document` (the canvas SVG doesn't focus to
 * receive keydown) and cleaned up on unmount.
 */
export const useUndoRedoKeymap = (): void => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            // Leave native text editing (incl. its own undo) to focused fields.
            const tag = document.activeElement?.tagName
            if (tag === "INPUT" || tag === "TEXTAREA") return

            const mod = event.metaKey || event.ctrlKey
            const key = event.key.toLowerCase()

            if (mod && key === "z") {
                event.preventDefault()
                if (event.shiftKey) redo()
                else undo()
                return
            }
            // Ctrl+Y is the conventional Windows redo.
            if (mod && key === "y") {
                event.preventDefault()
                redo()
            }
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [])
}
