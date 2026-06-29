import { Box } from "lucide-react"
import { useState } from "react"
import { initManifold } from "../../lib/manifold"
import { setManifold } from "../../lib/modelStore"
import { getEntity } from "./document"
import { useDrawing } from "./documentStore"
import { useActivePlane, useSelection } from "./editorStore"
import { inferPlane, profileToManifold } from "./extrude"
import type { Entity, Polyline } from "./types"

/** The selected entity when it is exactly one CLOSED polyline, else null. */
const selectedProfile = (entityById: (id: string) => Entity | undefined, selection: string[]): Polyline | null => {
    if (selection.length !== 1) {
        return null
    }
    const entity = entityById(selection[0])
    if (entity?.type === "polyline" && entity.closed) {
        return entity
    }
    return null
}

const DEFAULT_DEPTH = 10

/**
 * Floating card that extrudes the selected closed-polyline profile into a 3D
 * solid and shows it in the viewport. Enabled only when exactly one closed
 * polyline is selected (otherwise it renders a hint and a disabled button). On
 * extrude it builds the solid through the manifold pipeline and hands it to
 * `setManifold` — which takes ownership — then flips to the 3D view via
 * `onShow3D`. An invalid (self-intersecting/degenerate) profile makes manifold
 * throw; that is caught and surfaced inline without leaking a handle or
 * crashing. Styled with VERTEX CORE tokens to match the floating `Toolbar` and
 * `GridControl`.
 */
export const ExtrudePanel = ({ onShow3D }: { onShow3D: () => void }) => {
    const drawing = useDrawing()
    const selection = useSelection()
    const activePlane = useActivePlane()
    const [depth, setDepth] = useState(DEFAULT_DEPTH)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const profile = selectedProfile((id) => getEntity(drawing, id), selection)
    const canExtrude = profile !== null && depth >= 1 && !busy

    const handleExtrude = async () => {
        if (!profile || busy) {
            return
        }
        setError(null)
        setBusy(true)
        try {
            const wasm = await initManifold()
            const plane = inferPlane(profile.points) ?? activePlane
            // profileToManifold returns a fresh handle; setManifold takes
            // ownership (and deletes the previous live solid). We must NOT delete
            // `solid` here — doing so would free the handle the store now owns.
            const solid = profileToManifold(wasm, profile, plane, depth)
            setManifold(solid)
            onShow3D()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not extrude this profile.")
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex w-56 flex-col gap-3 border border-on-surface/10 bg-surface-container p-3 shadow-lg chamfer">
            <div className="flex items-center gap-2">
                <Box className="size-4 text-primary" />
                <span className="font-mono text-label-caps uppercase tracking-widest text-tertiary">Extrude</span>
            </div>

            {profile ? (
                <>
                    <label className="flex items-center justify-between gap-2">
                        <span className="font-sans text-body-sm text-on-surface">Depth (mm)</span>
                        <input
                            type="number"
                            min={1}
                            step={1}
                            value={depth}
                            onChange={(event) => {
                                const parsed = Number.parseFloat(event.target.value)
                                if (Number.isFinite(parsed)) {
                                    setDepth(Math.max(1, parsed))
                                }
                            }}
                            aria-label="Extrude depth in millimetres"
                            className="w-20 rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={handleExtrude}
                        disabled={!canExtrude}
                        className="w-full border border-transparent bg-primary py-2 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {busy ? "Extruding…" : "Extrude → 3D"}
                    </button>
                    {error ? <div className="font-mono text-tiny text-error">{error}</div> : null}
                </>
            ) : (
                <p className="font-sans text-tiny text-tertiary">Select one closed polyline to extrude it into 3D.</p>
            )}
        </div>
    )
}
