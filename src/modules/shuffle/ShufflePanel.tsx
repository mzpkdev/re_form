import { Shuffle, X } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "../../design/cn"
import { initManifold } from "../../lib/manifold"
import { geometryToManifold, meshToBufferGeometry } from "../../lib/model"
import { getManifold, setManifold, useModelVersion } from "../../lib/modelStore"
import { shuffleGeometry } from "./shuffle"

type Stats = { before: number; after: number }

/** Binary STL size for a triangle count: 84-byte header/count prefix + 50 bytes/triangle. */
const stlBytes = (triangles: number): number => 84 + triangles * 50

/** Human-readable byte size: KB up to ~1 MB, then MB with one decimal. */
const formatBytes = (bytes: number): string =>
    bytes < 1024 * 1024 ? `${Math.round(bytes / 1024).toLocaleString()} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Triangle ceiling for a remix. Subdivide quadruples the count per pass and the
 * whole pipeline (shuffle → weld → manifold validate) runs synchronously on the
 * main thread, so a much larger mesh freezes the tab. A safe upper bound, not a
 * hardware limit — tune if the budget proves too tight or too loose.
 */
const MAX_TRIANGLES = 2_000_000

/** Fullscreen-blur cue timing. OVERLAY_FADE_MS must match the `duration-150` class below. */
const OVERLAY_HOLD_MS = 150
const OVERLAY_FADE_MS = 150

/** Resolve after `ms` milliseconds. */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolve once the browser has actually painted a frame. Double rAF is the
 * reliable "after next paint" signal — rAF #1 runs before the paint, rAF #2
 * after — so awaiting this guarantees the blur overlay is on screen before the
 * synchronous remix begins and (potentially) freezes the main thread.
 */
const nextPaint = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

export const ShufflePanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const [subdivide, setSubdivide] = useState(0)
    const [jitter, setJitter] = useState(0)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [stats, setStats] = useState<Stats | null>(null)
    const [overlay, setOverlay] = useState<"hidden" | "shown" | "fading">("hidden")
    // Subscribe to the live model so the empty-state and Confirm button track loads/edits.
    useModelVersion()
    const model = getManifold()
    const hasModel = model !== null
    // numTri() is O(1) (no mesh bake), so it's safe to read every render. Subdivide
    // quadruples triangles per pass; project the result and gate Confirm on the budget.
    const projectedTriangles = (model?.numTri() ?? 0) * 4 ** subdivide
    const overBudget = projectedTriangles > MAX_TRIANGLES

    // Remix the loaded model and replace it in the store — the Viewport re-bakes
    // from the new handle, so the preview updates in place. Reorder is omitted: the
    // export re-serializes through manifold's canonical order, so only subdivide and
    // jitter (real geometry changes) survive to the saved file.
    const onConfirm = async () => {
        const source = getManifold()
        if (!source) {
            return
        }
        // Guard the exponential subdivide blow-up before any heavy work: the pipeline
        // runs synchronously on the main thread, so an oversized remix freezes the tab.
        // The disabled button already blocks this; this backstop covers a model that
        // changed between render and click.
        const before = source.numTri()
        if (before * 4 ** subdivide > MAX_TRIANGLES) {
            setError(`Too many triangles to remix (~${(before * 4 ** subdivide).toLocaleString()}). Lower Subdivide.`)
            return
        }
        setError(null)
        // Paint a fullscreen blur and wait for it to actually hit the screen BEFORE the
        // synchronous remix blocks the main thread — so the user always gets a cue, and if
        // a heavy mesh does freeze the tab it freezes with the blur already visible.
        setOverlay("shown")
        await nextPaint()
        setPending(true)
        try {
            const wasm = await initManifold()
            const indexed = meshToBufferGeometry(source.getMesh())
            // shuffleGeometry works on a non-indexed triangle soup.
            const soup = indexed.toNonIndexed()
            indexed.dispose()
            const seed = Math.floor(Math.random() * 0x7fffffff)
            const remixed = shuffleGeometry(soup, { reorder: false, subdivide, jitter, seed })
            soup.dispose()
            const after = remixed.getAttribute("position").count / 3
            try {
                const next = geometryToManifold(wasm, remixed)
                setManifold(next)
            } finally {
                remixed.dispose()
            }
            setStats({ before, after })
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Shuffle failed")
        } finally {
            setPending(false)
        }
        // Hold briefly so a fast remix still reads as a pulse, then fade the blur out.
        await delay(OVERLAY_HOLD_MS)
        setOverlay("fading")
        await delay(OVERLAY_FADE_MS)
        setOverlay("hidden")
    }

    return (
        <aside
            className={cn(
                "h-full shrink-0 overflow-hidden border-on-surface/10 transition-all duration-300 ease-snappy",
                open ? "w-panel border-l" : "w-0"
            )}
        >
            <div
                className={cn(
                    "flex h-full w-panel flex-col bg-surface transition duration-300 ease-snappy",
                    open ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
                )}
            >
                <div className="flex items-center justify-between border-b border-on-surface/10 bg-surface-container-low p-4">
                    <div className="flex items-center gap-2">
                        <Shuffle className="size-5 text-primary" />
                        <h3 className="font-mono text-title-md text-on-surface">SHUFFLE</h3>
                    </div>
                    <button type="button" onClick={onClose} className="text-tertiary hover:text-on-surface">
                        <X className="size-5" />
                    </button>
                </div>

                <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
                    {hasModel ? (
                        <>
                            <p className="font-sans text-body-sm text-tertiary">
                                Remix the loaded model into a look-alike with different geometry and replace it in the
                                viewport. Use Export to save the result.
                            </p>

                            <div className="flex flex-col gap-4">
                                <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">
                                    Options
                                </div>

                                <label className="flex items-center justify-between gap-2">
                                    <span className="font-sans text-body-sm text-on-surface">Subdivide</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={3}
                                        value={subdivide}
                                        onChange={(event) => {
                                            const parsed = Number.parseInt(event.target.value, 10)
                                            if (!Number.isNaN(parsed)) {
                                                setSubdivide(Math.min(3, Math.max(0, parsed)))
                                            }
                                        }}
                                        className="w-24 rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1.5 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
                                    />
                                </label>

                                <label className="flex items-center justify-between gap-2">
                                    <span className="font-sans text-body-sm text-on-surface">Jitter</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.01}
                                        value={jitter}
                                        onChange={(event) => {
                                            const parsed = Number.parseFloat(event.target.value)
                                            if (!Number.isNaN(parsed)) {
                                                setJitter(Math.max(0, parsed))
                                            }
                                        }}
                                        className="w-24 rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1.5 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
                                    />
                                </label>
                            </div>

                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    onClick={onConfirm}
                                    disabled={pending || overBudget || overlay !== "hidden"}
                                    className="w-full border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {pending ? "Shuffling…" : "Confirm"}
                                </button>
                                {overBudget ? (
                                    <div className="font-mono text-tiny text-error">
                                        ≈{projectedTriangles.toLocaleString()} triangles exceeds the{" "}
                                        {MAX_TRIANGLES.toLocaleString()} limit — lower Subdivide.
                                    </div>
                                ) : null}
                                {!overBudget && subdivide > 0 ? (
                                    <div className="font-mono text-tiny text-tertiary">
                                        ≈{projectedTriangles.toLocaleString()} triangles after subdivide
                                    </div>
                                ) : null}
                                {error ? <div className="font-mono text-tiny text-error">{error}</div> : null}
                                {stats ? (
                                    <div className="font-mono text-tiny text-tertiary">
                                        {stats.before.toLocaleString()} tris · {formatBytes(stlBytes(stats.before))} →{" "}
                                        {stats.after.toLocaleString()} tris · {formatBytes(stlBytes(stats.after))}
                                    </div>
                                ) : null}
                            </div>
                        </>
                    ) : (
                        <p className="font-sans text-body-sm text-tertiary">
                            Load a model first — Shuffle remixes the model currently in the viewport.
                        </p>
                    )}
                </div>
            </div>
            {overlay !== "hidden"
                ? createPortal(
                      <div
                          className={cn(
                              "pointer-events-none fixed inset-0 z-50 bg-surface/20 backdrop-blur-md transition-opacity duration-150 ease-snappy",
                              overlay === "fading" ? "opacity-0" : "opacity-100"
                          )}
                      />,
                      document.body
                  )
                : null}
        </aside>
    )
}
