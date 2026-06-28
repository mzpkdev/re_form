import { Shuffle, X } from "lucide-react"
import { useState } from "react"
import { cn } from "../design/cn"
import { shuffleStl } from "../lib/shuffle"
import { parseStl } from "../lib/stl"

type Stats = {
    originalTris: number
    originalBytes: number
    newTris: number
    newBytes: number
}

/** Triangle count of a binary STL: 84-byte header/count prefix, 50 bytes/tri. */
const binaryStlTriangles = (buffer: ArrayBuffer): number => (buffer.byteLength - 84) / 50

/** Human-readable byte size: KB up to ~1 MB, then MB with one decimal. */
const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024).toLocaleString()} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const ShufflePanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const [file, setFile] = useState<File | null>(null)
    const [reorder, setReorder] = useState(true)
    const [subdivide, setSubdivide] = useState(0)
    const [jitter, setJitter] = useState(0)
    const [stats, setStats] = useState<Stats | null>(null)

    const onShuffle = async () => {
        if (!file) {
            return
        }
        const buf = await file.arrayBuffer()
        const seed = Math.floor(Math.random() * 0x7fffffff)
        const out = shuffleStl(buf, { reorder, subdivide, jitter, seed })

        const base = file.name.replace(/\.stl$/i, "")
        const url = URL.createObjectURL(new Blob([out], { type: "model/stl" }))
        const a = document.createElement("a")
        a.href = url
        a.download = `${base}-shuffled.stl`
        a.click()
        URL.revokeObjectURL(url)

        setStats({
            originalTris: parseStl(buf).getAttribute("position").count / 3,
            originalBytes: buf.byteLength,
            newTris: binaryStlTriangles(out),
            newBytes: out.byteLength
        })
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
                    <div className="flex flex-col gap-3">
                        <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">Source</div>
                        <label className="flex cursor-pointer items-center justify-center border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container">
                            CHOOSE_STL
                            <input
                                type="file"
                                accept=".stl"
                                onChange={(event) => {
                                    setFile(event.target.files?.[0] ?? null)
                                    setStats(null)
                                }}
                                className="hidden"
                            />
                        </label>
                        {file ? (
                            <div className="truncate font-mono text-mono-data text-on-surface">{file.name}</div>
                        ) : (
                            <div className="font-mono text-tiny text-tertiary">No file selected</div>
                        )}
                    </div>

                    <div className="flex flex-col gap-4">
                        <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">Options</div>

                        <label className="flex items-center justify-between gap-2">
                            <span className="font-sans text-body-sm text-on-surface">Reorder</span>
                            <input
                                type="checkbox"
                                checked={reorder}
                                onChange={(event) => setReorder(event.target.checked)}
                                className="size-4 accent-primary"
                            />
                        </label>

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
                            onClick={onShuffle}
                            disabled={!file}
                            className="w-full border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Shuffle &amp; download
                        </button>
                        {stats ? (
                            <div className="font-mono text-tiny text-tertiary">
                                {stats.originalTris.toLocaleString()} tris · {formatBytes(stats.originalBytes)} →{" "}
                                {stats.newTris.toLocaleString()} tris · {formatBytes(stats.newBytes)}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </aside>
    )
}
