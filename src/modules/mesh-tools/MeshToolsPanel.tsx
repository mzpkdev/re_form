import { SlidersHorizontal, X } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "../../design/cn"
import { getManifold, setManifold, useModelVersion } from "../../lib/modelStore"
import { adaptiveRefine, simplify, smooth, VARY_MAX_AMPLITUDE, vary } from "./mesh"

type Stats = { before: number; after: number }

/** Binary STL size for a triangle count: 84-byte header/count prefix + 50 bytes/triangle. */
const stlBytes = (triangles: number): number => 84 + triangles * 50

/** Human-readable byte size: KB up to ~1 MB, then MB with one decimal. */
const formatBytes = (bytes: number): string =>
    bytes < 1024 * 1024 ? `${Math.round(bytes / 1024).toLocaleString()} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Triangle ceiling for an operation. Smooth and Vary both `refine`, which grows
 * the count by ~n² per edge split, and the whole op (warp/refine → manifold
 * validate) runs synchronously on the main thread — a much larger mesh freezes
 * the tab. A safe upper bound, not a hardware limit; tune if too tight/loose.
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
 * synchronous operation begins and (potentially) freezes the main thread.
 */
const nextPaint = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** refine(n) splits each edge into n pieces, so triangle count scales ~n². */
const projectRefine = (triangles: number, refine: number): number => triangles * refine * refine

export const MeshToolsPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const [tolerance, setTolerance] = useState(0.1)
    const [amplitude, setAmplitude] = useState(0.1)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [stats, setStats] = useState<Stats | null>(null)
    const [overlay, setOverlay] = useState<"hidden" | "shown" | "fading">("hidden")
    // Subscribe to the live model so the empty-state and apply buttons track loads/edits.
    useModelVersion()
    const model = getManifold()
    const hasModel = model !== null
    // numTri() is O(1) (no mesh bake), so it's safe to read every render. Smooth and
    // Vary refine (~n² triangles); the refine factor is sized adaptively to the
    // budget so detailed models stay usable instead of being auto-disabled at a
    // fixed level. We still gate the buttons in case even the minimum refine
    // (refine(2) = ~4×) exceeds the budget on a very dense input.
    const triangles = model?.numTri() ?? 0
    const refineFactor = adaptiveRefine(triangles, MAX_TRIANGLES)
    const refineProjected = projectRefine(triangles, refineFactor)
    const overBudget = refineProjected > MAX_TRIANGLES

    // Apply an op to the loaded model and replace it in the store. The store
    // deletes the previous handle; the Viewport re-bakes from the new one, so the
    // preview updates in place. `build` returns the new Manifold from `current`.
    const apply = async (
        build: (current: NonNullable<ReturnType<typeof getManifold>>) => ReturnType<typeof getManifold>
    ) => {
        const source = getManifold()
        if (!source || overlay !== "hidden") {
            return
        }
        const before = source.numTri()
        setError(null)
        // Paint a fullscreen blur and wait for it to actually hit the screen BEFORE the
        // synchronous op blocks the main thread — so the user always gets a cue, and if
        // a heavy mesh does freeze the tab it freezes with the blur already visible.
        setOverlay("shown")
        await nextPaint()
        setPending(true)
        try {
            const next = build(source)
            if (!next) {
                throw new Error("Operation produced no result")
            }
            const after = next.numTri()
            // setManifold deletes `source` (the previous handle) for us.
            setManifold(next)
            setStats({ before, after })
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Operation failed")
        } finally {
            setPending(false)
        }
        // Hold briefly so a fast op still reads as a pulse, then fade the blur out.
        await delay(OVERLAY_HOLD_MS)
        setOverlay("fading")
        await delay(OVERLAY_FADE_MS)
        setOverlay("hidden")
    }

    const busy = pending || overlay !== "hidden"

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
                        <SlidersHorizontal className="size-5 text-primary" />
                        <h3 className="font-mono text-title-md text-on-surface">MESH TOOLS</h3>
                    </div>
                    <button type="button" onClick={onClose} className="text-tertiary hover:text-on-surface">
                        <X className="size-5" />
                    </button>
                </div>

                <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
                    {hasModel ? (
                        <>
                            <p className="font-sans text-body-sm text-tertiary">
                                Optimize or vary the loaded model and replace it in the viewport. Use Export to save the
                                result.
                            </p>

                            <div className="flex flex-col gap-4">
                                <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">
                                    Optimize
                                </div>

                                <label className="flex items-center justify-between gap-2">
                                    <span className="font-sans text-body-sm text-on-surface">Tolerance (mm)</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.01}
                                        value={tolerance}
                                        onChange={(event) => {
                                            const parsed = Number.parseFloat(event.target.value)
                                            if (!Number.isNaN(parsed)) {
                                                setTolerance(Math.max(0, parsed))
                                            }
                                        }}
                                        className="w-24 rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1.5 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
                                    />
                                </label>
                                <p className="font-sans text-tiny text-tertiary">
                                    Max distance the surface may move. Larger values allow coarser meshes, but on curved
                                    models the triangle count is not strictly decreasing — very large values can
                                    re-triangulate detail. Compare the before/after counts below.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => apply((current) => simplify(current, tolerance))}
                                    disabled={busy}
                                    className="w-full border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Simplify
                                </button>

                                <button
                                    type="button"
                                    onClick={() => apply((current) => smooth(current, { refine: refineFactor }))}
                                    disabled={busy || overBudget}
                                    className="w-full border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Smooth
                                </button>
                                {overBudget ? (
                                    <div className="font-mono text-tiny text-error">
                                        ≈{refineProjected.toLocaleString()} triangles exceeds the{" "}
                                        {MAX_TRIANGLES.toLocaleString()} limit — simplify the model first.
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex flex-col gap-4">
                                <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">
                                    Vary
                                </div>
                                <p className="font-sans text-body-sm text-tertiary">
                                    Deform the model into a new shape with a coherent displacement field. Each click
                                    reseeds for a different result.
                                </p>

                                <label className="flex items-center justify-between gap-2">
                                    <span className="font-sans text-body-sm text-on-surface">Amplitude</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={VARY_MAX_AMPLITUDE}
                                        step={0.01}
                                        value={amplitude}
                                        onChange={(event) => {
                                            const parsed = Number.parseFloat(event.target.value)
                                            if (!Number.isNaN(parsed)) {
                                                setAmplitude(Math.min(VARY_MAX_AMPLITUDE, Math.max(0, parsed)))
                                            }
                                        }}
                                        className="w-24 rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1.5 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() =>
                                        apply((current) =>
                                            vary(current, {
                                                amplitude,
                                                seed: Math.floor(Math.random() * 0x7fffffff),
                                                resolution: refineFactor
                                            })
                                        )
                                    }
                                    disabled={busy || overBudget}
                                    className="w-full border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Vary
                                </button>
                                {overBudget ? (
                                    <div className="font-mono text-tiny text-error">
                                        ≈{refineProjected.toLocaleString()} triangles exceeds the{" "}
                                        {MAX_TRIANGLES.toLocaleString()} limit — simplify the model first.
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex flex-col gap-2">
                                {pending ? <div className="font-mono text-tiny text-tertiary">Working…</div> : null}
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
                            Load a model first — Mesh Tools operates on the model in the viewport.
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
