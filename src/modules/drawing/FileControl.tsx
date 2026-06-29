import { Download, FileJson, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { loadDrawing, useDrawing } from "./documentStore"
import { deserialize, serialize } from "./serialize"

/**
 * Floating card to export the current 2D DRAWING document as JSON and import one
 * back. This is the drawing document (distinct from the STL/3D export in the
 * TopBar): Export serializes the doc to a downloaded `drawing.json`; Import reads
 * a chosen file, validates it through `deserialize`, and loads it via
 * `loadDrawing` (which replaces the doc and clears undo history). A malformed
 * file makes `deserialize` throw; that is caught and surfaced inline — the editor
 * never crashes on bad input. Styled with VERTEX CORE tokens to match the
 * floating `Toolbar` and `GridControl`.
 */
export const FileControl = () => {
    const drawing = useDrawing()
    const inputRef = useRef<HTMLInputElement>(null)
    const [error, setError] = useState<string | null>(null)

    const handleExport = () => {
        const blob = new Blob([serialize(drawing)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = "drawing.json"
        anchor.click()
        URL.revokeObjectURL(url)
    }

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        // Reset the input so re-picking the same file fires `change` again.
        event.target.value = ""
        if (!file) return
        setError(null)
        try {
            const text = await file.text()
            loadDrawing(deserialize(text))
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not load this drawing.")
        }
    }

    return (
        <div className="flex w-44 flex-col gap-2 border border-on-surface/10 bg-surface-container p-3 shadow-lg chamfer">
            <div className="flex items-center gap-2">
                <FileJson className="size-4 text-primary" />
                <span className="font-mono text-label-caps uppercase tracking-widest text-tertiary">File</span>
            </div>
            <button
                type="button"
                onClick={handleExport}
                className="flex w-full items-center justify-center gap-2 border border-on-surface/10 bg-surface-container-low py-2 font-mono text-label-caps text-on-surface transition-colors chamfer hover:border-on-surface hover:text-primary"
            >
                <Download className="size-4" />
                Export
            </button>
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 border border-on-surface/10 bg-surface-container-low py-2 font-mono text-label-caps text-on-surface transition-colors chamfer hover:border-on-surface hover:text-primary"
            >
                <Upload className="size-4" />
                Import
            </button>
            <input
                ref={inputRef}
                type="file"
                accept="application/json"
                onChange={handleImport}
                className="hidden"
                aria-label="Import drawing JSON"
            />
            {error ? <div className="font-mono text-tiny text-error">{error}</div> : null}
        </div>
    )
}
